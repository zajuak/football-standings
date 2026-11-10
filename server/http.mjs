import { createServer } from 'node:http';
import { handleRecords } from '../cloudflare/records-api.mjs';
import { databaseSummary } from './database.mjs';

const MAX_BODY = 2_000_000;

export function createBackend({ db, readOnly = true, allowedOrigins = [] }) {
  const server = createServer(async (incoming, outgoing) => {
    const headers = { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' };
    const send = (status, data) => {
      incoming.resume();
      outgoing.writeHead(status, { ...headers, 'content-type': 'application/json; charset=utf-8' });
      outgoing.end(JSON.stringify(data));
    };
    try {
      const url = new URL(incoming.url, `http://${incoming.headers.host || 'localhost'}`);
      const origin = incoming.headers.origin;
      if (origin) {
        if (origin !== url.origin && !allowedOrigins.includes(origin)) return send(403, { error: '请求来源不被允许。' });
        Object.assign(headers, { 'access-control-allow-origin': origin, vary: 'Origin', 'access-control-allow-methods': 'GET, POST, OPTIONS', 'access-control-allow-headers': 'Content-Type' });
      }
      if (!['/health', '/api/records'].includes(url.pathname)) return send(404, { error: '接口不存在。' });
      if (incoming.method === 'OPTIONS') { outgoing.writeHead(204, headers); outgoing.end(); return; }
      if (url.pathname === '/health') {
        if (incoming.method !== 'GET') return send(405, { error: '不支持的请求。' });
        return send(200, { ok: true, databaseBound: true, authenticationRequired: false, mode: readOnly ? 'replica' : 'primary', readOnly, ...databaseSummary(db) });
      }
      if (incoming.method !== 'GET' && incoming.method !== 'POST') return send(405, { error: '不支持的请求。' });
      if (readOnly && incoming.method === 'POST') return send(503, { error: '此服务器为只读迁移副本，现有网站尚未切换，请继续使用原网站编辑。', readOnly: true });
      if (Number(incoming.headers['content-length']) > MAX_BODY) return send(413, { error: '本次数据超过 2 MB，请先导出备份。' });
      const chunks = [];
      let size = 0;
      for await (const chunk of incoming) {
        size += chunk.length;
        if (size <= MAX_BODY) chunks.push(chunk);
      }
      if (size > MAX_BODY) return send(413, { error: '本次数据超过 2 MB，请先导出备份。' });
      const request = new Request(url, { method: incoming.method, headers: incoming.headers,
        ...(incoming.method === 'POST' ? { body: Buffer.concat(chunks) } : {}) });
      const response = await handleRecords(request, db);
      outgoing.writeHead(response.status, { ...Object.fromEntries(response.headers), ...headers });
      outgoing.end(Buffer.from(await response.arrayBuffer()));
    } catch (error) {
      console.error('Backend request failed', error);
      if (!outgoing.headersSent) send(500, { error: '服务器处理失败，请保留当前页面并重试。' });
      else outgoing.end();
    }
  });
  server.requestTimeout = 30000;
  server.headersTimeout = 10000;
  server.maxRequestsPerSocket = 100;
  return server;
}
