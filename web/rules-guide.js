import { AWARDS } from '../shared/rules.js';

// Every pictured throw must evaluate to its named award in shared/rules.js.
// Dashed dice show changeable example positions, never unrestricted wildcards.
export const RULE_EXAMPLES = Object.freeze([
  { name: '状元插金花', values: [4,4,4,4,1,1], variable: [], pattern: '四颗四点，配两颗一点', constraint: '六颗须满足这一组合；骰子的排列顺序不影响判奖。' },
  { name: '六红', values: [4,4,4,4,4,4], variable: [], pattern: '六颗全是四点', constraint: '六颗都是红色四点。' },
  { name: '六同', values: [6,6,6,6,6,6], variable: [], pattern: '六颗同点，且不是四点', constraint: '这里以六个六为例，也可以全是 1、2、3 或 5；全是 4 则为六红。' },
  { name: '五红', values: [4,4,4,4,4,2], variable: [5], pattern: '五颗四点，另有一颗非四点', constraint: '虚线骰可为 1、2、3、5、6；若也是 4，就升级为六红。' },
  { name: '五子', values: [3,3,3,3,3,2], variable: [5], pattern: '五颗同点，且不是四点', constraint: '同点的五颗可整体换成 1、2、5 或 6。第六颗必须与它们不同，否则是六同。' },
  { name: '状元', values: [4,4,4,4,2,3], variable: [4,5], pattern: '四颗四点，其余两颗看条件', constraint: '虚线两颗都不能是 4，也不能同时为 1；两颗 1 会成为状元插金花。' },
  { name: '对堂', values: [1,2,3,4,5,6], variable: [], pattern: '一点到六点，各一颗', constraint: '六种点数齐全，排列顺序不限。不能只看其中的一颗四点就判一秀。' },
  { name: '三红', values: [4,4,4,1,2,3], variable: [3,4,5], pattern: '恰好三颗四点', constraint: '其余三颗可以变化，但都不能再出现四点。' },
  { name: '四进', values: [2,2,2,2,1,3], variable: [4,5], pattern: '四颗同点，且不是四点', constraint: '同点的四颗可整体换成 1、3、5、6。其余两颗不能再与它们同点，否则会成为五子或六同。' },
  { name: '二举', values: [4,4,1,2,3,5], variable: [2,3,4,5], pattern: '恰好两颗四点', constraint: '其余四颗均非四点，且不能四颗同点；后者会优先判四进。' },
  { name: '一秀', values: [4,1,1,2,3,5], variable: [1,2,3,4,5], pattern: '一颗四点，且没有更高奖项', constraint: '另外五颗都不是 4，还要排除对堂、四进、五子等更高组合。' },
  { name: '未中奖', values: [1,1,2,2,3,6], variable: [0,1,2,3,4,5], pattern: '没有命中以上组合', constraint: '本例没有四点，也没有四颗及以上同点；虚线仅表示一组未中奖示例。' },
].map(example => Object.freeze({ ...example, values: Object.freeze(example.values), variable: Object.freeze(example.variable) })));

