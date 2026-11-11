import { useState } from 'react';
import { api } from '../api';
import { Status, errText } from '../ui';

export default function Login({ onDone }: { onDone: () => void }) {
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; err?: boolean } | null>(null);

  async function send(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setMsg(null);
    try { await api.sendCode(email.trim()); setSent(true); setMsg({ text: 'メールを送りました。届いた6桁のコードを入れてください。' }); }
    catch (err) { setMsg({ text: errText(err), err: true }); }
    setBusy(false);
  }
  async function verify(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setMsg(null);
    try { await api.verifyCode(email.trim(), code.trim()); onDone(); }
    catch (err) { setMsg({ text: errText(err), err: true }); setBusy(false); }
  }

  return (
    <div className="center-sheet">
      <div className="title">日報</div>
      {!sent ? (
        <form onSubmit={send}>
          <div className="row"><label className="label" htmlFor="email">メール</label>
            <input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></div>
          <div className="actions"><button className="btn" disabled={busy || !email}>コードを送る</button><Status msg={msg} /></div>
          <p className="lead">登録したメールアドレスに、ログイン用のコードを送ります。パスワードはありません。</p>
        </form>
      ) : (
        <form onSubmit={verify}>
          <p className="small muted">{email}</p>
          <div className="row"><label className="label" htmlFor="code">コード</label>
            <input id="code" className="code-input" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} /></div>
          <div className="actions">
            <button className="btn" disabled={busy || code.length < 6}>ログイン</button>
            <button type="button" className="link" onClick={() => { setSent(false); setCode(''); setMsg(null); }}>メールアドレスを直す</button>
          </div>
          <Status msg={msg} />
          <p className="lead">メールのリンクを押してもログインできます。</p>
        </form>
      )}
    </div>
  );
}
