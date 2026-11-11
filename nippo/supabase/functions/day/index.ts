// 日報とストレスチェックの読み込み（GET）・保存（POST）
import { admin, caller, handler, json, HttpError, addr } from '../_shared/http.ts';
import { encrypt, decrypt } from '../_shared/crypto.ts';
import { addDays, todayJST } from '../_shared/judge.ts';
import { assignedQuestions, fmtDate } from '../_shared/data.ts';
import { sendMail, sendChat } from '../_shared/notify.ts';

const EDITABLE_DAYS = 2;   // 今日と、2日前まで直せる

function checkDate(date: unknown): string {
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new HttpError(400, '日付が正しくありません');
  const today = todayJST();
  if (date > today || date < addDays(today, -EDITABLE_DAYS)) throw new HttpError(400, `入力できるのは今日から${EDITABLE_DAYS}日前までです`);
  return date;
}

Deno.serve(handler(async (req) => {
  const db = admin();
  const me = await caller(req, db);

  if (req.method === 'GET') {
    const date = checkDate(new URL(req.url).searchParams.get('date') ?? todayJST());
    const cycleDay = await cycleDayFor(db, me.id, date);
    const [questions, rep, sd] = await Promise.all([
      assignedQuestions(db, cycleDay),
      db.from('daily_reports').select('*').eq('member_id', me.id).eq('date', date).maybeSingle(),
      db.from('stress_days').select('answers_enc').eq('member_id', me.id).eq('date', date).maybeSingle(),
    ]);
    let report = null, reviews: unknown[] = [];
    if (rep.data) {
      const { feelings_enc, ...rest } = rep.data;
      report = { ...rest, feelings: (await decrypt<string>(feelings_enc)) ?? '' };
      const rv = await db.from('review_requests').select('to_member_id, note').eq('report_id', rep.data.id);
      reviews = rv.data ?? [];
    }
    const answers = sd.data ? await decrypt(sd.data.answers_enc) : null;
    const { data: directory } = await db.from('members').select('id, name').eq('status', 'active').neq('id', me.id).order('name');
    return json({ date, cycle_day: cycleDay, questions, report, answers, reviews, directory: directory ?? [] });
  }

  if (req.method !== 'POST') throw new HttpError(405, 'method');
  const b = await req.json();
  const date = checkDate(b.date);
  const time = (t: unknown) => (typeof t === 'string' && /^\d{2}:\d{2}$/.test(t) ? t : null);
  const text = (t: unknown, max = 4000) => (typeof t === 'string' ? t.slice(0, max) : '');
  const sleep = b.sleep_hours === null || b.sleep_hours === '' || b.sleep_hours === undefined ? null : Number(b.sleep_hours);
  if (sleep !== null && !(sleep >= 0 && sleep <= 24)) throw new HttpError(400, '睡眠時間が正しくありません');

  // 回答の確認：その日の8問すべてに、選択肢の点で答えているか
  const cycleDay = await cycleDayFor(db, me.id, date);
  const questions = await assignedQuestions(db, cycleDay);
  const given = new Map<string, number>((Array.isArray(b.answers) ? b.answers : []).map((a: { q: string; p: number }) => [a.q, a.p]));
  const answers = questions.map((q) => {
    const p = given.get(q.id);
    if (p === undefined || !q.choices.some((c) => c.points === p)) throw new HttpError(400, '「今日どうだった？」にすべて答えてください');
    return { q: q.id, p };
  });
  const score = answers.reduce((a, x) => a + x.p, 0);

  const report = {
    member_id: me.id, date,
    start_time: time(b.start_time), end_time: time(b.end_time), sleep_hours: sleep,
    did: text(b.did), has_deliverable: !!b.has_deliverable, deliverable_note: text(b.deliverable_note, 1000),
    feelings_enc: b.feelings ? await encrypt(text(b.feelings)) : null,
    updated_at: new Date().toISOString(),
  };
  const { data: saved, error } = await db.from('daily_reports').upsert(report, { onConflict: 'member_id,date' }).select('id').single();
  if (error) throw error;
  const { error: e2 } = await db.from('stress_days').upsert({
    member_id: me.id, date, cycle_day: cycleDay,
    answers_enc: await encrypt(answers), score_enc: await encrypt(score), updated_at: new Date().toISOString(),
  }, { onConflict: 'member_id,date' });
  if (e2) throw e2;

  // 確認依頼：新しく増えたものだけ通知する
  const wanted: { to: string; note: string }[] = (Array.isArray(b.reviews) ? b.reviews : [])
    .filter((r: { to?: string; note?: string }) => r && r.to && r.note && r.to !== me.id)
    .map((r: { to: string; note: string }) => ({ to: r.to, note: text(r.note, 1000) }));
  const { data: existing } = await db.from('review_requests').select('id, to_member_id, note').eq('report_id', saved.id);
  const key = (to: string, note: string) => to + '\n' + note;
  const have = new Map((existing ?? []).map((r) => [key(r.to_member_id, r.note), r.id]));
  const want = new Set(wanted.map((w) => key(w.to, w.note)));
  const remove = (existing ?? []).filter((r) => !want.has(key(r.to_member_id, r.note))).map((r) => r.id);
  if (remove.length) await db.from('review_requests').delete().in('id', remove);
  const add = wanted.filter((w) => !have.has(key(w.to, w.note)));
  if (add.length) {
    const { data: targets } = await db.from('members').select('id, name, email, notify_email').in('id', add.map((a) => a.to)).eq('status', 'active');
    const byId = new Map((targets ?? []).map((t) => [t.id, t]));
    for (const a of add) {
      const t = byId.get(a.to);
      if (!t) continue;
      const { data: row } = await db.from('review_requests')
        .insert({ report_id: saved.id, from_member_id: me.id, to_member_id: t.id, date, note: a.note }).select('id').single();
      const ok = await sendMail(db, 'review', addr(t), `${me.name}さんから確認の依頼`,
        `${t.name}さん\n\n${me.name}さんから、確認の依頼が届いています（${fmtDate(date)}の日報）。\n\n${a.note}`, t.id);
      await sendChat(db, 'review', `${me.name}さんから${t.name}さんへ、確認の依頼があります（内容はメールで送りました）。`);
      if (ok && row) await db.from('review_requests').update({ notified_at: new Date().toISOString() }).eq('id', row.id);
    }
  }
  return json({ ok: true, date, cycle_day: cycleDay });
}));

/** その日に聞く質問の番号（1〜11）。その日の記録があればそのまま、なければ前回の次 */
async function cycleDayFor(db: ReturnType<typeof admin>, memberId: string, date: string): Promise<number> {
  const { data: same } = await db.from('stress_days').select('cycle_day').eq('member_id', memberId).eq('date', date).maybeSingle();
  if (same) return same.cycle_day;
  const { data: prev } = await db.from('stress_days').select('cycle_day').eq('member_id', memberId).lt('date', date)
    .order('date', { ascending: false }).limit(1).maybeSingle();
  return prev ? (prev.cycle_day % 11) + 1 : 1;
}
