// Deliberately named an entertainment ruleset. Bobing customs vary by region.
// The first matching category wins; awards never accumulate within one throw.
export const RULES_VERSION = 'entertainment-v1';
export const AWARDS = Object.freeze([
  { name: '未中奖', points: 0, rank: 0, description: '未命中以下组合' },
  { name: '一秀', points: 1, rank: 1, description: '1 个四点' },
  { name: '二举', points: 2, rank: 2, description: '2 个四点' },
  { name: '四进', points: 4, rank: 3, description: '4 个相同的非四点' },
  { name: '三红', points: 8, rank: 4, description: '3 个四点' },
  { name: '对堂', points: 12, rank: 5, description: '一至六点各 1 个' },
  { name: '状元', points: 20, rank: 6, description: '4 个四点，且不满足插金花' },
  { name: '五子', points: 30, rank: 7, description: '5 个相同的非四点' },
  { name: '五红', points: 40, rank: 8, description: '5 个四点' },
  { name: '六同', points: 50, rank: 9, description: '6 个相同的非四点' },
  { name: '六红', points: 60, rank: 10, description: '6 个四点' },
  { name: '状元插金花', points: 80, rank: 11, description: '4 个四点加 2 个一点' },
].map(Object.freeze));

export function evaluateRoll(values) {
  if (!Array.isArray(values) || values.length !== 6 || !Array.from(values).every(value => Number.isInteger(value) && value >= 1 && value <= 6)) {
    throw new TypeError('A roll must contain exactly six integer values between 1 and 6');
  }
  const counts = Array(7).fill(0);
  for (const value of values) counts[value]++;
  const red = counts[4];
  const otherCounts = [1, 2, 3, 5, 6].map(value => counts[value]);
  let rank = 0;
  if (red === 4 && counts[1] === 2) rank = 11;
  else if (red === 6) rank = 10;
  else if (otherCounts.includes(6)) rank = 9;
  else if (red === 5) rank = 8;
  else if (otherCounts.includes(5)) rank = 7;
  else if (red === 4) rank = 6;
  else if (counts.slice(1).every(count => count === 1)) rank = 5;
  else if (red === 3) rank = 4;
  else if (otherCounts.includes(4)) rank = 3;
  else if (red === 2) rank = 2;
  else if (red === 1) rank = 1;
  const { name, points } = AWARDS[rank];
  return { name, points, rank };
}
