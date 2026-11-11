// 自分の記録（本人だけ）：日報・回答・点数・段階・内部の確認の履歴
import { admin, caller, handler, json } from '../_shared/http.ts';
import { decrypt } from '../_shared/crypto.ts';
import { addDays, todayJST, workHours, STAGE_NAMES } from '../_shared/judge.ts';

Deno.serve(handler(async (req) => {
  const db = admin();
  const me = await caller(req, db, { consent: false });
  const url = new URL(req.url);
  const days = Math.min(186, Math.max(7, Number(url.searchParams.get('days') ?? 60)));
  const from = addDays(todayJST(), -days);

  const [reps, sds, sts, logs, rests, qs, rvIn] = await Promise.all([
    db.from('daily_reports').select('*').eq('member_id', me.id).gte('date', from).order('date', { ascending: false }),
    db.from('stress_days').select('date, cycle_day, answers_enc, score_enc').eq('member_id', me.id).gte('date', from),
    db.from('stages').select('date, stage, held, raised').eq('member_id', me.id).gte('date', from),
    db.from('access_log').select('at, actor_name, range_from, range_to, reason').eq('target_member_id', me.id).order('at', { ascending: false }),
    db.from('rests').select('start_date, end_date').eq('member_id', me.id).order('start_date', { ascending: false }),
    db.from('questions').select('id, text, choices'),
    db.from('review_requests').select('date, note, from_member_id, members!review_requests_from_member_id_fkey(name)').eq('to_member_id', me.id).gte('date', from).order('date', { ascending: false }),
  ]);

  const qmap = new Map((qs.data ?? []).map((q) => [q.id, q]));
  const stress = new Map<string, { score: number; answers: { q: string; text: string; label: string; p: number }[] }>();
  for (const s of sds.data ?? []) {
    const answers = ((await decrypt<{ q: string; p: number }[]>(s.answers_enc)) ?? []).map((a) => {
      const q = qmap.get(a.q);
      const label = q?.choices.find((c: { points: number }) => c.points === a.p)?.label ?? '';
      return { q: a.q, text: q?.text ?? a.q, label, p: a.p };
    });
    stress.set(s.date, { score: (await decrypt<number>(s.score_enc)) ?? 0, answers });
  }
  const stage = new Map((sts.data ?? []).map((s) => [s.date, s]));
  const rows = [];
  for (const r of reps.data ?? []) {
    const { feelings_enc, ...rest } = r;
    const st = stage.get(r.date);
    rows.push({
      ...rest,
      feelings: (await decrypt<string>(feelings_enc)) ?? '',
      work_hours: workHours(r.start_time, r.end_time),
      stress: stress.get(r.date) ?? null,
      stage: st && !st.held && st.stage !== null ? { value: st.stage, name: STAGE_NAMES[st.stage], raised: st.raised } : null,
    });
  }
  const latest = [...(sts.data ?? [])].filter((s) => !s.held && s.stage !== null).sort((a, b) => b.date.localeCompare(a.date))[0];
  return json({
    me: { id: me.id, name: me.name, email: me.email, is_operator: me.is_operator, is_representative: me.is_representative, consent_at: me.consent_at },
    latest_stage: latest ? { date: latest.date, value: latest.stage, name: STAGE_NAMES[latest.stage as number] } : null,
    days: rows,
    reviews_to_me: (rvIn.data ?? []).map((r) => ({ date: r.date, note: r.note,
      // deno-lint-ignore no-explicit-any
      from: (r as any).members?.name ?? '' })),
    access_log: logs.data ?? [],
    rests: rests.data ?? [],
  });
}));