const PIP_POSITIONS = {
  1: [[24,24]], 2: [[14,14],[34,34]], 3: [[14,14],[24,24],[34,34]],
  4: [[14,14],[34,14],[14,34],[34,34]],
  5: [[14,14],[34,14],[24,24],[14,34],[34,34]],
  6: [[14,14],[34,14],[14,24],[34,24],[14,34],[34,34]],
};
const NUMERAL = ['', '一', '二', '三', '四', '五', '六'];
function escape(value) { return String(value ?? '').replace(/[&<>"']/g, character => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[character])); }

export function renderDieSvg(value, { variable = false } = {}) {
  if (!Number.isInteger(value) || !PIP_POSITIONS[value]) throw new RangeError('Dice value must be an integer from 1 to 6');
  const color = value === 1 || value === 4 ? '#a34332' : '#29483c';
  const label = `${NUMERAL[value]}点骰子${variable ? '，可变示例，须遵守本项条件' : ''}`;
  return `<svg class="guide-die ${variable ? 'variable-die' : ''}" viewBox="0 0 48 52" role="img" aria-label="${label}" focusable="false"><title>${label}</title><rect x="3" y="6" width="42" height="43" rx="8" fill="#c8ba9b" opacity=".23"/><rect x="2" y="2" width="44" height="44" rx="8" fill="#fffaf0" stroke="${variable ? '#b8a986' : '#d5c7ad'}" stroke-width="1.5" ${variable ? 'stroke-dasharray="4 3"' : ''}/>${PIP_POSITIONS[value].map(([x,y]) => `<circle cx="${x}" cy="${y}" r="${value === 1 ? 4 : 3.15}" fill="${color}"/>`).join('')}</svg>`;
}

export function renderRulesGuide() {
  return [...AWARDS].reverse().map(award => {
    const example = RULE_EXAMPLES.find(item => item.name === award.name);
    if (!example) throw new Error(`Missing dice illustration for ${award.name}`);
    return `<article class="rule-card"><div class="rule-card-heading"><h3>${escape(award.name)}</h3><span>${escape(example.pattern)}</span></div><div class="rule-dice-row" role="group" aria-label="${escape(award.name)}示例，${example.values.join('、')}点">${example.values.map((value,index) => renderDieSvg(value, { variable: example.variable.includes(index) })).join('')}</div><p class="rule-condition">${escape(example.constraint)}</p></article>`;
  }).join('');
}

export const CULTURE_STORY = {
  title: '一碗骰声里的中秋',
  introduction: '六颗骰子，一只瓷碗。好彩头之外，还有关于团圆、乡愁与祝愿的故事。',
  sections: [
    {
      title: '一碗骰声过中秋',
      paragraphs: ['在厦门及闽南一些地方，亲友轮流把六颗骰子投进瓷碗，依点数组合领取月饼。博饼把赏月、团聚和小游戏连在一起，让等待开奖也成为节日的乐趣。这项习俗已列入国家级非遗。'],
      sourceIds: ['fujian'],
    },
    {
      title: '一个关于乡愁的传说',
      paragraphs: ['相传，郑成功驻军厦门时，军中曾用赏月博饼排解将士的乡愁。这个故事寄托着人们对团圆的感情。', '不过，博饼最早的起源仍难确考，不能把流传的故事直接当作已经证实的历史。'],
      sourceIds: ['mct', 'heritage'],
    },
    {
      title: '为什么奖项叫“状元”',
      paragraphs: ['博饼借用了古代科举的名次。传统的一会饼有大小六十三块，分为状元、对堂、三红、四进、二举和一秀。人们把对学业有成、生活顺遂的祝愿，放进了这场热闹的节日游戏。'],
      sourceIds: ['licheng'],
    },
    {
      title: '骰声里的家乡记忆',
      paragraphs: ['博饼也流行于金门、台湾等地，中秋活动还吸引海外乡亲参加。骰子在碗中叮当作响，桌边的人一起等待、一起欢笑。一次次投掷，让熟悉的节俗成为连接亲友与故乡的共同记忆。'],
      sourceIds: ['heritage'],
    },
  ],
  sources: [
    { id: 'fujian', title: '福建省文旅厅 · 福建民俗博物馆', url: 'https://wlt.fujian.gov.cn/hdjl/wdxd/202305/t20230512_6168248.htm' },
    { id: 'mct', title: '文化和旅游部', url: 'https://www.mct.gov.cn/whzx/qgwhxxlb/fj/201809/t20180913_834783.htm' },
    { id: 'heritage', title: '中国非物质文化遗产网', url: 'https://www.ihchina.cn/project_details/10215' },
    { id: 'licheng', title: '泉州市鲤城区人民政府', url: 'https://www.qzlc.gov.cn/zwgk/qzbm/wtly/whly/mjms/201401/t20140121_1340869.htm' },
  ],
};

export function renderCultureStory(story = CULTURE_STORY) {
  if (!story.sections.length || !story.sources.length) return '<p class="story-pending" role="status">博饼故事的资料正在核实，稍后补充。</p>';
  const sourceMap = new Map(story.sources.map(source => [source.id, source]));
  return `<p class="story-introduction">${escape(story.introduction)}</p><div class="story-chapters">${story.sections.map((section,index) => `<section class="story-chapter"><span class="story-chapter-number">${String(index + 1).padStart(2,'0')}</span><div><h3>${escape(section.title)}</h3>${section.paragraphs.map(paragraph => `<p>${escape(paragraph)}</p>`).join('')}<div class="story-inline-sources">${(section.sourceIds || []).map(id => { const source = sourceMap.get(id); return source && /^https?:\/\//.test(source.url) ? `<a href="${escape(source.url)}" target="_blank" rel="noopener noreferrer">${escape(source.title)} ↗</a>` : ''; }).join('')}</div></div></section>`).join('')}</div><p class="story-note">故事帮助认识习俗；本试玩的判奖方式请以“骰子图解”中的规则为准。</p>`;
}
