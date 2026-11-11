import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import type { DayData, MyData } from '../types';
import { addDays, md, mdLong, today, workHours, dt } from '../util';
import { StageMark, Status, YesNo, errText, softBreak } from '../ui';

type Review = { to: string; note: string };
const SLEEP = Array.from({ length: 25 }, (_, i) => i / 2);

export default function Today() {
  const [date, setDate] = useState(today());
  const [data, setData] = useState<DayData | null>(null);
  const [mine, setMine] = useState<MyData | null>(null);
  const [msg, setMsg] = useState<{ text: string; err?: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [tried, setTried] = useState(false);

  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [sleep, setSleep] = useState('');
  const [did, setDid] = useState('');
  const [hasDel, setHasDel] = useState(false);
  const [delNote, setDelNote] = useState('');
  const [hasRev, setHasRev] = useState(false);
  const [reviews, setReviews] = useState<Review[]>([{ to: '', note: '' }]);
  const [feelings, setFeelings] = useState('');
  const [answers, setAnswers] = useState<Record<string, number>>({});

  useEffect(() => { api.myData(14).then(setMine).catch(() => {}); }, []);
  useEffect(() => {
    let alive = true;
    setData(null); setMsg(null); setTried(false);
    api.day(date).then((d) => {
      if (!alive) return;
      setData(d);
      const r = d.report;
      setStart(r?.start_time?.slice(0, 5) ?? ''); setEnd(r?.end_time?.slice(0, 5) ?? '');
      setSleep(r?.sleep_hours != null ? String(Number(r.sleep_hours)) : '');
      setDid(r?.did ?? ''); setHasDel(r?.has_deliverable ?? false); setDelNote(r?.deliverable_note ?? '');
      setFeelings(r?.feelings ?? '');
      setHasRev(d.reviews.length > 0);
      setReviews(d.reviews.length ? d.reviews.map((x) => ({ to: x.to_member_id, note: x.note })) : [{ to: '', note: '' }]);
      setAnswers(Object.fromEntries((d.answers ?? []).map((a) => [a.q, a.p])));
    }).catch((e) => alive && setMsg({ text: errText(e), err: true }));
    return () => { alive = false; };
  }, [date]);

  const hours = workHours(start || null, end || null);
  const answered = data ? data.questions.filter((q) => answers[q.id] !== undefined).length : 0;
  const complete = !!data && answered === data.questions.length;
  const dates = useMemo(() => [0, 1, 2].map((i) => addDays(today(), -i)), []);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!data) return;
    setTried(true);
    if (!complete) { setMsg({ text: `「今日どうだった？」が、あと${data.questions.length - answered}問残っています。`, err: true }); return; }
    setBusy(true); setMsg(null);
    try {
      await api.saveDay({
        date, start_time: start || null, end_time: end || null, sleep_hours: sleep === '' ? null : Number(sleep),
        did, has_deliverable: hasDel, deliverable_note: hasDel ? delNote : '', feelings,
        answers: data.questions.map((q) => ({ q: q.id, p: answers[q.id] })),
        reviews: hasRev ? reviews.filter((r) => r.to && r.note.trim()) : [],
      });
      setMsg({ text: `記録しました（${dt(new Date().toISOString())}）` });
      setData({ ...data, report: { date, start_time: start, end_time: end, sleep_hours: sleep === '' ? null : Number(sleep), did, has_deliverable: hasDel, deliverable_note: delNote, feelings } });
    } catch (err) { setMsg({ text: errText(err), err: true }); }
    setBusy(false);
  }

  return (
    <form onSubmit={save} noValidate>
      <div className="sheet-head">
        <h1>{mdLong(date)}</h1>
        <span className="meta">
          <select className="narrow" aria-label="日付" value={date} onChange={(e) => setDate(e.target.value)}>
            {dates.map((d, i) => <option key={d} value={d}>{['今日', '昨日', 'おととい'][i]}　{md(d)}</option>)}
          </select>
        </span>
      </div>
      {mine?.latest_stage && (
        <p className="small"><span className="muted">いまの段階　</span><StageMark value={mine.latest_stage.value} name={mine.latest_stage.name} /><span className="muted">　{md(mine.latest_stage.date)}の判定</span></p>
      )}
      {data?.report && <p className="notice">この日はもう記録があります。直して「記録する」を押すと、上書きします。</p>}

      <section>
        <div className="sec-title"><h2>日報</h2></div>
        <div className="row">
          <span className="label">稼働</span>
          <span className="inline">
            <input type="time" aria-label="開始" step={900} value={start} onChange={(e) => setStart(e.target.value)} />
            <span className="muted">〜</span>
            <input type="time" aria-label="終了" step={900} value={end} onChange={(e) => setEnd(e.target.value)} />
            {hours !== null && <span className="num small muted">{hours}時間</span>}
          </span>
        </div>
        <div className="row">
          <label className="label" htmlFor="sleep">睡眠</label>
          <span className="inline">
            <select id="sleep" className="narrow" value={sleep} onChange={(e) => setSleep(e.target.value)}>
              <option value="">—</option>
              {SLEEP.map((h) => <option key={h} value={String(h)}>{h}</option>)}
            </select>
            <span className="small muted">時間（だいたいで）</span>
          </span>
        </div>
        <div className="row">
          <label className="label" htmlFor="did">やったこと</label>
          <textarea id="did" value={did} onChange={(e) => setDid(e.target.value)} placeholder="箇条書きでも、一言でも" />
        </div>
        <div className="row">
          <span className="label">成果物</span>
          <div>
            <YesNo name="del" value={hasDel} onChange={setHasDel} />
            {hasDel && <input type="text" style={{ marginTop: 8 }} aria-label="成果物のメモ" placeholder="何ができたか、一言" value={delNote} onChange={(e) => setDelNote(e.target.value)} />}
          </div>
        </div>
        <div className="row">
          <span className="label">確認が必要なもの</span>
          <div>
            <YesNo name="rev" value={hasRev} onChange={setHasRev} />
            {hasRev && (
              <div style={{ display: 'grid', gap: 8, marginTop: 8 }}>
                {reviews.map((r, i) => (
                  <div key={i} style={{ display: 'grid', gap: 6, paddingBottom: 8, borderBottom: '1px dotted var(--rule)' }}>
                    <select aria-label="確認してほしい人" value={r.to} onChange={(e) => setReviews(reviews.map((x, k) => (k === i ? { ...x, to: e.target.value } : x)))}>
                      <option value="">確認してほしい人を選ぶ</option>
                      {data?.directory.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                    <input type="text" aria-label="確認してほしい内容" placeholder="確認してほしい内容" value={r.note} onChange={(e) => setReviews(reviews.map((x, k) => (k === i ? { ...x, note: e.target.value } : x)))} />
                    {reviews.length > 1 && <button type="button" className="link" style={{ justifySelf: 'start' }} onClick={() => setReviews(reviews.filter((_, k) => k !== i))}>この依頼を消す</button>}
                  </div>
                ))}
                <button type="button" className="link" style={{ justifySelf: 'start' }} onClick={() => setReviews([...reviews, { to: '', note: '' }])}>もう1件</button>
                <span className="small muted">記録すると、選んだ人にメールが届きます。</span>
              </div>
            )}
          </div>
        </div>
        <div className="row">
          <label className="label" htmlFor="feel">今日感じたこと</label>
          <div>
            <textarea id="feel" value={feelings} onChange={(e) => setFeelings(e.target.value)} />
            <span className="small muted">暗号化して保存します。見られるのはあなただけです。</span>
          </div>
        </div>
      </section>

      <section>
        <div className="sec-title"><h2>今日どうだった？</h2><span className="aside num">{answered} / {data?.questions.length ?? 8}</span></div>
        {!data && !msg && <p className="muted">読み込み中…</p>}
        {data?.questions.map((q, i) => (
          <div key={q.id} className={'q' + (tried && answers[q.id] === undefined ? ' missing' : '')} role="radiogroup" aria-labelledby={`qt-${q.id}`}>
            <p className="q-head" id={`qt-${q.id}`}><span className="q-no">{String(i + 1).padStart(2, '0')}</span><span>{q.text}</span></p>
            <div className="marks">
              {q.choices.map((c) => (
                <label key={c.label} className="mark">
                  <input type="radio" name={`q-${q.id}`} checked={answers[q.id] === c.points} onChange={() => setAnswers({ ...answers, [q.id]: c.points })} />
                  <span>{softBreak(c.label)}</span>
                </label>
              ))}
            </div>
          </div>
        ))}
      </section>

      <div className="actions">
        <button className="btn" disabled={busy || !data}>{busy ? '記録しています…' : '記録する'}</button>
        <Status msg={msg} />
      </div>
    </form>
  );
}
