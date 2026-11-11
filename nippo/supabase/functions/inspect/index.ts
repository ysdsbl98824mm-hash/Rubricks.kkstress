// 内部の確認：運用者が、理由を書いて、ある人の中身（日報・回答・点数）を読む。
// 読むたびに履歴が残り、本人と代表にメールが届く。
import { admin, caller, handler, json, HttpError, addr, type Member } from '../_shared/http.ts';
import { decrypt } from '../_shared/crypto.ts';
import { daysBetween, todayJST } from '../_shared/judge.ts';
import { fmtDate } from '../_shared/data.ts';
import { sendMail } from '../_shared/notify.ts';

Deno.serve(handler(async (req) => {
  const db = admin();
  const me = await caller(req, db);
  if (!me.is_operator) throw new HttpError(403, '運用者だけが使えます');
  if (req.method !== 'POST') throw new HttpError(405, 'method');
  const b = await req.json();
  const reason = String(b.reason ?? '').trim();
  const from = String(b.from ?? ''), to = String(b.to ?? '');
  if (reason.length < 5) throw new HttpError(400, '理由を5文字以上で書いてください');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) throw new HttpError(400, '期間が正しくありません');
  if (daysBetween(from, to) > 30) throw new HttpError(400, '一度に確認できるのは31日分までです');
  if (to > todayJST()) throw new HttpError(400, '期間が正しくありません');

  const { data: target } = await db.from('members').select('*').eq('id', b.member_id).maybeSingle();
  if (!target) throw new HttpError(404, 'メンバーが見つかりません');

  // 先に履歴を残す。残せなければ中身は返さない
  const { data: log, error } = await db.from('access_log').insert({
    actor_member_id: me.id, actor_name: me.name, target_member_id: target.id, target_name: target.name,
    range_from: from, range_to: to, reason,
  }).select('id').single();
  if (error || !log) throw new HttpError(500, '履歴を残せなかったので、確認を中止しました');

  const range = `${fmtDate(from)}〜${fmtDate(to)}`;
  let notified = await sendMail(db, 'inspect', addr(target as Member), '記録の中身が確認されました',
    `${target.name}さん\n\n運用者の${me.name}さんが、あなたの記録（${range}）の中身を確認しました。\n理由：${reason}\n\n` +
    `この確認の履歴は、アプリの「記録」画面の下にある「内部の確認の履歴」から見られます。`, target.id);
  const { data: reps } = await db.from('members').select('*').eq('status', 'active').eq('is_representative', true);
  for (const r of (reps ?? []) as Member[]) {
    if (r.id === target.id) continue;
    await sendMail(db, 'inspect', addr(r), '内部の確認がありました',
      `${r.name}さん\n\n運用者の${me.name}さんが、${target.name}さんの記録（${range}）の中身を確認しました。\n理由：${reason}`, r.id);
  }
  if (notified) await db.from('access_log').update({ notified: true }).eq('id', log.id);

  const [reps2, sds, qs] = await Promise.all([
    db.from('daily_reports').select('*').eq('member_id', target.id).gte('date', from).lte('date', to).order('date'),
    db.from('stress_days').select('date, answers_enc, score_enc').eq('member_id', target.id).gte('date', from).lte('date', to),
    db.from('questions').select('id, text'),
  ]);
  const qtext = new Map((qs.data ?? []).map((q) => [q.id, q.text]));
  const sd = new Map<string, { score: number | null; answers: { text: string; p: number }[] }>();
  for (const s of sds.data ?? []) {
    const answers = ((await decrypt<{ q: string; p: number }[]>(s.answers_enc)) ?? []).map((a) => ({ text: qtext.get(a.q) ?? a.q, p: a.p }));
    sd.set(s.date, { score: await decrypt<number>(s.score_enc), answers });
  }
  const days = [];
  for (const r of reps2.data ?? []) {
    const { feelings_enc, ...rest } = r;
    days.push({ ...rest, feelings: (await decrypt<string>(feelings_enc)) ?? '', stress: sd.get(r.date) ?? null });
  }
  notified = notified || false;
  return json({ target: { id: target.id, name: target.name }, from, to, notified, days });
}));
