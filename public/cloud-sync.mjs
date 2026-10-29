import { createId } from './core.mjs';
async function readResponse(response) {
  const raw = await response.text();
  try { return JSON.parse(raw); } catch { throw new Error('云端接口尚未就绪，请先部署 Worker 后端代码'); }
}
export const SYNC_KEY = 'pku-football-worker-cloud-v1';
export class CloudSync {
  constructor({ storage, fetcher = (...args) => fetch(...args), onStatus = () => {} }) {
    this.storage = storage; this.fetcher = fetcher; this.onStatus = onStatus; this.token = ''; this.selected = false;
    this.revision = 0; this.queue = []; this.ready = false; this.running = false; this.conflict = false;
    try {
      const saved = JSON.parse(storage.getItem(SYNC_KEY) || 'null');
      if (saved && Number.isSafeInteger(saved.revision) && Array.isArray(saved.queue)) { this.revision = saved.revision; this.queue = saved.queue; }
    } catch { this.cacheFailed = true; }
  }
  persist() {
    try { this.storage.setItem(SYNC_KEY, JSON.stringify({ revision: this.revision, queue: this.queue })); this.cacheFailed = false; }
    catch { this.cacheFailed = true; this.onStatus('本机存储已满，请保持页面打开并导出备份', true); }
  }
  async request(query = '') {
    const response = await this.fetcher(`https://football-standings-api.junkaizhao404.workers.dev/api/records${query}`, { headers: { authorization: `Bearer ${this.token}` }, cache: 'no-store', signal: AbortSignal.timeout(15000) });
    const body = await readResponse(response);
    if (!response.ok) throw new Error(body.error || '无法连接云端存档');
    return body;
  }
  async connect(token) {
    if (this.running) throw new Error('请等待当前同步完成');
    this.token = token;
    const latest = await this.request();
    this.ready = true;
    if (!this.queue.length) this.revision = latest.revision;
    this.persist();
    this.selected = this.queue.length > 0;
    this.onStatus(`已连接 · 云端版本 ${latest.revision}，请选择上传本机或读取云端`);
    if (this.queue.length) await this.flush();
    return latest;
  }
  disconnect() { this.ready = false; this.selected = false; this.token = ''; this.onStatus('云端已断开，本机仍会保存'); }
  async migrate(records, state) {
    if (!this.ready || this.running || this.queue.length) throw new Error('请先连接云端并处理待同步提交');
    this.running = true;
    try {
      for (const item of records) {
        const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(item.submission_id));
        const hash = [...new Uint8Array(bytes)].map(x => x.toString(16).padStart(2, '0')).join('');
        const response = await this.post({ id: `history-${hash}`, baseRevision: 0, action: `迁移本机历史：${item.action}`.slice(0, 120), state: item.state, createdAt: item.created_at, archiveOnly: true });
        const result = await readResponse(response); if (!response.ok) throw new Error(result.error || '迁移历史失败，可重新上传续传');
      }
      const latest = await this.request(); this.revision = latest.revision; this.selected = true;
      this.enqueue(state, '迁移本机当前积分榜');
    } finally { this.running = false; }
    await this.flush();
  }
  post(item) {
    return this.fetcher('https://football-standings-api.junkaizhao404.workers.dev/api/records', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${this.token}` }, body: JSON.stringify(item), signal: AbortSignal.timeout(15000) });
  }
  enqueue(state, action) {
    this.queue.push({ id: createId('submission'), state: structuredClone(state), action, createdAt: new Date().toISOString() });
    this.persist();
    this.onStatus(`待同步 ${this.queue.length} 次提交${this.cacheFailed ? ' · 本机缓存失败' : ''}`, true);
    if (this.ready) void this.flush();
  }
  async flush() {
    if (this.running || this.conflict || !this.ready) return;
    this.running = true;
    try {
      while (this.queue.length) {
        const item = this.queue[0];
        // Persist the original base revision so a lost response can be retried idempotently.
        item.baseRevision ??= this.revision; this.persist();
        const response = await this.post(item);
        const result = await readResponse(response);
        if (response.status === 409 && result.archived) {
          this.conflict = true; this.onStatus('其他页面有更新 · 本次提交已存入历史，请处理冲突', true); return;
        }
        if (!response.ok) throw new Error(result.error || '同步失败');
        this.revision = result.revision; this.queue.shift(); this.persist();
      }
      this.onStatus(`已保存到云端 · 版本 ${this.revision}${this.cacheFailed ? ' · 本机缓存失败' : ''}`, Boolean(this.cacheFailed));
    } catch (error) { this.onStatus(`待同步 ${this.queue.length} 次提交 · ${error.message}`, true); }
    finally { this.running = false; }
  }
  async retry() { await this.flush(); }
  async resolve(useLocal, onState) {
    if (this.running) return;
    this.running = true;
    try {
      const local = this.queue.at(-1)?.state;
      // Archive every pending edit before resolving; never discard unsent snapshots.
      for (const item of this.queue) {
        item.baseRevision ??= this.revision;
        const response = await this.post({ ...item, archiveOnly: true });
        if (!response.ok) throw new Error('历史存档失败，尚未清除本机待同步数据');
      }
      const latest = await this.request();
      this.revision = latest.revision; this.queue = []; this.conflict = false; this.persist();
      if (useLocal && local) this.enqueue(local, '处理冲突：应用本机版本');
      else if (latest.state) onState(latest.state);
      this.onStatus('历史已保留，冲突已处理');
    } finally { this.running = false; }
    await this.flush();
  }
}
