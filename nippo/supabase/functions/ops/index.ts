// 運用者・代表の操作：メンバーの管理、休息の記録、振り直しの記録（代表へ事後通知）、退任者のデータ消去
import { admin, caller, handler, json, HttpError, addr, type Member } from '../_shared/http.ts';
import { todayJST, STAGE_NAMES } from '../_shared/judge.ts';
import { sendMail } from '../_shared/notify.ts';

Deno.serve(handler(async (req) => {
  const db = admin();
  const me = await caller(req, db);
  if (!me.is_operator && !me.is_representative) throw new HttpError(403, '運用者か代表だけが使えます');

  if (req.method === 'GET') {
    const { data: members } = await db.from('members')
      .select('id, name, email, notify_email, is_operator, is_representative, status, retired_at, consent_at, sheet_id, auth_user_id')
      .order('status').order('name');
    // 危険以上の人：最新の判定日で、段階が3以上の行だけ（点数は読まない）
    const { data: last } = await db.from('stages').select('date').order('date', { ascending: false }).limit(1).maybeSingle();
    let danger: unknown[] = [];
    if (last && me.is_operator) {
      const { data } = await db.from('stages').select('member_id, date, stage, raised, baseline_high').eq('date', last.date).gte('stage', 3);
      const names = new Map((members ?? []).map((m) => [m.id, m.name]));
      danger = (data ?? []).map((d) => ({ ...d, name: names.get(d.member_id) ?? '', stage_name: STAGE_NAMES[d.stage as number] }));
    }
    const [rests, reassign, dels, logs, fails] = await Promise.all([
      db.from('rests').select('id, member_id, start_date, end_date').order('start_date', { ascending: false }).limit(50),
      db.from('reassignments').select('*').order('created_at', { ascending: false }).limit(30),
      db.from('deletion_requests').select('*').order('requested_at', { ascending: false }).limit(30),
      db.from('access_log').select('*').order('at', { ascending: false }).limit(50),
      db.from('notifications_log').select('at, kind, to_address, error').eq('ok', false).order('at', { ascending: false }).limit(20),
    ]);
    return json({
      me: { id: me.id, is_operator: me.is_operator, is_representative: me.is_representative },
      judged_date: last?.date ?? null,
      members: me.is_operator ? members : (members ?? []).map((m) => ({ id: m.id, name: m.name, status: m.status, retired_at: m.retired_at })),
      danger, rests: me.is_operator ? rests.data : [], reassignments: reassign.data, deletion_requests: dels.data,
      access_log: logs.data, failed_notifications: me.is_operator ? fails.data : [],
    });
  }

  if (req.method !== 'POST') throw new HttpError(405, 'method');
  const b = await req.json();
  const needOp = () => { if (!me.is_operator) throw new HttpError(403, '運用者だけが使えます'); };
  const date = (v: unknown) => { if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new HttpError(400, '日付が正しくありません'); return v; };

  switch (b.action) {
    case 'member_save': {
      needOp();
      const row = {
        name: String(b.name ?? '').trim(), email: String(b.email ?? '').trim().toLowerCase(),
        notify_email: b.notify_email ? String(b.notify_email).trim().toLowerCase() : null,
        is_operator: !!b.is_operator, is_representative: !!b.is_representative,
        sheet_id: b.sheet_id ? String(b.sheet_id).trim() : null,
      };
      if (!row.name || !/^[^@\s]+@[^@\s]+$/.test(row.email)) throw new HttpError(400, '名前とメールを入れてください');
      if (b.id === me.id && !row.is_operator) {
        const { count } = await db.from('members').select('id', { count: 'exact', head: true }).eq('status', 'active').eq('is_operator', true);
        if ((count ?? 0) <= 1) throw new HttpError(400, '運用者がいなくなるので、外せません');
      }
      const q = b.id ? db.from('members').update(row).eq('id', b.id) : db.from('members').insert(row);
      const { error } = await q;
      if (error) throw new HttpError(400, error.message.includes('duplicate') ? 'そのメールはもう登録されています' : error.message);
      return json({ ok: true });
    }
    case 'member_retire': {
      needOp();
      if (b.id === me.id) throw new HttpError(400, '自分は退任にできません');
      await db.from('members').update({ status: 'retired', retired_at: todayJST() }).eq('id', b.id).eq('status', 'active');
      return json({ ok: true });
    }
    case 'member_reactivate': {
      needOp();
      await db.from('members').update({ status: 'active', retired_at: null }).eq('id', b.id);
      return json({ ok: true });
    }
    case 'rest_start': {
      needOp();
      const { error } = await db.from('rests').insert({ member_id: b.member_id, start_date: date(b.start_date), created_by: me.id });
      if (error) throw error;
      return json({ ok: true });
    }
    case 'rest_end': {
      needOp();
      const { error } = await db.from('rests').update({ end_date: date(b.end_date) }).eq('id', b.id);
      if (error) throw new HttpError(400, '終了日は開始日より後にしてください');
      return json({ ok: true });
    }
    case 'reassign': {
      needOp();
      const { data: from } = await db.from('members').select('id, name').eq('id', b.from_member_id).maybeSingle();
      const to = String(b.to_names ?? '').trim();
      if (!from || !to) throw new HttpError(400, '誰から誰へ振り直したかを入れてください');
      const note = String(b.note ?? '').trim().slice(0, 1000);
      const { data: row, error } = await db.from('reassignments')
        .insert({ from_member_id: from.id, from_name: from.name, to_names: to, note, created_by: me.id }).select('id').single();
      if (error) throw error;
      const { data: reps } = await db.from('members').select('*').eq('status', 'active').eq('is_representative', true);
      let ok = false;
      for (const r of (reps ?? []) as Member[]) {
        ok = (await sendMail(db, 'reassign', addr(r), 'タスクの振り直し（事後通知）',
          `${r.name}さん\n\n${from.name}さんのタスクを、${to}さんに振り直しました。\n` +
          (note ? `メモ：${note}\n` : '') + `（運用者：${me.name}）`, r.id)) || ok;
      }
      if (ok) await db.from('reassignments').update({ notified_at: new Date().toISOString() }).eq('id', row.id);
      return json({ ok: true, notified: ok });
    }
    case 'deletion_request': {
      needOp();
      const { data: m } = await db.from('members').select('id, name, status').eq('id', b.member_id).maybeSingle();
      if (!m || m.status !== 'retired') throw new HttpError(400, '退任の人だけ消去を申請できます');
      const { data: open } = await db.from('deletion_requests').select('id').eq('member_id', m.id).is('executed_at', null).maybeSingle();
      if (open) throw new HttpError(400, 'もう申請しています');
      await db.from('deletion_requests').insert({ member_id: m.id, member_name: m.name, requested_by: me.id });
      const { data: reps } = await db.from('members').select('*').eq('status', 'active').eq('is_representative', true);
      for (const r of (reps ?? []) as Member[]) {
        await sendMail(db, 'retired', addr(r), `${m.name}さんのデータ消去の承認`,
          `${r.name}さん\n\n運用者の${me.name}さんが、${m.name}さんのデータの消去を申請しました。\nアプリの「運用」画面で承認すると、消去されます。`, r.id);
      }
      return json({ ok: true });
    }
    case 'deletion_approve': {
      if (!me.is_representative) throw new HttpError(403, '代表だけが承認できます');
      const { data: r } = await db.from('deletion_requests').select('*').eq('id', b.id).maybeSingle();
      if (!r || r.executed_at) throw new HttpError(400, '承認できる申請がありません');
      const { data: m } = await db.from('members').select('auth_user_id').eq('id', r.member_id).maybeSingle();
      await db.from('deletion_requests').update({ approved_by: me.id, approved_at: new Date().toISOString() }).eq('id', r.id);
      const { error } = await db.rpc('execute_member_deletion', { req: r.id });
      if (error) throw error;
      if (m?.auth_user_id) await db.auth.admin.deleteUser(m.auth_user_id);
      return json({ ok: true });
    }
    default:
      throw new HttpError(400, '不明な操作です');
  }
}));
