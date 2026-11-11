import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.49.4';

export const cors = {
  'Access-Control-Allow-Origin': Deno.env.get('APP_ORIGIN') ?? '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json; charset=utf-8' } });
}

export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export function admin(): SupabaseClient {
  return createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export type Member = {
  id: string; name: string; email: string; notify_email: string | null;
  is_operator: boolean; is_representative: boolean; status: string; consent_at: string | null;
  auth_user_id: string | null; retired_at: string | null; sheet_id: string | null;
};

/** ログインしている人（在籍中のメンバー）を返す。いなければ 401/403 */
export async function caller(req: Request, db: SupabaseClient, opts: { consent?: boolean } = {}): Promise<Member> {
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!token) throw new HttpError(401, 'ログインしてください');
  const { data, error } = await db.auth.getUser(token);
  if (error || !data.user) throw new HttpError(401, 'ログインしてください');
  const { data: m } = await db.from('members').select('*').eq('auth_user_id', data.user.id).eq('status', 'active').maybeSingle();
  if (!m) throw new HttpError(403, 'メンバーとして登録されていません');
  if (opts.consent !== false && !m.consent_at) throw new HttpError(403, '同意が必要です');
  return m as Member;
}

export function checkCron(req: Request) {
  const secret = Deno.env.get('CRON_SECRET');
  if (!secret || req.headers.get('x-cron-secret') !== secret) throw new HttpError(401, 'unauthorized');
}

export function handler(fn: (req: Request) => Promise<Response>) {
  return async (req: Request): Promise<Response> => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
    try {
      return await fn(req);
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.message }, e.status);
      console.error(e);
      return json({ error: 'サーバーでエラーが起きました' }, 500);
    }
  };
}

export const addr = (m: Pick<Member, 'email' | 'notify_email'>) => m.notify_email || m.email;
