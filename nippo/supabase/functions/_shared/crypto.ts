// AES-GCM で暗号化する。鍵（DATA_KEY）は Edge Functions の秘密の設定にだけ置く。
// 形式: "v1:" + base64(12バイトのIV + 暗号文)

let keyPromise: Promise<CryptoKey> | null = null;

function b64decode(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function b64encode(b: Uint8Array): string {
  let s = '';
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return btoa(s);
}

export function setKeyForTest(raw: string) { keyPromise = importKey(raw); }

function importKey(raw: string): Promise<CryptoKey> {
  const bytes = b64decode(raw);
  if (bytes.length !== 32) throw new Error('DATA_KEY は32バイトをbase64にしたものにしてください');
  return crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

function key(): Promise<CryptoKey> {
  if (!keyPromise) {
    // deno-lint-ignore no-explicit-any
    const raw = (globalThis as any).Deno?.env.get('DATA_KEY');
    if (!raw) throw new Error('DATA_KEY が設定されていません');
    keyPromise = importKey(raw);
  }
  return keyPromise;
}

export async function encrypt(value: unknown): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = new TextEncoder().encode(JSON.stringify(value));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await key(), data));
  const all = new Uint8Array(iv.length + ct.length);
  all.set(iv); all.set(ct, iv.length);
  return 'v1:' + b64encode(all);
}

export async function decrypt<T = unknown>(s: string | null | undefined): Promise<T | null> {
  if (!s) return null;
  if (!s.startsWith('v1:')) throw new Error('暗号の形式が違います');
  const all = b64decode(s.slice(3));
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: all.slice(0, 12) }, await key(), all.slice(12));
  return JSON.parse(new TextDecoder().decode(pt)) as T;
}
