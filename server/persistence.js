import { readFile } from 'node:fs/promises';

export async function createPersistence(url = process.env.MYSQL_URL) {
  if (!url) {
    return {
      mode: 'memory-temporary',
      saveRoll: async () => {},
      health: async () => ({ mode: 'memory-temporary', status: 'ok', durable: false }),
      close: async () => {},
    };
  }
  const { default: mysql } = await import('mysql2/promise');
  const pool = mysql.createPool({ uri: url, connectionLimit: 5, connectTimeout: 5000 });
  try {
    await pool.query(await readFile(new URL('./schema.sql', import.meta.url), 'utf8'));
  } catch (error) {
    await pool.end();
    throw new Error(`MySQL 初始化失败，请检查 MYSQL_URL 与建表权限 (${error.code || 'connection error'})`);
  }
  return {
    mode: 'mysql',
    async saveRoll(room, result) {
      await pool.execute(
        `INSERT INTO bobing_rolls
         (roll_id, game_id, room_code, player_id, player_name, round_number, dice_values, award, invalid_reason)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE roll_id = VALUES(roll_id)`,
        [result.id, room.gameId, room.code, result.playerId, result.playerName,
          result.round, JSON.stringify(result.values), JSON.stringify(result.award), result.invalid || null],
      );
    },
    async health() {
      await pool.query('SELECT 1');
      return { mode: 'mysql', status: 'ok', durable: true };
    },
    close: () => pool.end(),
  };
}
