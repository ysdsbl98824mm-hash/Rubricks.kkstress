// 通知：メール（Resend）と、任意で Google チャット（非公開スペースの Webhook）
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.49.4';

const APP_NAME = Deno.env.get('APP_NAME') ?? '日報';
const APP_URL = Deno.env.get('APP_URL') ?? '';

export async function sendMail(
  db: SupabaseClient, kind: string, to: string, subject: string, text: string, memberId?: string,
): Promise<boolean> {
  const key = Deno.env.get('RESEND_API_KEY');
  const from = Deno.env.get('MAIL_FROM');
  let ok = false, error: string | null = null;
  if (!key || !from) {
    error = 'メールの設定がありません（RESEND_API_KEY / MAIL_FROM）';
    console.log(`[mail:${kind}] ${to} / ${subject}\n${text}`);
  } else {
    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from, to: [to], subject: `[${APP_NAME}] ${subject}`, text: text + footer() }),
      });
      ok = res.ok;
      if (!ok) error = `${res.status} ${(await res.text()).slice(0, 200)}`;
    } catch (e) { error = String(e).slice(0, 200); }
  }
  await db.from('notifications_log').insert({ kind, to_address: to, member_id: memberId ?? null, ok, error });
  return ok;
}

/** Google チャットの非公開スペースへ。設定が無ければ何もしない。名前や段階は送らない内容だけに使う */
export async function sendChat(db: SupabaseClient, kind: string, text: string): Promise<void> {
  const url = Deno.env.get('GOOGLE_CHAT_WEBHOOK_URL');
  if (!url) return;
  let ok = false, error: string | null = null;
  try {
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json; charset=UTF-8' }, body: JSON.stringify({ text }) });
    ok = res.ok; if (!ok) error = `${res.status}`;
  } catch (e) { error = String(e).slice(0, 200); }
  await db.from('notifications_log').insert({ kind, to_address: 'google-chat', ok, error });
}

function footer(): string {
  return `\n\n――\n${APP_NAME}${APP_URL ? `\n${APP_URL}` : ''}\nこのメールは自動で送っています。`;
}

export const SUPPORT_TEXT = `つらいときは、このメールの段階を待たずに相談してください。
・身近な人、大学の学生相談室・保健センター、職場や地域の相談窓口
・アプリの「連絡」から、代表か運用者に送れます
・電話（無料）：よりそいホットライン 0120-279-338（24時間）
               #いのちSOS 0120-061-338（24時間）
               いのちの電話 0120-783-556（毎日16時〜21時）
・命の危険があるとき、今すぐ危ないときは 119番か110番`;
