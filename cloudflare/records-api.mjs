import { validSnapshot } from '../public/snapshot.mjs';
export { validSnapshot } from '../public/snapshot.mjs';
import { contentFingerprint } from '../public/state-content.mjs';

const json = (data, status = 200) => Response.json(data, { status, headers: { 'cache-control': 'no-store' } });

export async function handleRecords(request, db) {
  if (!db) return json({ error: '云端数据库尚未连接。' }, 503);
  const url = new URL(request.url);
  try {
    if (request.method === 'GET') {
      if (url.searchParams.has('history')) {
        const raw = url.searchParams.get('before');
        const before = raw == null ? Number.MAX_SAFE_INTEGER : Number(raw);
        if (!Number.isSafeInteger(before) || before < 1) return json({ error: '无效的历史游标。' }, 400);
        const full = url.searchParams.has('full');
        const fields = full ? '*' : 'revision, submission_id, base_revision, action, applied, created_at';
        const { results } = await db.prepare(`SELECT ${fields} FROM submissions WHERE revision < ? ORDER BY revision DESC LIMIT 50`).bind(before).all();
        const items = results.map(r => ({ ...r, ...(full ? { state: JSON.parse(r.state) } : {}) }));
        return json({ items, next: items.length === 50 ? items.at(-1).revision : null });
      }
      if (url.searchParams.has('revision')) {
        const revision = Number(url.searchParams.get('revision'));
        if (!Number.isSafeInteger(revision) || revision < 1) return json({ error: '无效的历史版本。' }, 400);
        const row = await db.prepare('SELECT * FROM submissions WHERE revision = ?').bind(revision).first();
        return row ? json({ ...row, state: JSON.parse(row.state) }) : json({ error: '未找到该历史版本。' }, 404);
      }
      const row = await db.prepare('SELECT revision, state FROM submissions WHERE applied = 1 ORDER BY revision DESC LIMIT 1').first();
      return json(row ? { revision: row.revision, state: JSON.parse(row.state) } : { revision: 0, state: null });
    }
    if (request.method !== 'POST') return json({ error: '不支持的请求。' }, 405);
    if (!request.headers.get('content-type')?.startsWith('application/json')) return json({ error: '需要 JSON 数据。' }, 415);
    const text = await request.text();
    if (new TextEncoder().encode(text).length > 2_000_000) return json({ error: '本次数据超过 2 MB，请先导出备份。' }, 413);
    const data = JSON.parse(text);
    if (!data || typeof data !== 'object' || typeof data.id !== 'string' || !/^[a-zA-Z0-9-]{1,100}$/.test(data.id) || !Number.isSafeInteger(data.baseRevision) || data.baseRevision < 0 || typeof data.action !== 'string' || data.action.length > 120 || !validSnapshot(data.state)) return json({ error: '提交的数据格式不正确。' }, 400);
    const state = JSON.stringify(data.state);
    const content = contentFingerprint(data.state);
    const previous = await db.prepare('SELECT * FROM submissions WHERE submission_id = ?').bind(data.id).first();
    if (previous) {
      if (contentFingerprint(JSON.parse(previous.state)) !== content || previous.base_revision !== data.baseRevision || previous.action !== data.action) return json({ error: '提交编号已用于其他数据。' }, 409);
      const latest = await db.prepare('SELECT revision FROM submissions WHERE applied = 1 ORDER BY revision DESC LIMIT 1').first();
      return json({ revision: previous.revision, currentRevision: latest?.revision ?? 0, applied: Boolean(previous.applied), archived: true }, previous.applied || data.archiveOnly ? 200 : 409);
    }
    const current = await db.prepare('SELECT revision, state FROM submissions WHERE applied = 1 ORDER BY revision DESC LIMIT 1').first();
    if (!data.archiveOnly && current && contentFingerprint(JSON.parse(current.state)) === content) {
      return json({ revision: current.revision, currentRevision: current.revision, applied: true, unchanged: true, archived: false });
    }
    const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(content));
    const hash = [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, '0')).join('');
    // The SQL comparison also covers simultaneous identical requests: only the
    // first one creates a snapshot. Conflicting different content stays archived.
    await db.prepare(`INSERT INTO submissions (submission_id, base_revision, action, state, applied, created_at, content_hash)
      SELECT ?, ?, ?, ?, CASE WHEN ? = 0 AND COALESCE((SELECT MAX(revision) FROM submissions WHERE applied = 1), 0) = ? THEN 1 ELSE 0 END, ?, ?
      WHERE ? = 1 OR COALESCE((SELECT content_hash FROM submissions WHERE applied = 1 ORDER BY revision DESC LIMIT 1), '') != ?
      ON CONFLICT(submission_id) DO NOTHING`).bind(data.id, data.baseRevision, data.action, state, data.archiveOnly ? 1 : 0, data.baseRevision,
        (typeof data.createdAt === 'string' && data.createdAt.length <= 35 && Number.isFinite(Date.parse(data.createdAt)) ? new Date(data.createdAt).toISOString() : new Date().toISOString()), hash, data.archiveOnly ? 1 : 0, hash).run();
    const saved = await db.prepare('SELECT * FROM submissions WHERE submission_id = ?').bind(data.id).first();
    const latest = await db.prepare('SELECT revision FROM submissions WHERE applied = 1 ORDER BY revision DESC LIMIT 1').first();
    if (!saved) return json({ revision: latest.revision, currentRevision: latest.revision, applied: true, unchanged: true, archived: false });
    if (contentFingerprint(JSON.parse(saved.state)) !== content || saved.base_revision !== data.baseRevision || saved.action !== data.action) return json({ error: '提交编号已用于其他数据。' }, 409);
    return json({ revision: saved.revision, currentRevision: latest?.revision ?? 0, applied: Boolean(saved.applied), archived: true }, saved.applied || data.archiveOnly ? 200 : 409);

  } catch (error) {
    if (error instanceof SyntaxError) return json({ error: 'JSON 数据格式不正确。' }, 400);
    console.error('积分榜存档失败', error);
    return json({ error: '云端保存失败，请保留页面并重试。' }, 500);
  }
}
