// node --test tests/judge.test.ts で実行（Node 22.18 以降）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_SETTINGS as S, addDays, judge, baselineActions, applyBaselineActions, stageFromRate,
  shouldNotifyPerson, shouldNotifyOperator, workHours, sleepShort, seasonStartsBetween,
  type DayRate, type Sleep, type Baseline,
} from '../supabase/functions/_shared/judge.ts';

const D = '2026-11-20';
const series = (end: string, rates: number[]): DayRate[] =>
  rates.map((rate, i) => ({ date: addDays(end, i - rates.length + 1), rate }));
const sleeps = (end: string, h: number, n = 10): Sleep[] =>
  Array.from({ length: n }, (_, i) => ({ date: addDays(end, -i), hours: h }));
const fixed = (v: number): Baseline[] => [{ start_date: '2026-09-01', kind: 'initial', value: v, fixed_on: '2026-09-22' }];

test('境界：40/55/70/85%', () => {
  assert.equal(stageFromRate(0.399, S.borders), 0);
  assert.equal(stageFromRate(0.40, S.borders), 1);
  assert.equal(stageFromRate(0.55, S.borders), 2);
  assert.equal(stageFromRate(0.70, S.borders), 3);
  assert.equal(stageFromRate(0.85, S.borders), 4);
});

test('例1：Aは健康、3日連続でB+20以上 → やや偏りあり', () => {
  const j = judge(D, series(D, [0.36, 0.36, 0.36, 0.36, 0.40, 0.38, 0.41]), sleeps(D, 5.5), fixed(0.15), S);
  assert.equal(j.base, 0); assert.equal(j.raised, true); assert.equal(j.stage, 1);
});

test('例2：悪化の条件に当たらない → A（やや偏りあり）', () => {
  const j = judge(D, series(D, [0.53, 0.53, 0.53, 0.53, 0.52, 0.50, 0.49]), sleeps(D, 6.2), fixed(0.30), S);
  assert.equal(j.stage, 1); assert.equal(j.raised, false);
});

test('例3：睡眠の加点で不安定', () => {
  const j = judge(D, series(D, [0.53, 0.53, 0.53, 0.53, 0.49, 0.52, 0.51]), sleeps(D, 4.2), fixed(0.30), S);
  assert.equal(j.sleepBonus, true); assert.equal(j.stage, 2);
});

test('例4：基準が55%以上 → Aだけ（危険）', () => {
  const j = judge(D, series(D, [0.72, 0.72, 0.72, 0.72, 0.72, 0.72, 0.72]), sleeps(D, 5.8), fixed(0.60), S);
  assert.equal(j.baselineState, 'high'); assert.equal(j.stage, 3); assert.equal(j.raised, false);
});

test('例5：基準より良くても下げない', () => {
  const j = judge(D, series(D, [0.20, 0.20, 0.20, 0.20, 0.18, 0.22, 0.20]), sleeps(D, 6), fixed(0.30), S);
  assert.equal(j.stage, 0);
});

test('上昇傾向（5日続けてRが上がり合計10ポイント以上）で1つ上げる', () => {
  const rates = [0.20, 0.20, 0.20, 0.20, 0.20, 0.20, 0.30, 0.35, 0.40, 0.45, 0.50];
  const j = judge(D, series(D, rates), [], fixed(0.30), S);
  assert.equal(j.base, 0); assert.equal(j.raised, true); assert.equal(j.stage, 1);
});

test('回答が3日未満なら保留', () => {
  const j = judge(D, series(D, [0.9, 0.9]), [], fixed(0.3), S);
  assert.equal(j.held, true); assert.equal(j.stage, null);
});

test('基準を集めている間はAだけ', () => {
  const j = judge(D, series(D, [0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5]), [], [{ start_date: D, kind: 'initial', value: null, fixed_on: null }], S);
  assert.equal(j.baselineState, 'collecting'); assert.equal(j.stage, 1);
});

test('最大は今すぐ休息', () => {
  const j = judge(D, series(D, Array(11).fill(0.95)), sleeps(D, 3), fixed(0.30), S);
  assert.equal(j.stage, 4);
});

test('睡眠：入力7日未満は加点しない／10日換算', () => {
  assert.equal(sleepShort(sleeps(D, 4, 6), D, S), false);
  assert.equal(sleepShort(sleeps(D, 7, 7), D, S), false);  // 7日×7時間=49時間でも、10日換算70時間なので加点しない
  assert.equal(sleepShort(sleeps(D, 4.9, 7), D, S), true);
});

test('基準：最初の22日で確定', () => {
  const days = series(D, Array(22).fill(0.25));
  let acts = baselineActions([], days, [], D, S);
  assert.deepEqual(acts.map((a) => a.type), ['create', 'fix']);
  const b = applyBaselineActions([], acts);
  assert.equal(b[0].kind, 'initial'); assert.ok(Math.abs((b[0].value as number) - 0.25) < 1e-9);
  acts = baselineActions(b, days, [], D, S);
  assert.equal(acts.length, 0);
});

test('基準：休息明けで取り直し', () => {
  const b = fixed(0.3);
  const acts = baselineActions(b, series(D, [0.3, 0.3, 0.3]), [{ start_date: '2026-11-10', end_date: '2026-11-15' }], D, S);
  assert.deepEqual(acts, [{ type: 'create', start_date: '2026-11-16', kind: 'rest' }]);
});

test('基準：1・5・9月に取り直し', () => {
  assert.equal(seasonStartsBetween('2026-09-22', '2027-01-03', S.season_months), '2027-01-01');
  assert.equal(seasonStartsBetween('2026-09-22', '2026-12-31', S.season_months), null);
  const acts = baselineActions(fixed(0.3), series('2027-01-03', [0.3, 0.3]), [], '2027-01-03', S);
  assert.deepEqual(acts, [{ type: 'create', start_date: '2027-01-01', kind: 'season' }]);
});

test('通知：本人は段階が変わったときだけ', () => {
  const j = judge(D, series(D, Array(7).fill(0.5)), [], fixed(0.4), S);
  assert.equal(shouldNotifyPerson({ date: addDays(D, -1), stage: 1, raised: false }, j), false);
  assert.equal(shouldNotifyPerson({ date: addDays(D, -1), stage: 0, raised: false }, j), true);
});

test('通知：運用者は危険以上が2日続いた日', () => {
  const j = judge(D, series(D, Array(7).fill(0.75)), [], fixed(0.6), S);
  assert.equal(shouldNotifyOperator([], j, S), false);
  assert.equal(shouldNotifyOperator([{ date: addDays(D, -1), stage: 3, raised: false }], j, S), true);
  assert.equal(shouldNotifyOperator([{ date: addDays(D, -1), stage: 3, raised: false }, { date: addDays(D, -2), stage: 3, raised: false }], j, S), false);
});

test('稼働時間：日をまたぐ', () => {
  assert.equal(workHours('09:00', '18:30'), 9.5);
  assert.equal(workHours('22:00', '02:00'), 4);
});
