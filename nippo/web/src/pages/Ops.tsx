import { useEffect, useState } from 'react';
import { api } from '../api';
import type { InspectResult, MemberRow, OpsData } from '../types';
import { addDays, dt, md, today } from '../util';
import { StageMark, Status, errText } from '../ui';

type Msg = { text: string; err?: boolean } | null;
const empty = { id: '', name: '', email: '', notify_email: '', is_operator: false, is_representative: false, sheet_id: '' };

export default function Ops() {
  const [d, setD] = useState<OpsData | null>(null);
  const [err, setErr] = useState('');
  const reload = () => api.ops().then(setD).catch((e) => setErr(errText(e)));
  useEffect(() => { reload(); }, []);
  if (err) return <p className="status err" style={{ paddingTop: 20 }}>{err}</p>;
  if (!d) return <p className="muted" style={{ paddingTop: 20 }}>読み込み中…</p>;
  const active = d.members.filter((m) => m.status === 'active');

  return (
    <>
      <div className="sheet-head"><h1>運用</h1><span className="meta">{d.me.is_operator ? '運用者' : ''}{d.me.is_operator && d.me.is_representative ? '・' : ''}{d.me.is_representative ? '代表' : ''}</span></div>

      {d.me.is_operator && (
        <section>
          <div className="sec-title"><h2>「危険」以上の人</h2><span className="aside">{d.judged_date ? `${md(d.judged_date)}の判定` : 'まだ判定がありません'}</span></div>
          {d.danger.length === 0 ? <p className="small muted">いません。</p> : (
            <table className="ledger"><tbody>
              {d.danger.map((x) => (
                <tr key={x.member_id}>
                  <td>{x.name}</td>
                  <td><StageMark value={x.stage} name={x.stage_name} /></td>
                  <td className="small muted">{x.raised ? '本人の基準から悪化' : ''}{x.baseline_high ? '基準が高め' : ''}</td>
                </tr>
              ))}
            </tbody></table>
          )}
          <p className="small muted" style={{ marginTop: 8 }}>ここに出るのは名前と段階だけです。点数と回答は表示しません。</p>
        </section>
      )}

      {d.me.is_operator && <Reassign members={active} onDone={reload} />}

      {(d.reassignments?.length ?? 0) > 0 && (
        <section>
          <div className="sec-title"><h2>振り直しの記録</h2></div>
          <ul className="plain-list">
            {d.reassignments.map((r) => (
              <li key={r.id}>
                <span className="num small muted">{dt(r.created_at)}</span>　{r.from_name}さん → {r.to_names}さん
                {r.note && <div className="small muted">{r.note}</div>}
                {!r.notified_at && <div className="small" style={{ color: 'var(--shu)' }}>代表への通知が届いていません</div>}
              </li>
            ))}
          </ul>
        </section>
      )}

      {d.me.is_operator && <Rests d={d} onDone={reload} />}
      {d.me.is_operator && <Inspect members={active} />}
      {d.me.is_operator && <Members d={d} onDone={reload} />}
      <Deletions d={d} onDone={reload} />

      <section>
        <div className="sec-title"><h2>内部の確認の履歴</h2><span className="aside">消せません</span></div>
        {d.access_log.length === 0 ? <p className="small muted">ありません。</p> : (
          <div className="scroll-x"><table className="ledger">
            <thead><tr><th>日時</th><th>確認した人</th><th>対象</th><th>期間</th><th>理由</th></tr></thead>
            <tbody>
              {d.access_log.map((l, i) => (
                <tr key={i}><td className="num">{dt(l.at)}</td><td className="nw">{l.actor_name}</td><td className="nw">{l.target_name}</td><td className="num">{md(l.range_from)}〜{md(l.range_to)}</td><td style={{ minWidth: '14em' }}>{l.reason}{l.notified === false && <span className="tag shu" style={{ marginLeft: 6 }}>本人に未通知</span>}</td></tr>
              ))}
            </tbody>
          </table></div>
        )}
      </section>

      {d.failed_notifications.length > 0 && (
        <section>
          <div className="sec-title"><h2>届かなかった通知</h2></div>
          <ul className="plain-list">
            {d.failed_notifications.map((f, i) => <li key={i} className="small"><span className="num">{dt(f.at)}</span>　{f.kind}　{f.to_address}<div className="muted">{f.error}</div></li>)}
          </ul>
        </section>
      )}
    </>
  );
}

