// deno test tests/crypto.test.ts
import { setKeyForTest, encrypt, decrypt } from '../supabase/functions/_shared/crypto.ts';
const raw = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))));
setKeyForTest(raw);
Deno.test('暗号化して戻せる', async () => {
  const v = [{ q: 'S-B13', p: 3 }, { q: '日本語', p: 0 }];
  const e = await encrypt(v);
  if (!e.startsWith('v1:') || e.includes('S-B13')) throw new Error('not encrypted');
  const d = await decrypt(e);
  if (JSON.stringify(d) !== JSON.stringify(v)) throw new Error('mismatch');
  if ((await encrypt(v)) === e) throw new Error('IV not random');
});
Deno.test('改ざんは失敗する', async () => {
  const e = await encrypt('今日感じたこと');
  const bad = e.slice(0, -4) + (e.endsWith('A') ? 'B' : 'A') + e.slice(-3);
  let failed = false;
  try { await decrypt(bad); } catch { failed = true; }
  if (!failed) throw new Error('tamper not detected');
});
