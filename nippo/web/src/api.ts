import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { ContactData, DayData, DaySubmit, InspectResult, MyData, OpsData } from './types';
import { demoApi } from './demo';

export interface Api {
  demo: boolean;
  session(): Promise<{ email: string } | null>;
  onAuthChange(cb: () => void): void;
  sendCode(email: string): Promise<void>;
  verifyCode(email: string, code: string): Promise<void>;
  signOut(): Promise<void>;
  link(): Promise<string | null>;
  consent(): Promise<void>;
  myData(days?: number): Promise<MyData>;
  day(date: string): Promise<DayData>;
  saveDay(body: DaySubmit): Promise<void>;
  contact(): Promise<ContactData>;
  sendContact(to_role: string, body: string): Promise<void>;
  markRead(id: string): Promise<void>;
  ops(): Promise<OpsData>;
  opsAction(action: string, body: Record<string, unknown>): Promise<unknown>;
  inspect(member_id: string, from: string, to: string, reason: string): Promise<InspectResult>;
  syncMembers(): Promise<{ added: number; updated: number; retired: number; skipped: string[] }>;
}

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
const forceDemo = new URLSearchParams(location.search).has('demo');

function realApi(sb: SupabaseClient): Api {
  async function fn<T>(name: string, opts: { method?: 'GET' | 'POST'; query?: Record<string, string>; body?: unknown } = {}): Promise<T> {
    const { data: s } = await sb.auth.getSession();
    const q = opts.query ? '?' + new URLSearchParams(opts.query).toString() : '';
    const res = await fetch(`${url}/functions/v1/${name}${q}`, {
      method: opts.method ?? (opts.body ? 'POST' : 'GET'),
      headers: { Authorization: `Bearer ${s.session?.access_token ?? ''}`, apikey: anon!, 'Content-Type': 'application/json' },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error ?? `エラー（${res.status}）`);
    return data as T;
  }
  return {
    demo: false,
    async session() { const { data } = await sb.auth.getSession(); return data.session ? { email: data.session.user.email ?? '' } : null; },
    onAuthChange(cb) { sb.auth.onAuthStateChange(() => cb()); },
    async sendCode(email) {
      const { error } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: location.origin } });
      if (error) throw new Error(error.message.includes('rate') ? '少し時間をおいてから、もう一度送ってください' : error.message);
    },
    async verifyCode(email, code) {
      const { error } = await sb.auth.verifyOtp({ email, token: code, type: 'email' });
      if (error) throw new Error('コードが違うか、期限が切れています');
    },
    async signOut() { await sb.auth.signOut(); },
    async link() { const { data, error } = await sb.rpc('link_me'); if (error) throw error; return data as string | null; },
    async consent() { const { error } = await sb.rpc('give_consent'); if (error) throw error; },
    myData: (days = 60) => fn('me', { query: { days: String(days) } }),
    day: (date) => fn('day', { query: { date } }),
    async saveDay(body) { await fn('day', { body }); },
    contact: () => fn('contact'),
    async sendContact(to_role, body) { await fn('contact', { body: { to_role, body } }); },
    async markRead(id) { await fn('contact', { body: { action: 'read', id } }); },
    ops: () => fn('ops'),
    opsAction: (action, body) => fn('ops', { body: { action, ...body } }),
    inspect: (member_id, from, to, reason) => fn('inspect', { body: { member_id, from, to, reason } }),
    syncMembers: () => fn('sync-members', { method: 'POST', body: {} }),
  };
}

export const api: Api = url && anon && !forceDemo ? realApi(createClient(url, anon)) : demoApi();
