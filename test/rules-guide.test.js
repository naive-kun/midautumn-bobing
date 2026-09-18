import test from 'node:test';
import assert from 'node:assert/strict';
import { AWARDS, evaluateRoll } from '../shared/rules.js';
import { CULTURE_STORY, RULE_EXAMPLES, renderDieSvg, renderRulesGuide, renderCultureStory } from '../web/rules-guide.js';

test('each illustrated six-dice example evaluates to its advertised award', () => {
  assert.equal(RULE_EXAMPLES.length, AWARDS.length);
  assert.equal(new Set(RULE_EXAMPLES.map(example => example.name)).size, AWARDS.length);
  for (const example of RULE_EXAMPLES) {
    assert.equal(example.values.length, 6);
    assert.equal(evaluateRoll(example.values).name, example.name, `${example.name}: ${example.values}`);
    assert.equal(new Set(example.variable).size, example.variable.length);
    assert.ok(example.variable.every(index => Number.isInteger(index) && index >= 0 && index < 6));
    assert.ok(example.constraint.length > 0);
  }
});

test('guide excludes higher awards from lower four-dot illustrations', () => {
  assert.equal(evaluateRoll([4,4,4,4,1,1]).name, '状元插金花');
  assert.equal(evaluateRoll([4,4,4,4,4,2]).name, '五红');
  assert.equal(evaluateRoll([4,4,2,2,2,2]).name, '四进');
  assert.equal(evaluateRoll([4,1,2,3,5,6]).name, '对堂');
  assert.equal(evaluateRoll([4,2,2,2,2,1]).name, '四进');
  assert.equal(evaluateRoll([4,2,2,2,2,2]).name, '五子');
  for (const name of ['状元', '二举', '一秀']) {
    const example = RULE_EXAMPLES.find(item => item.name === name);
    assert.ok(example.variable.length > 0);
    assert.match(example.constraint, /不能|排除/);
  }
});

test('inline dice have the actual pip count, scene colors and accessible labels', () => {
  for (let value = 1; value <= 6; value++) {
    const svg = renderDieSvg(value);
    assert.equal((svg.match(/<circle\b/g) || []).length, value);
    assert.match(svg, /role="img" aria-label=".+点骰子"/);
    assert.match(svg, value === 1 || value === 4 ? /fill="#a34332"/ : /fill="#29483c"/);
    assert.doesNotMatch(svg, /stroke-dasharray/);
    assert.match(renderDieSvg(value, { variable: true }), /stroke-dasharray/);
  }
  assert.throws(() => renderDieSvg(0), /Dice value/);
  assert.throws(() => renderDieSvg(7), /Dice value/);
});

test('all award cards render exactly six dice and never expose scores', () => {
  const html = renderRulesGuide();
  assert.equal((html.match(/<article class="rule-card">/g) || []).length, AWARDS.length);
  assert.equal((html.match(/<svg /g) || []).length, AWARDS.length * 6);
  assert.doesNotMatch(html, /积分|得分|points|score/);
});

test('every culture chapter links its checked sources and identifies the origin story as a legend', () => {
  const sources = new Map(CULTURE_STORY.sources.map(source => [source.id, source]));
  assert.equal(CULTURE_STORY.sections.length, 4);
  for (const section of CULTURE_STORY.sections) {
    assert.ok(section.sourceIds.length > 0, `${section.title} needs a source`);
    for (const id of section.sourceIds) assert.match(sources.get(id)?.url || '', /^https:\/\//);
  }
  const legend = CULTURE_STORY.sections.find(section => section.title.includes('传说'));
  assert.match(legend.paragraphs.join(''), /相传/);
  assert.match(legend.paragraphs.join(''), /起源仍难确考/);
  const html = renderCultureStory();
  assert.equal((html.match(/class="story-chapter"/g) || []).length, 4);
  assert.equal((html.match(/<a href=/g) || []).length, 5);
  for (const source of CULTURE_STORY.sources) assert.ok(html.includes(source.url));
  assert.doesNotMatch(html, /正在核实/);
});
