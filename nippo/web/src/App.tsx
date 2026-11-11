import { useCallback, useEffect, useState } from 'react';
import { api } from './api';
import type { Me } from './types';
import Login from './pages/Login';
import Consent from './pages/Consent';
import Today from './pages/Today';
import History from './pages/History';
import Contact from './pages/Contact';
import Ops from './pages/Ops';
import { errText } from './ui';

type Route = 'today' | 'history' | 'contact' | 'ops';
const routeOf = (): Route => {
  const h = location.hash.replace(/^#\/?/, '');
  return (['today', 'history', 'contact', 'ops'] as Route[]).includes(h as Route) ? (h as Route) : 'today';
};

type State =
  | { kind: 'loading' }
  | { kind: 'signed-out' }
  | { kind: 'not-member'; email: string }
  | { kind: 'error'; text: string }
  | { kind: 'ready'; me: Me };

export default function App() {
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [route, setRoute] = useState<Route>(routeOf());

  const load = useCallback(async () => {
    try {
      const s = await api.session();
      if (!s) return setState({ kind: 'signed-out' });
      const id = await api.link();
      if (!id) return setState({ kind: 'not-member', email: s.email });
      const d = await api.myData(7);
      setState({ kind: 'ready', me: d.me });
    } catch (e) {
      setState({ kind: 'error', text: errText(e) });
    }
  }, []);

  useEffect(() => {
    load();
    api.onAuthChange(() => load());
    const onHash = () => setRoute(routeOf());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, [load]);

  if (state.kind === 'loading') return <div className="center-sheet"><p className="muted">読み込み中…</p></div>;
  if (state.kind === 'signed-out') return <Login onDone={load} />;
  if (state.kind === 'error') return <div className="center-sheet"><div className="title">日報</div><p className="status err">{state.text}</p><button className="btn ghost" onClick={load}>もう一度読み込む</button></div>;
  if (state.kind === 'not-member') {
    return (
      <div className="center-sheet">
        <div className="title">日報</div>
        <p>{state.email} は、メンバーとして登録されていません。</p>
        <p className="lead">運用者に、このメールアドレスの登録を頼んでください。登録されたあと、もう一度ログインすると使えます。</p>
        <div className="actions"><button className="btn ghost" onClick={async () => { await api.signOut(); load(); }}>ログアウト</button></div>
      </div>
    );
  }
  const me = state.me;
  if (!me.consent_at) return <Consent me={me} onDone={load} />;

  const tabs: [Route, string][] = [['today', '今日'], ['history', '記録'], ['contact', '連絡']];
  if (me.is_operator || me.is_representative) tabs.push(['ops', '運用']);
  const current = tabs.some(([r]) => r === route) ? route : 'today';

  return (
    <div className="page">
      <header className="top">
        <span className="title">日報</span>
        <span className="who">{me.name}<button className="link" onClick={async () => { await api.signOut(); load(); }}>ログアウト</button></span>
      </header>
      <nav className="tabs" aria-label="画面">
        {tabs.map(([r, label]) => <a key={r} href={`#/${r}`} aria-current={current === r ? 'page' : undefined}>{label}</a>)}
      </nav>
      {api.demo && <div className="demo-note">デモ表示です。入力しても保存されません。</div>}
      <main>
        {current === 'today' && <Today />}
        {current === 'history' && <History />}
        {current === 'contact' && <Contact />}
        {current === 'ops' && <Ops />}
      </main>
    </div>
  );
}
