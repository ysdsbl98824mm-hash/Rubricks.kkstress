// 通知：メール（Resend）と、任意で Google チャット（非公開スペースの Webhook）
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.49.4';
import nodemailer from 'npm:nodemailer@6.9.16';

const APP_NAME = Deno.env.get('APP_NAME') ?? '日報';
const APP_URL = Deno.env.get('APP_URL') ?? '';

/**
 * メールを送る。設定の優先順：
 *  1. SMTP_USER と SMTP_PASS があれば SMTP（Gmail など。ドメイン不要）
 *  2. RESEND_API_KEY と MAIL_FROM があれば Resend（自分のドメインが要る）
 *  3. どちらもなければ送らず、内容を関数のログに出す
 */
export async function sendMail(
  db: SupabaseClient, kind: string, to: string, subject: string, text: string, memberId?: string,
): Promise<boolean> {
  let ok = false, error: string | null = null;
  const body = text + footer();
  const fullSubject = `[${APP_NAME}] ${subject}`;
  const smtpUser = Deno.env.get('SMTP_USER');
  const smtpPass = Deno.env.get('SMTP_PASS');
  const resendKey = Deno.env.get('RESEND_API_KEY');
  const from = Deno.env.get('MAIL_FROM') ?? (smtpUser ? `${APP_NAME} <${smtpUser}>` : undefined);
  try {
    if (smtpUser && smtpPass) {
      const port = Number(Deno.env.get('SMTP_PORT') ?? '465');
      const transport = nodemailer.createTransport({
        host: Deno.env.get('SMTP_HOST') ?? 'smtp.gmail.com', port, secure: port === 465,
        auth: { user: smtpUser, pass: smtpPass },
      });
      await transport.sendMail({ from, to, subject: fullSubject, text: body });
      ok = true;
    } else if (resendKey && from) {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from, to: [to], subject: fullSubject, text: body }),
      });
      ok = res.ok;
      if (!ok) error = `${res.status} ${(await res.text()).slice(0, 200)}`;
    } else {
      error = 'メールの設定がありません（SMTP_USER / SMTP_PASS）';
      console.log(`[mail:${kind}] ${to} / ${fullSubject}\n${body}`);
    }
  } catch (e) { error = String(e).slice(0, 200); }
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
