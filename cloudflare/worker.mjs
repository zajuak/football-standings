import { handleRecords } from './records-api.mjs';

async function authorized(header, secret) {
  if (!header?.startsWith('Bearer ') || header.length > 1024) return false;
  const digest = value => crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  const [expected, actual] = await Promise.all([digest(secret), digest(header.slice(7))]);
  const a = new Uint8Array(expected), b = new Uint8Array(actual);
  let diff = 0; for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get('origin');
    const allowed = env.ALLOWED_ORIGIN || 'https://zajuak.github.io';
    const cors = { 'access-control-allow-origin': allowed, 'access-control-allow-methods': 'GET, POST, OPTIONS', 'access-control-allow-headers': 'Authorization, Content-Type', 'access-control-max-age': '86400', vary: 'Origin', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' };
    const reply = (data, status) => Response.json(data, { status, headers: cors });
    if (origin && origin !== allowed && origin !== url.origin) return reply({ error: '请求来源不被允许。' }, 403);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (url.pathname === '/health' && request.method === 'GET') return reply({ ok: true, databaseBound: Boolean(env.DB), authConfigured: typeof env.SYNC_TOKEN === 'string' && env.SYNC_TOKEN.length >= 24 }, 200);
    if (url.pathname !== '/api/records') return reply({ error: '接口不存在。' }, 404);
    if (typeof env.SYNC_TOKEN !== 'string' || env.SYNC_TOKEN.length < 24) return reply({ error: '请先配置至少 24 位的 SYNC_TOKEN Secret。' }, 503);
    if (!await authorized(request.headers.get('authorization'), env.SYNC_TOKEN)) return reply({ error: '同步口令不正确。' }, 401);
    const response = await handleRecords(request, env.DB);
    const headers = new Headers(response.headers);
    for (const [key, value] of Object.entries(cors)) headers.set(key, value);
    return new Response(response.body, { status: response.status, headers });
  },
};
