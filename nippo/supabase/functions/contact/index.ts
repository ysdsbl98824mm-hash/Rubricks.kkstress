// 連絡フォーム：代表か運用者に送る。本文は暗号化して保存し、受け取る立場の人だけが読める。
import { admin, caller, handler, json, HttpError, addr, type Member } from '../_shared/http.ts';
import { encrypt, decrypt } from '../_shared/crypto.ts';
import { sendMail } from '../_shared/notify.ts';

const ROLE_NAME = { operator: '運用者', representative: '代表' } as const;

Deno.serve(handler(async (req) => {
  const db = admin();
  const me = await caller(req, db, { consent: false });

  if (req.method === 'GET') {
    const roles = [me.is_operator && 'operator', me.is_representative && 'representative'].filter(Boolean) as string[];
    const inbox = [];
    if (roles.length) {
      const { data } = await db.from('contact_messages').select('id, to_role, body_enc, read_at, created_at, members(name)')
        .in('to_role', roles).neq('from_member_id', me.id).order('created_at', { ascending: false }).limit(100);
      for (const m of data ?? []) {
        // deno-lint-ignore no-explicit-any
        inbox.push({ id: m.id, to_role: m.to_role, from: (m as any).members?.name ?? '', read_at: m.read_at, created_at: m.created_at, body: await decrypt<string>(m.body_enc) });
      }
    }
    const { data: sentRows } = await db.from('contact_messages').select('id, to_role, body_enc, read_at, created_at')
      .eq('from_member_id', me.id).order('created_at', { ascending: false }).limit(50);
    const sent = [];
    for (const m of sentRows ?? []) sent.push({ id: m.id, to_role: m.to_role, read_at: m.read_at, created_at: m.created_at, body: await decrypt<string>(m.body_enc) });
    return json({ can_receive: roles, inbox, sent });
  }

  if (req.method !== 'POST') throw new HttpError(405, 'method');
  const b = await req.json();
  if (b.action === 'read') {
    const { data: m } = await db.from('contact_messages').select('id, to_role').eq('id', b.id).maybeSingle();
    if (!m || !((m.to_role === 'operator' && me.is_operator) || (m.to_role === 'representative' && me.is_representative))) throw new HttpError(403, '読めません');
    await db.from('contact_messages').update({ read_at: new Date().toISOString() }).eq('id', b.id).is('read_at', null);
    return json({ ok: true });
  }

  const role = b.to_role as keyof typeof ROLE_NAME;
  if (!(role in ROLE_NAME)) throw new HttpError(400, '宛先を選んでください');
  const body = String(b.body ?? '').trim().slice(0, 4000);
  if (!body) throw new HttpError(400, '内容を書いてください');
  const { error } = await db.from('contact_messages').insert({ from_member_id: me.id, to_role: role, body_enc: await encrypt(body) });
  if (error) throw error;

  const col = role === 'operator' ? 'is_operator' : 'is_representative';
  const { data: to } = await db.from('members').select('*').eq('status', 'active').eq(col, true);
  const list = ((to ?? []) as Member[]).filter((m) => m.id !== me.id);
  for (const m of list) {
    await sendMail(db, 'contact', addr(m), '連絡フォームに連絡が届きました',
      `${m.name}さん\n\n${me.name}さんから、${ROLE_NAME[role]}宛ての連絡が届きました。\n内容は、アプリの「連絡」画面で読めます（メールには載せていません）。`, m.id);
  }
  return json({ ok: true, delivered: list.length });
}));
