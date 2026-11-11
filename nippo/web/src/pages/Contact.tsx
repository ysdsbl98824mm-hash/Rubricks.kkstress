import { useEffect, useState } from 'react';
import { api } from '../api';
import type { ContactData } from '../types';
import { dt } from '../util';
import { Status, errText } from '../ui';

const ROLE = { operator: '運用者', representative: '代表' } as const;

export default function Contact() {
  const [to, setTo] = useState<'operator' | 'representative'>('operator');
  const [body, setBody] = useState('');
  const [msg, setMsg] = useState<{ text: string; err?: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [d, setD] = useState<ContactData | null>(null);
  const reload = () => api.contact().then(setD).catch(() => {});
  useEffect(() => { reload(); }, []);

  async function send(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setMsg(null);
    try { await api.sendContact(to, body); setBody(''); setMsg({ text: `${ROLE[to]}に送りました。` }); reload(); }
    catch (err) { setMsg({ text: errText(err), err: true }); }
    setBusy(false);
  }

  return (
    <>
      <div className="sheet-head"><h1>連絡</h1><span className="meta">直接は言いにくいことも、ここから</span></div>
      <form onSubmit={send}>
        <section>
          <div className="row">
            <span className="label">宛先</span>
            <span className="yn" role="radiogroup">
              {(['operator', 'representative'] as const).map((r) => (
                <label key={r}><input type="radio" name="to" checked={to === r} onChange={() => setTo(r)} /><span>{ROLE[r]}</span></label>
              ))}
            </span>
          </div>
          <div className="row">
            <label className="label" htmlFor="body">内容</label>
            <div>
              <textarea id="body" style={{ minHeight: 140 }} value={body} onChange={(e) => setBody(e.target.value)} placeholder="体調や負担のこと、タスクの量、このアプリのことなど" />
              <span className="small muted">本文は暗号化して保存し、宛先の立場の人だけが読めます。相手にはメールで「連絡が届いた」ことだけを知らせます。</span>
            </div>
          </div>
          <div className="actions"><button className="btn" disabled={busy || !body.trim()}>送る</button><Status msg={msg} /></div>
        </section>
      </form>

      {d && d.can_receive.length > 0 && (
        <section>
          <div className="sec-title"><h2>届いた連絡</h2><span className="aside">{d.can_receive.map((r) => ROLE[r as keyof typeof ROLE]).join('・')}宛て</span></div>
          {d.inbox.length === 0 ? <p className="small muted">ありません。</p> : (
            <ul className="plain-list">
              {d.inbox.map((m) => (
                <li key={m.id}>
                  <div className="inline small">
                    {!m.read_at && <span className="tag shu">未読</span>}
                    <span className="num">{dt(m.created_at)}</span><span>{m.from}さん → {ROLE[m.to_role]}</span>
                    {!m.read_at && <button className="link" onClick={async () => { await api.markRead(m.id); reload(); }}>読んだ</button>}
                  </div>
                  <div style={{ whiteSpace: 'pre-wrap', marginTop: 4 }}>{m.body}</div>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {d && d.sent.length > 0 && (
        <section>
          <div className="sec-title"><h2>送った連絡</h2></div>
          <ul className="plain-list">
            {d.sent.map((m) => (
              <li key={m.id}>
                <div className="small muted"><span className="num">{dt(m.created_at)}</span>　{ROLE[m.to_role]}宛て　{m.read_at ? '読まれました' : '未読'}</div>
                <div style={{ whiteSpace: 'pre-wrap' }}>{m.body}</div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <div className="sec-title"><h2>つらいとき</h2></div>
        <div className="doc small">
          <p>段階や返事を待たずに、身近な人や、大学の学生相談室・保健センター、職場や地域の相談窓口に相談してください。</p>
          <table className="ledger">
            <tbody>
              <tr><td>よりそいホットライン</td><td className="num">0120-279-338</td><td>24時間・無料</td></tr>
              <tr><td>#いのちSOS</td><td className="num">0120-061-338</td><td>24時間・無料</td></tr>
              <tr><td>いのちの電話</td><td className="num">0120-783-556</td><td>毎日16時〜21時・無料</td></tr>
            </tbody>
          </table>
          <p style={{ marginTop: 8 }}>命の危険があるとき、今すぐ危ないときは、119番か110番に電話してください。</p>
        </div>
      </section>
    </>
  );
}
