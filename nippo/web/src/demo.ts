// Supabase の設定が無いときに使う、保存されないデモ。画面の確認用。
import type { Api } from './api';
import type { ContactData, DayData, MyData, OpsData, Question, Report } from './types';
import { addDays, today, workHours } from './util';

const T1 = ['全く当てはまらない', 'あまり当てはまらない', 'どちらともいえない', 'やや当てはまる', '非常に当てはまる'];
const T2 = ['全くない', 'ほとんどない', 'ときどきある', 'よくある', 'ほとんどいつもある'];
const mk = (labels: string[], rev = false) => labels.map((label, i) => ({ label, points: rev ? 4 - i : i }));
const QS: Question[] = [
  { slot: 1, id: 'S-B13', grp: '気分・意欲', text: 'ゆううつだ', choices: mk(T2) },
  { slot: 2, id: 'S-B05', grp: '気分・意欲', text: '内心腹立たしい', choices: mk(T2) },
  { slot: 3, id: 'S-A01', grp: '仕事の負荷', text: '仕事の量がとても多い', choices: mk(T1) },
  { slot: 4, id: 'S-A16', grp: '仕事の負荷', text: '仕事の内容は自分に合っている', choices: mk(T1, true) },
  { slot: 5, id: 'S-C06', grp: '周囲のサポート', text: '困った時、配偶者・家族・友人は頼りになる', choices: mk(T1, true) },
  { slot: 6, id: 'S-B29', grp: '睡眠・休息', text: 'よく眠れない', choices: mk(T2) },
  { slot: 7, id: 'S-B21', grp: '身体の不調', text: '頭が重い、または頭痛がする', choices: mk(T2) },
  { slot: 8, id: 'F-W06', grp: '身体的負担', text: '仕事についての身体的負担が大きい', choices: mk(T1) },
];
const people = [
  { id: 'p1', name: '青木 春香' }, { id: 'p2', name: '石井 拓真' }, { id: 'p3', name: '上田 美咲' },
  { id: 'p4', name: '江藤 健' }, { id: 'p5', name: '小川 葵' },
];
const me = { id: 'me', name: '中村 悠', email: 'you@example.com', is_operator: true, is_representative: false, consent_at: '2026-11-01T09:00:00Z' };

const saved = new Map<string, Report & { answers: { q: string; p: number }[] }>();
const sample = (i: number): Report => ({
  date: addDays(today(), -i), start_time: ['09:30', '10:00', '13:00', '09:00'][i % 4], end_time: ['18:30', '21:15', '22:40', '17:30'][i % 4],
  sleep_hours: [6.5, 5, 7, 4.5, 6][i % 5],
  did: ['協賛候補の企業リストを整理。3社に初回の連絡。', 'イベント当日の進行表を作成。会場と時間の調整。', 'Webサイトの文章を見直し、問い合わせフォームを確認。'][i % 3],
  has_deliverable: i % 2 === 0, deliverable_note: i % 2 === 0 ? '進行表 v2' : '', feelings: i % 3 === 0 ? '連絡の返事待ちが多くて落ち着かなかった。' : '',
});
const stageOf = (i: number) => (i < 3 ? 2 : i < 8 ? 1 : 0);

