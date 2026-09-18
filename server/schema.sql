CREATE TABLE IF NOT EXISTS bobing_rolls (
  roll_id VARCHAR(64) NOT NULL PRIMARY KEY,
  game_id VARCHAR(64) NOT NULL,
  room_code CHAR(6) NOT NULL,
  player_id VARCHAR(64) NOT NULL,
  player_name VARCHAR(64) NOT NULL,
  round_number SMALLINT UNSIGNED NOT NULL,
  dice_values JSON NOT NULL,
  award JSON NOT NULL,
  invalid_reason VARCHAR(255) NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX idx_bobing_game (game_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
