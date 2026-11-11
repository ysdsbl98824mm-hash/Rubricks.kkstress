// タスク管理シート（01_組織マスタ）のメンバーを読み込んで、アプリのメンバーとそろえる。
// シート側の Apps Script（doGet）を Web アプリとして公開し、その URL を SHEET_SYNC_URL に入れる。
import { admin, caller, checkCron, handler, json, HttpError } from '../_shared/http.ts';
import { todayJST } from '../_shared/judge.ts';

type SheetMember = { id: string; name: string; email: string; state: string };

Deno.serve(handler(async (req) => {
  const db = admin();
  if (req.headers.get('x-cron-secret')) checkCron(req);
  else {
    const me = await caller(req, db);
    if (!me.is_operator) throw new HttpError(403, '運用者だけが使えます');
  }
  const url = Deno.env.get('SHEET_SYNC_URL');
  const token = Deno.env.get('SHEET_SYNC_TOKEN');
  if (!url || !token) throw new HttpError(400, 'SHEET_SYNC_URL と SHEET_SYNC_TOKEN が設定されていません');
  const res = await fetch(`${url}?token=${encodeURIComponent(token)}`, { redirect: 'follow' });
  if (!res.ok) throw new HttpError(502, `シートを読めませんでした（${res.status}）`);
  const body = await res.json();
  if (!Array.isArray(body.members)) throw new HttpError(502, body.error ?? 'シートの返事の形が違います');

  const { data: current } = await db.from('members').select('id, sheet_id, email, name, status');
  const bySheet = new Map((current ?? []).filter((m) => m.sheet_id).map((m) => [m.sheet_id, m]));
  const byEmail = new Map((current ?? []).map((m) => [m.email, m]));
  const out = { added: 0, updated: 0, retired: 0, skipped: [] as string[] };

  for (const s of body.members as SheetMember[]) {
    const email = String(s.email ?? '').trim().toLowerCase();
    if (!email) { out.skipped.push(`${s.name}（メールなし）`); continue; }
    const hit = (s.id && bySheet.get(s.id)) || byEmail.get(email);
    const retired = s.state === '退任';
    if (!hit) {
      if (retired) continue;
      const { error } = await db.from('members').insert({ name: s.name, email, sheet_id: s.id || null });
      if (error) out.skipped.push(`${s.name}（${error.message}）`); else out.added++;
      continue;
    }
    const patch: Record<string, unknown> = { name: s.name, email, sheet_id: s.id || null };
    if (retired && hit.status === 'active') { patch.status = 'retired'; patch.retired_at = todayJST(); out.retired++; }
    const { error } = await db.from('members').update(patch).eq('id', hit.id);
    if (error) out.skipped.push(`${s.name}（${error.message}）`); else out.updated++;
  }
  return json(out);
}));