function Reassign({ members, onDone }: { members: MemberRow[]; onDone: () => void }) {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [note, setNote] = useState('');
  const [msg, setMsg] = useState<Msg>(null);
  async function go(e: React.FormEvent) {
    e.preventDefault(); setMsg(null);
    try {
      const r = await api.opsAction('reassign', { from_member_id: from, to_names: to, note }) as { notified?: boolean };
      setMsg({ text: r.notified === false ? '記録しました。代表へのメールは届きませんでした。' : '記録して、代表に事後通知を送りました。' });
      setFrom(''); setTo(''); setNote(''); onDone();
    } catch (err) { setMsg({ text: errText(err), err: true }); }
  }
  return (
    <section>
      <div className="sec-title"><h2>タスクを振り直したら</h2><span className="aside">代表に事後通知が届きます</span></div>
      <form onSubmit={go}>
        <div className="row"><label className="label" htmlFor="rf">誰のタスクを</label>
          <select id="rf" value={from} onChange={(e) => setFrom(e.target.value)}><option value="">選ぶ</option>{members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select></div>
        <div className="row"><label className="label" htmlFor="rt">誰に</label>
          <input id="rt" type="text" value={to} onChange={(e) => setTo(e.target.value)} placeholder="複数なら「、」で区切る" /></div>
        <div className="row"><label className="label" htmlFor="rn">メモ</label>
          <input id="rn" type="text" value={note} onChange={(e) => setNote(e.target.value)} placeholder="どのタスクか（段階や体調のことは書かない）" /></div>
        <div className="actions"><button className="btn small" disabled={!from || !to.trim()}>記録して通知</button><Status msg={msg} /></div>
      </form>
    </section>
  );
}

function Rests({ d, onDone }: { d: OpsData; onDone: () => void }) {
  const [member, setMember] = useState('');
  const [start, setStart] = useState(today());
  const [msg, setMsg] = useState<Msg>(null);
  const name = (id: string) => d.members.find((m) => m.id === id)?.name ?? '';
  const open = d.rests.filter((r) => !r.end_date);
  async function act(action: string, body: Record<string, unknown>, done: string) {
    setMsg(null);
    try { await api.opsAction(action, body); setMsg({ text: done }); onDone(); } catch (e) { setMsg({ text: errText(e), err: true }); }
  }
  return (
    <section>
      <div className="sec-title"><h2>休息</h2><span className="aside">休息が明けると、その人の基準を取り直します</span></div>
      {open.length > 0 && (
        <ul className="plain-list">
          {open.map((r) => (
            <li key={r.id} className="inline">
              <span>{name(r.member_id)}さん　{md(r.start_date)}から休息中</span>
              <button className="link" onClick={() => act('rest_end', { id: r.id, end_date: addDays(today(), -1) }, '休息の終わりを記録しました。')}>昨日で終わりにする</button>
            </li>
          ))}
        </ul>
      )}
      <div className="row"><span className="label">休息を始める</span>
        <span className="inline">
          <select className="narrow" aria-label="メンバー" value={member} onChange={(e) => setMember(e.target.value)}><option value="">選ぶ</option>{d.members.filter((m) => m.status === 'active').map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select>
          <input type="date" aria-label="開始日" value={start} onChange={(e) => setStart(e.target.value)} />
          <button className="btn small ghost" disabled={!member} onClick={() => act('rest_start', { member_id: member, start_date: start }, '休息を記録しました。')}>記録</button>
        </span>
      </div>
      <Status msg={msg} />
    </section>
  );
}

function Inspect({ members }: { members: MemberRow[] }) {
  const [member, setMember] = useState('');
  const [from, setFrom] = useState(addDays(today(), -13));
  const [to, setTo] = useState(today());
  const [reason, setReason] = useState('');
  const [agree, setAgree] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);
  const [res, setRes] = useState<InspectResult | null>(null);
  async function go(e: React.FormEvent) {
    e.preventDefault(); setMsg(null); setRes(null);
    try { const r = await api.inspect(member, from, to, reason); setRes(r); setAgree(false); setMsg({ text: r.notified ? '履歴を残し、本人に知らせました。' : '履歴は残しましたが、本人へのメールが届きませんでした。', err: !r.notified }); }
    catch (err) { setMsg({ text: errText(err), err: true }); }
  }
  return (
    <section>
      <div className="sec-title"><h2>内部の確認</h2><span className="aside">中身（点数・回答・感じたこと）を見る</span></div>
      <p className="notice shu">確認すると、履歴が残り、本人と代表にメールが届きます。本人の同意があるときや、命や健康に関わるときに限って使ってください。</p>
      <form onSubmit={go}>
        <div className="row"><label className="label" htmlFor="im">対象</label>
          <select id="im" value={member} onChange={(e) => setMember(e.target.value)}><option value="">選ぶ</option>{members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select></div>
        <div className="row"><span className="label">期間</span>
          <span className="inline"><input type="date" aria-label="から" value={from} onChange={(e) => setFrom(e.target.value)} /><span className="muted">〜</span><input type="date" aria-label="まで" value={to} onChange={(e) => setTo(e.target.value)} /><span className="small muted">31日まで</span></span></div>
        <div className="row"><label className="label" htmlFor="ir">理由<span className="req">*</span></label>
          <textarea id="ir" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="本人に届くメールにも、この理由が載ります" /></div>
        <div className="actions">
          <label className="inline small"><input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} />履歴が残り、本人と代表に知らせることを確認しました</label>
        </div>
        <div className="actions"><button className="btn small" disabled={!member || reason.trim().length < 5 || !agree}>確認する</button><Status msg={msg} /></div>
      </form>
      {res && (
        <div className="box">
          <p><b>{res.target.name}</b>さん　{md(res.from)}〜{md(res.to)}</p>
          {res.days.length === 0 && <p className="muted">この期間の記録はありません。</p>}
          {res.days.map((x) => (
            <div key={x.date} style={{ padding: '8px 0', borderTop: '1px solid var(--rule-2)' }}>
              <div className="small"><b className="num">{md(x.date)}</b>{x.stress?.score != null && <span className="num muted">　{x.stress.score} / 32</span>}</div>
              <div className="small" style={{ whiteSpace: 'pre-wrap' }}>{x.did}</div>
              {x.feelings && <div className="small muted" style={{ whiteSpace: 'pre-wrap' }}>感じたこと：{x.feelings}</div>}
              {x.stress && <ul className="answers">{x.stress.answers.map((a, i) => <li key={i}><span>{a.text}</span><b className="num">{a.p}</b></li>)}</ul>}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function Members({ d, onDone }: { d: OpsData; onDone: () => void }) {
  const [f, setF] = useState(empty);
  const [msg, setMsg] = useState<Msg>(null);
  async function save(e: React.FormEvent) {
    e.preventDefault(); setMsg(null);
    try { await api.opsAction('member_save', { ...f, id: f.id || undefined }); setMsg({ text: '保存しました。' }); setF(empty); onDone(); }
    catch (err) { setMsg({ text: errText(err), err: true }); }
  }
  async function act(action: string, id: string, done: string) {
    setMsg(null);
    try { await api.opsAction(action, { id }); setMsg({ text: done }); onDone(); } catch (e) { setMsg({ text: errText(e), err: true }); }
  }
  async function sync() {
    setMsg(null);
    try { const r = await api.syncMembers(); setMsg({ text: `シートと同期しました（追加${r.added}・更新${r.updated}・退任${r.retired}${r.skipped.length ? `・とばした${r.skipped.length}：${r.skipped.join('、')}` : ''}）` }); onDone(); }
    catch (e) { setMsg({ text: errText(e), err: true }); }
  }
  return (
    <section>
      <div className="sec-title"><h2>メンバー</h2><span className="aside">{d.members.filter((m) => m.status === 'active').length}人在籍</span></div>
      <div className="scroll-x"><table className="ledger">
        <thead><tr><th>名前</th><th>メール</th><th>立場</th><th>状態</th><th></th></tr></thead>
        <tbody>
          {d.members.map((m) => (
            <tr key={m.id}>
              <td className="nw">{m.name}</td>
              <td className="small">{m.email}{m.notify_email && <div className="muted">通知：{m.notify_email}</div>}</td>
              <td className="small">{m.is_operator && <span className="tag">運用者</span>}{m.is_representative && <span className="tag">代表</span>}</td>
              <td className="small nw">{m.status === 'retired' ? `退任 ${m.retired_at ? md(m.retired_at) : ''}` : !m.auth_user_id ? '未ログイン' : !m.consent_at ? '未同意' : '在籍'}</td>
              <td className="small" style={{ whiteSpace: 'nowrap' }}>
                {m.status === 'active' ? <>
                  <button className="link" onClick={() => setF({ id: m.id, name: m.name, email: m.email ?? '', notify_email: m.notify_email ?? '', is_operator: !!m.is_operator, is_representative: !!m.is_representative, sheet_id: m.sheet_id ?? '' })}>直す</button>
                  {m.id !== d.me.id && <button className="link danger" onClick={() => act('member_retire', m.id, `${m.name}さんを退任にしました。判定の対象から外れます。`)}>退任</button>}
                </> : <button className="link" onClick={() => act('member_reactivate', m.id, `${m.name}さんを在籍に戻しました。`)}>在籍に戻す</button>}
              </td>
            </tr>
          ))}
        </tbody>
      </table></div>
      <form onSubmit={save} style={{ marginTop: 12 }}>
        <p className="small"><b>{f.id ? `${f.name}さんを直す` : 'メンバーを追加'}</b>{f.id && <button type="button" className="link" style={{ marginLeft: 10 }} onClick={() => setF(empty)}>やめる</button>}</p>
        <div className="row"><label className="label" htmlFor="mn">名前</label><input id="mn" type="text" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
        <div className="row"><label className="label" htmlFor="me">ログイン用メール</label><input id="me" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></div>
        <div className="row"><label className="label" htmlFor="mx">通知先メール</label><input id="mx" type="email" value={f.notify_email} onChange={(e) => setF({ ...f, notify_email: e.target.value })} placeholder="空ならログイン用と同じ" /></div>
        <div className="row"><span className="label">立場</span>
          <span className="inline small">
            <label className="inline"><input type="checkbox" checked={f.is_operator} onChange={(e) => setF({ ...f, is_operator: e.target.checked })} />運用者</label>
            <label className="inline"><input type="checkbox" checked={f.is_representative} onChange={(e) => setF({ ...f, is_representative: e.target.checked })} />代表</label>
          </span></div>
        <div className="row"><label className="label" htmlFor="ms">シートのID</label><input id="ms" type="text" value={f.sheet_id} onChange={(e) => setF({ ...f, sheet_id: e.target.value })} placeholder="01_組織マスタのメンバーID（任意）" /></div>
        <div className="actions">
          <button className="btn small" disabled={!f.name || !f.email}>保存</button>
          <button type="button" className="link" onClick={sync}>タスク管理シートと同期</button>
          <Status msg={msg} />
        </div>
      </form>
    </section>
  );
}

function Deletions({ d, onDone }: { d: OpsData; onDone: () => void }) {
  const [msg, setMsg] = useState<Msg>(null);
  const retired = d.members.filter((m) => m.status === 'retired');
  const openReq = (id: string) => d.deletion_requests.find((r) => r.member_id === id && !r.executed_at);
  async function act(action: string, body: Record<string, unknown>, done: string) {
    setMsg(null);
    try { await api.opsAction(action, body); setMsg({ text: done }); onDone(); } catch (e) { setMsg({ text: errText(e), err: true }); }
  }
  if (retired.length === 0 && d.deletion_requests.length === 0) return null;
  return (
    <section>
      <div className="sec-title"><h2>退任者のデータ</h2><span className="aside">運用者が申請し、代表が承認すると消去します</span></div>
      <ul className="plain-list">
        {retired.map((m) => {
          const req = openReq(m.id);
          const days = m.retired_at ? Math.round((Date.parse(today()) - Date.parse(m.retired_at)) / 86400000) : null;
          return (
            <li key={m.id} className="inline">
              <span>{m.name}さん</span>
              <span className="small muted">{days !== null ? `退任から${days}日` : ''}{days !== null && days >= 30 ? '（目安の1か月を過ぎています）' : ''}</span>
              {!req && d.me.is_operator && <button className="link danger" onClick={() => act('deletion_request', { member_id: m.id }, '消去を申請しました。代表に通知しました。')}>消去を申請</button>}
              {req && <span className="tag">申請中</span>}
              {req && d.me.is_representative && <button className="link danger" onClick={() => act('deletion_approve', { id: req.id }, `${m.name}さんのデータを消去しました。`)}>承認して消去</button>}
            </li>
          );
        })}
        {d.deletion_requests.filter((r) => r.executed_at).map((r) => (
          <li key={r.id} className="small muted">{r.member_name}さん　{dt(r.executed_at as string)} に消去済み</li>
        ))}
      </ul>
      <Status msg={msg} />
    </section>
  );
}
