// 段階の判定（データベースに触れない純粋な計算）。構想書「判定ロジック」の手順どおり。

export const STAGE_NAMES = ['健康', 'やや偏りあり', '不安定', '危険', '今すぐ休息'] as const;

export type Settings = {
  borders: number[];            // [0.40, 0.55, 0.70, 0.85]
  raise_daily_margin: number;   // 0.20
  raise_daily_days: number;     // 3
  raise_trend_days: number;     // 5
  raise_trend_total: number;    // 0.10
  sleep_bonus: number;          // 0.10
  sleep_window_days: number;    // 10
  sleep_limit_hours: number;    // 50
  sleep_min_entries: number;    // 7
  baseline_days: number;        // 22
  baseline_high: number;        // 0.55
  min_days_for_stage: number;   // 3
  operator_notify_days: number; // 2
  retention_months: number;     // 6
  retired_remind_days: number;  // 30
  season_months: number[];      // [1, 5, 9]
};

export const DEFAULT_SETTINGS: Settings = {
  borders: [0.40, 0.55, 0.70, 0.85],
  raise_daily_margin: 0.20,
  raise_daily_days: 3,
  raise_trend_days: 5,
  raise_trend_total: 0.10,
  sleep_bonus: 0.10,
  sleep_window_days: 10,
  sleep_limit_hours: 50,
  sleep_min_entries: 7,
  baseline_days: 22,
  baseline_high: 0.55,
  min_days_for_stage: 3,
  operator_notify_days: 2,
  retention_months: 6,
  retired_remind_days: 30,
  season_months: [1, 5, 9],
};

export const MAX_SCORE = 32;   // 8問 × 4点

