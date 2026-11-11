import { useState } from 'react';
import { api } from '../api';
import type { Me } from '../types';
import { Status, errText } from '../ui';

// 文面は構想書「同意文」タブの案。決まったら、ここを書き換える。
export default function Consent({ me, onDone }: { me: Me; onDone: () => void }) {
  const [ok, setOk] = useState(false);
  const [msg, setMsg] = useState<{ text: string; err?: boolean } | null>(null);
  async function agree() {
    try { await api.consent(); onDone(); } catch (e) { setMsg({ text: errText(e), err: true }); }
  }
  return (
    <div className="page">
      <header className="top"><span className="title">日報</span><span className="who">{me.name}</span></header>
      <div className="sheet-head"><h1>はじめに</h1><span className="meta">使い始める前に読んでください</span></div>
      <div className="doc">
        <h3>日報とストレスチェックについて</h3>
        <p>このアプリでは、日報と、毎日8問のストレスチェックに答えてもらいます。目的は、あなた自身が自分の状態に気づけること、そして、疲れやストレスが大きくなったときに、タスクの負担を早めに調整できるようにすることです。医療や診断のためのものではありません。</p>

        <h3>誰に何が届くか</h3>
        <table className="ledger">
          <tbody>
            <tr><td>あなた</td><td>自分の日報、回答、点数、段階（自分の画面だけ）</td></tr>
            <tr><td>運用者</td><td>「危険」以上になったとき、あなたの名前と段階だけ。点数と回答は届きません</td></tr>
            <tr><td>代表</td><td>運用者がタスクを振り直したあと、誰のタスクを誰に振り直したか</td></tr>
            <tr><td>確認をお願いした相手</td><td>日報の「確認が必要なもの」で名前を選んだ内容</td></tr>
            <tr><td>ほかのメンバー</td><td>何も届きません</td></tr>
          </tbody>
        </table>

        <h3>守ること</h3>
        <ul>
          <li>点数・回答・「今日感じたこと」は暗号化して保存します。システムの管理画面から開いても、中身は読めません。</li>
          <li>中身を確認できるのは、このアプリの「内部の確認」だけです。使うときは理由の入力が必要で、確認した記録が残り、あなたにメールが届きます。記録は「記録」画面からも見られます。</li>
          <li>ただし、プログラムを書き換えられる管理者がいる以上、完全に防ぐことはできません。</li>
          <li>通知は、人が多く集まる場所には出しません。</li>
        </ul>

        <h3>段階とタスクの振り直し</h3>
        <ul>
          <li>段階は、直近7日間の回答や睡眠時間などから自動で決まります。点数が高いほど、疲れやストレスが大きい状態です。</li>
          <li>段階が「危険」以上のとき、運用者がタスクを振り直すことがあります。決めるのは人で、自動では行いません。</li>
        </ul>

        <h3>データを残す期間</h3>
        <ul>
          <li>日報と回答は、直近6か月分だけ残し、それより前は消去します。</li>
          <li>退任したときは判定の対象から外れ、運用者と代表が判断して、退任から1か月以内を目安に消去します。</li>
        </ul>

        <h3>つらいとき</h3>
        <p>このアプリの段階を待たずに、身近な人や、大学・職場・地域の相談窓口に相談してください。「連絡」から代表や運用者にも送れます。命の危険があるときは、119番か110番に電話してください。</p>
      </div>
      <div className="actions">
        <label className="inline"><input type="checkbox" checked={ok} onChange={(e) => setOk(e.target.checked)} />読んで、内容に同意します</label>
      </div>
      <div className="actions"><button className="btn" disabled={!ok} onClick={agree}>同意して始める</button><Status msg={msg} /></div>
    </div>
  );
}
