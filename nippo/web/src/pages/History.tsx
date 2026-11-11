import { useEffect, useState } from 'react';
import { api } from '../api';
import type { MyData } from '../types';
import { md, hhmm, dt } from '../util';
import { StageMark, errText } from '../ui';

export default function History() {
  const [d, setD] = useState<MyData | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => { api.myData(60).then(setD).catch((e) => setErr(errText(e))); }, []);
  if (err) return <p className="status err" style={{ paddingTop: 20 }}>{err}</p>;
  if (!d) return <p className="muted" style={{ paddingTop: 20 }}>読み込み中…</p>;
  const ls = d.latest_stage;
  return (
    <>
      <div className="sheet-head"><h1>記録</h1><span className="meta">直近60日・見られるのはあなただけです</span></div>

      <section>
        {ls ? (
          <div className={'stage-box' + (ls.value >= 3 ? ' hot' : '')}>
            <span className="small muted">いまの段階（{md(ls.date)}の判定・直近7日間）</span>
            <StageMark value={ls.value} name={ls.name} />
            {ls.value >= 3 && <span className="small">無理をせず、休むことを考えてください。「連絡」から代表や運用者に相談できます。</span>}
          </div>
        ) : <p className="lead">まだ段階は出ていません。3日分の回答がたまると、翌朝から出ます。</p>}
      </section>

      {d.reviews_to_me.length > 0 && (
        <section>
          <div className="sec-title"><h2>あなたへの確認依頼</h2></div>
          <ul className="plain-list">
            {d.reviews_to_me.map((r, i) => <li key={i}><span className="tag">{md(r.date)}</span>{r.from}さん：{r.note}</li>)}
          </ul>
        </section>
      )}

      <section>
        <div className="sec-title"><h2>日ごとの記録</h2><span className="aside">押すと中身が開きます</span></div>
        {d.days.length === 0 && <p className="muted">まだ記録がありません。</p>}
        {d.days.map((x) => (
          <details key={x.date} className="day">
            <summary>
              <span className="num">{md(x.date)}</span>
              <span className="facts num">
                {x.start_time ? `${hhmm(x.start_time)}–${hhmm(x.end_time)}` : '稼働 —'}
                {x.work_hours !== null && `　${x.work_hours}h`}
                {x.sleep_hours !== null && `　睡眠${Number(x.sleep_hours)}h`}
              </span>
              {x.stage ? <StageMark value={x.stage.value} name={x.stage.name} /> : <span className="small muted">判定前</span>}
            </summary>
            <div className="day-body">
              <dl>
                <dt>やったこと</dt><dd>{x.did || '—'}</dd>
                <dt>成果物</dt><dd>{x.has_deliverable ? (x.deliverable_note || 'あり') : 'なし'}</dd>
                {x.feelings && <><dt>感じたこと</dt><dd>{x.feelings}</dd></>}
                {x.stress && <><dt>点数</dt><dd className="num">{x.stress.score} / 32</dd></>}
              </dl>
              {x.stress && (
                <ul className="answers">
                  {x.stress.answers.map((a) => <li key={a.q}><span>{a.text}</span><b>{a.label}</b></li>)}
                </ul>
              )}
              {x.stage?.raised && <p className="notice">ふだんのあなたと比べて悪化が続いていたので、段階を1つ上げています。</p>}
            </div>
          </details>
        ))}
      </section>

      <section>
        <div className="sec-title"><h2>内部の確認の履歴</h2><span className="aside">運用者があなたの記録の中身を見たとき</span></div>
        {d.access_log.length === 0 ? <p className="small muted">ありません。</p> : (
          <ul className="plain-list">
            {d.access_log.map((l, i) => (
              <li key={i}>
                <span className="num">{dt(l.at)}</span>　{l.actor_name}さんが {md(l.range_from)}〜{md(l.range_to)} を確認
                <div className="small muted">理由：{l.reason}</div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