// ---------- 日付（YYYY-MM-DD の文字列で扱う） ----------
export function addDays(date: string, n: number): string {
  const d = new Date(date + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);
}
export function addMonths(date: string, n: number): string {
  const d = new Date(date + 'T00:00:00Z');
  d.setUTCMonth(d.getUTCMonth() + n);
  return d.toISOString().slice(0, 10);
}
/** 日本時間の今日 */
export function todayJST(now = Date.now()): string {
  return new Date(now + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

// ---------- 入力 ----------
export type DayRate = { date: string; rate: number };          // その日の得点 / 32
export type Sleep = { date: string; hours: number };
export type Baseline = { start_date: string; kind: 'initial' | 'rest' | 'season'; value: number | null; fixed_on: string | null };
export type Rest = { start_date: string; end_date: string | null };

export function stageFromRate(r: number, borders: number[]): number {
  let s = 0;
  for (const b of borders) if (r >= b - 1e-9) s++;
  return s;
}

/** R：date を含む直近7日間の平均（回答がある日だけ）。少なすぎるときは null */
export function rollingRate(days: DayRate[], date: string, minDays: number): number | null {
  const from = addDays(date, -6);
  const xs = days.filter((d) => d.date >= from && d.date <= date).map((d) => d.rate);
  if (xs.length < minDays) return null;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

/** 睡眠の加点：直近10日間で7日分以上の入力があり、10日分に換算した合計が50時間を下回る */
export function sleepShort(sleep: Sleep[], date: string, s: Settings): boolean {
  const from = addDays(date, -(s.sleep_window_days - 1));
  const xs = sleep.filter((x) => x.date >= from && x.date <= date);
  if (xs.length < s.sleep_min_entries) return false;
  const total = xs.reduce((a, b) => a + b.hours, 0);
  const scaled = (total / xs.length) * s.sleep_window_days;
  return scaled < s.sleep_limit_hours;
}

// ---------- 基準（B） ----------
export type BaselineAction =
  | { type: 'create'; start_date: string; kind: Baseline['kind'] }
  | { type: 'fix'; start_date: string; value: number; fixed_on: string };

/**
 * その日の時点で、基準の行に何をするか。
 * ・基準がまだ無い → 最初の回答日から「initial」を作る
 * ・休息が明けた → 明けた翌日から「rest」を作る（毎回）
 * ・1/5/9月の1日を過ぎた（いまの基準が確定済みのとき） → その日から「season」を作る
 * ・集めている基準に22日分そろった → 確定する
 */
export function baselineActions(
  baselines: Baseline[], days: DayRate[], rests: Rest[], date: string, s: Settings,
): BaselineAction[] {
  const out: BaselineAction[] = [];
  const list = [...baselines].sort((a, b) => a.start_date.localeCompare(b.start_date));
  const answered = days.filter((d) => d.date <= date).sort((a, b) => a.date.localeCompare(b.date));
  if (!answered.length) return out;

  let latest = list[list.length - 1];
  if (!latest) {
    latest = { start_date: answered[0].date, kind: 'initial', value: null, fixed_on: null };
    out.push({ type: 'create', start_date: latest.start_date, kind: 'initial' });
  }

  // 休息明け
  const restStarts = rests
    .filter((r) => r.end_date && r.end_date < date)
    .map((r) => addDays(r.end_date as string, 1))
    .filter((st) => st > latest.start_date && st <= date)
    .sort();
  if (restStarts.length) {
    const st = restStarts[restStarts.length - 1];
    latest = { start_date: st, kind: 'rest', value: null, fixed_on: null };
    out.push({ type: 'create', start_date: st, kind: 'rest' });
  } else if (latest.fixed_on) {
    // 季節の取り直し（確定済みの基準があるときだけ）
    const season = seasonStartsBetween(latest.fixed_on, date, s.season_months);
    if (season) {
      latest = { start_date: season, kind: 'season', value: null, fixed_on: null };
      out.push({ type: 'create', start_date: season, kind: 'season' });
    }
  }

  if (!latest.fixed_on) {
    const xs = answered.filter((d) => d.date >= latest.start_date).slice(0, s.baseline_days);
    if (xs.length >= s.baseline_days) {
      const value = xs.reduce((a, b) => a + b.rate, 0) / xs.length;
      out.push({ type: 'fix', start_date: latest.start_date, value, fixed_on: xs[xs.length - 1].date });
    }
  }
  return out;
}

/** after より後〜date までにある、いちばん新しい「1・5・9月の1日」 */
export function seasonStartsBetween(after: string, date: string, months: number[]): string | null {
  let found: string | null = null;
  const y0 = Number(after.slice(0, 4));
  const y1 = Number(date.slice(0, 4));
  for (let y = y0; y <= y1; y++) {
    for (const m of months) {
      const d = `${y}-${String(m).padStart(2, '0')}-01`;
      if (d > after && d <= date) found = d;
    }
  }
  return found;
}

export function applyBaselineActions(baselines: Baseline[], actions: BaselineAction[]): Baseline[] {
  const list = baselines.map((b) => ({ ...b }));
  for (const a of actions) {
    if (a.type === 'create') list.push({ start_date: a.start_date, kind: a.kind, value: null, fixed_on: null });
    else {
      const b = list.find((x) => x.start_date === a.start_date);
      if (b) { b.value = a.value; b.fixed_on = a.fixed_on; }
    }
  }
  return list.sort((a, b) => a.start_date.localeCompare(b.start_date));
}

// ---------- 判定 ----------
export type Judgement = {
  date: string;
  held: boolean;
  stage: number | null;     // 最終の段階
  base: number | null;      // A（共通の線だけで出した段階）
  rate: number | null;      // R（加点前）
  sleepBonus: boolean;
  raised: boolean;
  baselineState: 'collecting' | 'valid' | 'high';
  reasons: string[];
};

export function judge(
  date: string, days: DayRate[], sleep: Sleep[], baselines: Baseline[], s: Settings,
): Judgement {
  const r = rollingRate(days, date, s.min_days_for_stage);
  const latest = [...baselines].sort((a, b) => a.start_date.localeCompare(b.start_date)).filter((b) => b.start_date <= date).pop();
  let baselineState: Judgement['baselineState'] = 'collecting';
  if (latest && latest.fixed_on && latest.fixed_on <= date && latest.value !== null) {
    baselineState = latest.value >= s.baseline_high - 1e-9 ? 'high' : 'valid';
  }
  if (r === null) {
    return { date, held: true, stage: null, base: null, rate: null, sleepBonus: false, raised: false, baselineState, reasons: ['直近7日の回答が少ないので保留'] };
  }
  const reasons: string[] = [];
  const bonus = sleepShort(sleep, date, s);
  const adj = Math.min(1, r + (bonus ? s.sleep_bonus : 0));
  if (bonus) reasons.push('睡眠が少ないので加点');
  const base = stageFromRate(adj, s.borders);

  let raised = false;
  if (baselineState === 'valid' && latest && latest.value !== null) {
    const B = latest.value;
    // 3日連続で、その日の割合が B+20ポイント以上
    let streak = true;
    for (let i = 0; i < s.raise_daily_days; i++) {
      const d = days.find((x) => x.date === addDays(date, -i));
      if (!d || d.rate < B + s.raise_daily_margin - 1e-9) { streak = false; break; }
    }
    if (streak) { raised = true; reasons.push(`${s.raise_daily_days}日連続で基準より大きく悪化`); }

    // 5日続けて R が上がり、合計10ポイント以上
    const series: (number | null)[] = [];
    for (let i = s.raise_trend_days; i >= 0; i--) series.push(rollingRate(days, addDays(date, -i), s.min_days_for_stage));
    if (series.every((x) => x !== null)) {
      const xs = series as number[];
      let up = true;
      for (let i = 1; i < xs.length; i++) if (!(xs[i] > xs[i - 1] + 1e-9)) { up = false; break; }
      if (up && xs[xs.length - 1] - xs[0] >= s.raise_trend_total - 1e-9) {
        if (!raised) reasons.push(`${s.raise_trend_days}日続けて悪化傾向`);
        raised = true;
      }
    }
  } else if (baselineState === 'collecting') {
    reasons.push('基準を集めている期間なので共通の線だけで判定');
  } else {
    reasons.push('基準が高めなので共通の線だけで判定');
  }
  const stage = Math.min(4, base + (raised ? 1 : 0));
  return { date, held: false, stage, base, rate: r, sleepBonus: bonus, raised, baselineState, reasons };
}

// ---------- 通知するかどうか ----------
export type StageRow = { date: string; stage: number | null; raised: boolean };

/** 本人へのお知らせ：段階が変わったとき、または悪化を新たに検知したとき */
export function shouldNotifyPerson(prev: StageRow | undefined, now: Judgement): boolean {
  if (now.held || now.stage === null) return false;
  if (!prev || prev.stage === null) return true;
  if (prev.stage !== now.stage) return true;
  return now.raised && !prev.raised;
}

/** 運用者への危険の通知：危険以上が N日続いた日、またはその後さらに段階が上がった日 */
export function shouldNotifyOperator(history: StageRow[], now: Judgement, s: Settings): boolean {
  if (now.held || now.stage === null || now.stage < 3) return false;
  const byDate = new Map(history.map((h) => [h.date, h]));
  const count = dangerStreak(history, now.date);
  if (count === s.operator_notify_days) return true;
  const prev = byDate.get(addDays(now.date, -1));
  return count > s.operator_notify_days && !!prev && prev.stage !== null && now.stage > prev.stage;
}

/** date を含めて、危険以上が何日続いているか（date の日は危険以上として数える） */
export function dangerStreak(history: StageRow[], date: string): number {
  const byDate = new Map(history.map((h) => [h.date, h]));
  let count = 1;
  for (let i = 1; i < 60; i++) {
    const h = byDate.get(addDays(date, -i));
    if (h && h.stage !== null && h.stage >= 3) count++; else break;
  }
  return count;
}

/** 稼働時間（時間）。終了が開始より前なら日をまたいだ扱い */
export function workHours(start: string | null, end: string | null): number | null {
  if (!start || !end) return null;
  const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
  let m = toMin(end) - toMin(start);
  if (m < 0) m += 24 * 60;
  return Math.round((m / 60) * 10) / 10;
}

export function parseSettings(rows: { key: string; value: unknown }[]): Settings {
  const s: Record<string, unknown> = { ...DEFAULT_SETTINGS };
  for (const r of rows) if (r.key in s) s[r.key] = r.value;
  return s as Settings;
}
