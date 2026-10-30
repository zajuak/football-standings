import { handleRecords } from './records-api.mjs';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get('origin');
    const allowed = env.ALLOWED_ORIGIN || 'https://zajuak.github.io';
    const cors = { 'access-control-allow-origin': allowed, 'access-control-allow-methods': 'GET, POST, OPTIONS', 'access-control-allow-headers': 'Content-Type', 'access-control-max-age': '86400', vary: 'Origin', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' };
    const reply = (data, status) => Response.json(data, { status, headers: cors });
    if (origin && origin !== allowed && origin !== url.origin) return reply({ error: '请求来源不被允许。' }, 403);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (url.pathname === '/health' && request.method === 'GET') return reply({ ok: true, databaseBound: Boolean(env.DB), authenticationRequired: false }, 200);
    if (url.pathname !== '/api/records') return reply({ error: '接口不存在。' }, 404);
    const response = await handleRecords(request, env.DB);
    const headers = new Headers(response.headers);
    for (const [key, value] of Object.entries(cors)) headers.set(key, value);
    return new Response(response.body, { status: response.status, headers });
  },
};
