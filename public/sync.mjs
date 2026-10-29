import { createId } from './core.mjs';
export const SYNC_KEY = 'pku-football-cloud-v1';
export class HistorySync {
  constructor({ storage, fetcher = (...args) => fetch(...args), onStatus = () => {}, onState = () => {} }) {
    this.storage = storage; this.fetcher = fetcher; this.onStatus = onStatus; this.onState = onState;
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
    const response = await this.fetcher(`/api/records${query}`, { cache: 'no-store', signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error('无法连接云端存档');
    return response.json();
  }
  async init(fallback) {
    try {
      const latest = await this.request();
      this.ready = true;
      if (this.queue.length) {
        this.onState(this.queue.at(-1).state);
        await this.flush();
      } else {
        this.revision = latest.revision; this.persist();
        if (latest.state) { this.onState(latest.state); this.onStatus('已同步云端 · 历史完整保留'); }
        else { this.enqueue(fallback, '首次保存初始数据'); }
      }
    } catch { this.onStatus('云端未连接 · 修改将等待同步', true); }
  }
  enqueue(state, action) {
    this.queue.push({ id: createId('submission'), state: structuredClone(state), action });
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
        const response = await this.fetcher('/api/records', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(item), signal: AbortSignal.timeout(15000) });
        const result = await response.json();
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
  async retry(state) {
    if (!this.ready) await this.init(state);
    else await this.flush();
  }
  async resolve(useLocal) {
    if (this.running) return;
    this.running = true;
    try {
      const local = this.queue.at(-1)?.state;
      // Archive every pending edit before resolving; never discard unsent snapshots.
      for (const item of this.queue) {
        item.baseRevision ??= this.revision;
        const response = await this.fetcher('/api/records', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...item, archiveOnly: true }), signal: AbortSignal.timeout(15000) });
        if (!response.ok) throw new Error('历史存档失败，尚未清除本机待同步数据');
      }
      const latest = await this.request();
      this.revision = latest.revision; this.queue = []; this.conflict = false; this.persist();
      if (useLocal && local) this.enqueue(local, '处理冲突：应用本机版本');
      else if (latest.state) this.onState(latest.state);
      this.onStatus('历史已保留，冲突已处理');
    } finally { this.running = false; }
    await this.flush();
  }
}
