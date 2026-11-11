// 毎朝の処理（pg_cron から呼ぶ）：前日分の判定 → 通知 → 古いデータの消去・退任者の確認
import { admin, checkCron, handler, json, addr, type Member } from '../_shared/http.ts';
import { encrypt } from '../_shared/crypto.ts';
import {
  addDays, addMonths, daysBetween, todayJST, judge, baselineActions, applyBaselineActions,
  shouldNotifyPerson, shouldNotifyOperator, dangerStreak, STAGE_NAMES, type StageRow,
} from '../_shared/judge.ts';
import { loadSettings, loadRates, loadBaselines, fmtDate } from '../_shared/data.ts';
import { sendMail, SUPPORT_TEXT } from '../_shared/notify.ts';

const ADVICE = [
  'いまの調子を保てています。',
  '少し偏りが出ています。睡眠と休憩を意識してみてください。',
  '疲れやストレスがたまっています。できれば作業の量を減らし、休む時間を取ってください。',
  '危険な状態です。運用者がタスクの量を調整することがあります。無理をせず、休むことを考えてください。',
  'すぐに休んでください。今日の予定は、できるだけ減らしてください。',
];

Deno.serve(handler(async (req) => {
  checkCron(req);
  const db = admin();
  const body = req.method === 'POST' ? await req.json().catch(() => ({})) : {};
  const date: string = typeof body.date === 'string' ? body.date : addDays(todayJST(), -1);
  const s = await loadSettings(db);

  const { data: members } = await db.from('members').select('*').eq('status', 'active').not('consent_at', 'is', null);
  const all = (members ?? []) as Member[];
  const operators = all.filter((m) => m.is_operator);
  const results: Record<string, unknown>[] = [];

  for (const m of all) {
    const rates = await loadRates(db, m.id);
    const { data: reps } = await db.from('daily_reports').select('date, sleep_hours').eq('member_id', m.id)
      .gte('date', addDays(date, -(s.sleep_window_days - 1))).lte('date', date).not('sleep_hours', 'is', null);
    const sleep = (reps ?? []).map((r) => ({ date: r.date, hours: Number(r.sleep_hours) }));
    const { data: rests } = await db.from('rests').select('start_date, end_date').eq('member_id', m.id);

    // 基準（B）を更新
    let baselines = await loadBaselines(db, m.id);
    const acts = baselineActions(baselines, rates, rests ?? [], date, s);
    for (const a of acts) {
      if (a.type === 'create') await db.from('baselines').upsert({ member_id: m.id, start_date: a.start_date, kind: a.kind }, { onConflict: 'member_id,start_date' });
      else await db.from('baselines').update({ value_enc: await encrypt(a.value), fixed_on: a.fixed_on }).eq('member_id', m.id).eq('start_date', a.start_date);
    }
    baselines = applyBaselineActions(baselines, acts);

    const j = judge(date, rates, sleep, baselines, s);
    const { data: hist } = await db.from('stages').select('date, stage, raised').eq('member_id', m.id)
      .lt('date', date).gte('date', addDays(date, -60)).order('date', { ascending: false });
    const history = (hist ?? []) as StageRow[];
    const prev = history.find((h) => h.stage !== null);

    await db.from('stages').upsert({
      member_id: m.id, date, stage: j.stage, held: j.held, raised: j.raised, baseline_high: j.baselineState === 'high',
    }, { onConflict: 'member_id,date' });

    if (!j.held && j.stage !== null) {
      const name = STAGE_NAMES[j.stage];
      if (shouldNotifyPerson(prev, j)) {
        await sendMail(db, 'stage', addr(m), `段階のお知らせ（${fmtDate(date)}）`,
          `${m.name}さん\n\n直近7日間の回答から、いまの段階は「${name}」です。` +
          (j.raised ? '\nふだんのあなたの状態と比べて、悪化が続いています。' : '') +
          `\n${ADVICE[j.stage]}\n\n点数や回答は、あなた以外には届いていません。\n\n${SUPPORT_TEXT}`, m.id);
      }
      if (shouldNotifyOperator(history, j, s)) {
        const days = dangerStreak(history, date);
        const high = j.baselineState === 'high' ? '\n※この人は、最初の基準が高めです。' : '';
        const others = operators.filter((o) => o.id !== m.id);
        if (m.is_operator || others.length === 0) {
          // 運用者本人が危険のとき：本人が登録した通知先へ
          await sendMail(db, 'self_danger', addr(m), `あなたの段階が「${name}」です`,
            `${m.name}さん\n\nあなた（運用者）の段階が「${name}」の状態が${days}日続いています。\n` +
            `ご自身のタスクを減らすことを考えてください。必要なら、アプリの「連絡」から代表に相談できます。\n\n${SUPPORT_TEXT}`, m.id);
        }
        for (const o of others) {
          await sendMail(db, 'danger', addr(o), `${m.name}さんが「${name}」です`,
            `${o.name}さん\n\n${m.name}さんの段階が「${name}」の状態が${days}日続いています。${high}\n` +
            `タスクの振り直しを検討してください。振り直したら、アプリの「運用」から記録すると、代表に事後通知が届きます。\n\n` +
            `点数と回答は、この通知には含まれません。`, m.id);
        }
      }
    }
    results.push({ member: m.name, held: j.held, stage: j.stage });
  }

  const cleanup = await housekeeping(db, todayJST(), s.retention_months, s.retired_remind_days);
  return json({ date, judged: results.length, cleanup });
}));

async function housekeeping(db: ReturnType<typeof admin>, today: string, months: number, remindDays: number) {
  const cut = addMonths(today, -months);
  const out: Record<string, number> = {};
  for (const t of ['daily_reports', 'stress_days', 'stages', 'review_requests']) {
    const { count } = await db.from(t).delete({ count: 'exact' }).lt('date', cut);
    out[t] = count ?? 0;
  }
  const { count: c1 } = await db.from('contact_messages').delete({ count: 'exact' }).lt('created_at', cut);
  const { count: c2 } = await db.from('notifications_log').delete({ count: 'exact' }).lt('at', cut);
  out.contact_messages = c1 ?? 0; out.notifications_log = c2 ?? 0;

  // 退任から30日たった人：運用者と代表に、消去の判断をお願いする（その後も週1回）
  const { data: retired } = await db.from('members').select('id, name, retired_at').eq('status', 'retired').not('retired_at', 'is', null);
  const { data: staff } = await db.from('members').select('*').eq('status', 'active').or('is_operator.eq.true,is_representative.eq.true');
  for (const r of retired ?? []) {
    const d = daysBetween(r.retired_at, today);
    if (d < remindDays || (d - remindDays) % 7 !== 0) continue;
    for (const st of (staff ?? []) as Member[]) {
      await sendMail(db, 'retired', addr(st), `${r.name}さんのデータの消去`,
        `${st.name}さん\n\n${r.name}さんが退任してから${d}日たちました。データの消去を判断してください。\n` +
        `運用者がアプリの「運用」から消去を申請し、代表が承認すると消去されます。`);
    }
  }
  return out;
}
