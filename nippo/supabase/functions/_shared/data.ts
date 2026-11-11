// 複数の Function で使う読み込み
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.49.4';
import { decrypt } from './crypto.ts';
import { parseSettings, type Settings, type DayRate, type Baseline } from './judge.ts';

export async function loadSettings(db: SupabaseClient): Promise<Settings> {
  const { data } = await db.from('settings').select('key, value');
  return parseSettings(data ?? []);
}

export async function loadRates(db: SupabaseClient, memberId: string): Promise<DayRate[]> {
  const { data, error } = await db.from('stress_days').select('date, score_enc').eq('member_id', memberId).order('date');
  if (error) throw error;
  const out: DayRate[] = [];
  for (const r of data ?? []) out.push({ date: r.date, rate: ((await decrypt<number>(r.score_enc)) ?? 0) / 32 });
  return out;
}

export async function loadBaselines(db: SupabaseClient, memberId: string): Promise<Baseline[]> {
  const { data, error } = await db.from('baselines').select('start_date, kind, value_enc, fixed_on').eq('member_id', memberId).order('start_date');
  if (error) throw error;
  const out: Baseline[] = [];
  for (const b of data ?? []) out.push({ start_date: b.start_date, kind: b.kind, value: await decrypt<number>(b.value_enc), fixed_on: b.fixed_on });
  return out;
}

export async function assignedQuestions(db: SupabaseClient, cycleDay: number) {
  const { data, error } = await db.from('question_days')
    .select('slot, questions(id, grp, text, choices)')
    .eq('cycle_day', cycleDay).order('slot');
  if (error) throw error;
  // deno-lint-ignore no-explicit-any
  return (data ?? []).map((r: any) => ({ slot: r.slot, ...r.questions })) as {
    slot: number; id: string; grp: string; text: string; choices: { label: string; points: number }[];
  }[];
}

export const fmtDate = (d: string) => `${Number(d.slice(5, 7))}月${Number(d.slice(8, 10))}日`;