export function demoApi(): Api {
  let signed = true, consented = true;
  const wait = <T,>(v: T) => new Promise<T>((r) => setTimeout(() => r(v), 120));
  return {
    demo: true,
    session: async () => (signed ? { email: me.email } : null),
    onAuthChange() {},
    async sendCode() {},
    async verifyCode() { signed = true; },
    async signOut() { signed = false; },
    link: async () => 'me',
    async consent() { consented = true; },
    async myData(): Promise<MyData> {
      const days = Array.from({ length: 14 }, (_, i) => {
        const r = saved.get(addDays(today(), -i)) ?? sample(i);
        const st = stageOf(i);
        return {
          ...r, work_hours: workHours(r.start_time, r.end_time),
          stress: { score: 9 + ((i * 7) % 12), answers: QS.map((q, k) => ({ q: q.id, text: q.text, label: q.choices[(i + k) % 5].label, p: q.choices[(i + k) % 5].points })) },
          stage: i === 0 && !saved.has(today()) ? null : { value: st, name: ['健康', 'やや偏りあり', '不安定'][st], raised: i === 1 },
        };
      }).filter((d) => d.stage || saved.has(d.date));
      return wait({
        me: { ...me, consent_at: consented ? me.consent_at : null },
        latest_stage: { date: addDays(today(), -1), value: 2, name: '不安定' }, days,
        reviews_to_me: [{ date: addDays(today(), -1), from: '青木 春香', note: '協賛資料の金額欄を確認してほしいです。' }],
        access_log: [{ at: '2026-11-04T10:12:00+09:00', actor_name: '中村 悠', range_from: '2026-10-20', range_to: '2026-11-03', reason: '本人から、記録の内容を一緒に見てほしいと相談があったため' }],
        rests: [],
      });
    },
    async day(date): Promise<DayData> {
      const s = saved.get(date);
      return wait({
        date, cycle_day: 1, questions: QS,
        report: s ?? null, answers: s?.answers ?? null, reviews: [], directory: people,
      });
    },
    async saveDay(b) { saved.set(b.date, { ...b }); await wait(null); },
    async contact(): Promise<ContactData> {
      return wait({
        can_receive: ['operator'],
        inbox: [{ id: 'c1', to_role: 'operator', from: '上田 美咲', body: '今週は試験が重なっていて、タスクを少し減らしてもらえると助かります。', read_at: null, created_at: '2026-11-10T21:40:00+09:00' }],
        sent: [],
      });
    },
    async sendContact() { await wait(null); },
    async markRead() {},
    async ops(): Promise<OpsData> {
      return wait({
        me: { id: 'me', is_operator: true, is_representative: false },
        judged_date: addDays(today(), -1),
        members: [
          { ...me, status: 'active', retired_at: null, notify_email: null, sheet_id: 'M001', auth_user_id: 'x' },
          ...people.map((p, i) => ({ ...p, email: `member${i + 1}@example.com`, notify_email: null, is_operator: false, is_representative: i === 0, status: 'active', retired_at: null, consent_at: i === 4 ? null : '2026-11-01', sheet_id: `M00${i + 2}`, auth_user_id: i === 4 ? null : 'x' })),
          { id: 'r1', name: '前田 翔', email: 'maeda@example.com', status: 'retired', retired_at: '2026-10-05', is_operator: false, is_representative: false },
        ],
        danger: [{ member_id: 'p2', name: '石井 拓真', date: addDays(today(), -1), stage: 3, stage_name: '危険', raised: false, baseline_high: false }],
        rests: [],
        reassignments: [{ id: 'a1', from_name: '石井 拓真', to_names: '江藤 健', note: '協賛営業の2社分', created_at: '2026-11-08T12:00:00+09:00', notified_at: '2026-11-08T12:00:02+09:00' }],
        deletion_requests: [],
        access_log: [{ at: '2026-11-04T10:12:00+09:00', actor_name: '中村 悠', target_name: '上田 美咲', range_from: '2026-10-20', range_to: '2026-11-03', reason: '本人から、記録の内容を一緒に見てほしいと相談があったため', notified: true }],
        failed_notifications: [],
      });
    },
    async opsAction() { return wait({ ok: true }); },
    async inspect(member_id, from, to) {
      return wait({ target: people.find((p) => p.id === member_id) ?? people[0], from, to, notified: true, days: [{ ...sample(2), stress: { score: 14, answers: QS.map((q, k) => ({ text: q.text, p: k % 5 })) } }] });
    },
    async syncMembers() { return wait({ added: 0, updated: 6, retired: 0, skipped: [] }); },
  };
}
