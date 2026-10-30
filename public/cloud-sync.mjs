import { createId } from './core.mjs';
import { contentFingerprint } from './state-content.mjs';

export const SYNC_KEY = 'pku-football-worker-cloud-v1';
const API = 'https://football-standings-api.junkaizhao404.workers.dev/api/records';
async function readResponse(response) {
  const raw = await response.text();
  try { return JSON.parse(raw); } catch { throw new Error('云端接口暂不可用，请稍后重试'); }
}

export class CloudSync {
  constructor({ storage, fetcher = (...args) => fetch(...args), onStatus = () => {}, onState = () => {}, canApplyState = () => true }) {
    this.storage = storage; this.fetcher = fetcher; this.onStatus = onStatus; this.onState = onState; this.canApplyState = canApplyState; this.generation = 0;
    this.revision = 0; this.queue = []; this.ready = false; this.running = false; this.connecting = false; this.conflict = false;
    this.confirmedFingerprint = null;
    try {
      const saved = JSON.parse(storage.getItem(SYNC_KEY) || 'null');
      if (saved && Number.isSafeInteger(saved.revision) && Array.isArray(saved.queue)) {
        this.revision = saved.revision; this.queue = saved.queue; this.confirmedFingerprint = saved.confirmedFingerprint ?? null;
      }
    } catch { this.cacheFailed = true; }
  }
  persist() {
    try {
      this.storage.setItem(SYNC_KEY, JSON.stringify({ revision: this.revision, queue: this.queue, confirmedFingerprint: this.confirmedFingerprint }));
      this.cacheFailed = false;
    } catch { this.cacheFailed = true; }
  }
  async send(options = {}, query = '') {
    // AbortSignal.timeout is absent on older iOS and embedded browsers.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await this.fetcher(`${API}${query}`, { ...options, signal: controller.signal });
      const body = await readResponse(response);
      return { response, body };
    } catch (error) {
      if (controller.signal.aborted) throw new Error('连接云端超时，请检查云端接口连通性或更换网络');
      if (error instanceof TypeError) throw new Error('无法访问云端接口，请检查网络是否能打开下方的连通性检查链接');
      throw error;
    } finally { clearTimeout(timer); }
  }
  async request(query = '') {
    const { response, body } = await this.send({ cache: 'no-store' }, query);
    if (!response.ok) throw new Error(body.error || '无法连接云端存档');
    return body;
  }
  async start(fallback) {
    if (this.connecting || this.running) return false;
    this.connecting = true;
    try {
      const latest = await this.request();
      this.ready = true;
      if (this.queue.length) {
        this.onState(this.queue.at(-1).state);
        await this.flush();
      } else {
        this.revision = latest.revision;
        this.confirmedFingerprint = contentFingerprint(latest.state ?? fallback);
        this.onState(latest.state ?? fallback);
        this.persist(); this.savedStatus();
      }
      return true;
    } catch (error) {
      this.onStatus(`连接云端失败 · ${error.message}，请点击重试`, true);
      return false;
    } finally { this.connecting = false; }
  }
  savedStatus() {
    this.onStatus(`已同步云端 · 版本 ${this.revision}${this.cacheFailed ? ' · 待同步缓存不可用，请导出备份' : ''}`, Boolean(this.cacheFailed));
  }
  enqueue(state, action) {
    const fingerprint = contentFingerprint(state);
    const previous = this.queue.length ? contentFingerprint(this.queue.at(-1).state) : this.confirmedFingerprint;
    if (fingerprint === previous) return false;
    this.generation++;
    this.queue.push({ id: createId('submission'), state: structuredClone(state), action, createdAt: new Date().toISOString() });
    this.persist(); this.onStatus(`待同步 ${this.queue.length} 次修改${this.cacheFailed ? ' · 请保持页面打开并导出备份' : ''}`, Boolean(this.cacheFailed));
    if (this.ready) void this.flush();
    return true;
  }
  post(item) {
    return this.send({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(item) });
  }
  async flush() {
    if (this.running || this.conflict || !this.ready) return;
    this.running = true;
    try {
      while (this.queue.length) {
        const item = this.queue[0];
        item.baseRevision ??= this.revision; this.persist();
        const { response, body: result } = await this.post(item);
        if (response.status === 409 && result.archived) {
          this.conflict = true; this.onStatus('其他页面有更新 · 本次修改已存入历史，请处理冲突', true); return;
        }
        if (!response.ok) throw new Error(result.error || '同步失败');
        this.revision = result.revision;
        this.confirmedFingerprint = contentFingerprint(item.state);
        this.queue.shift(); this.persist();
      }
      this.savedStatus();
    } catch (error) { this.onStatus(`待同步 ${this.queue.length} 次修改 · ${error.message}`, true); }
    finally { this.running = false; }
  }
  async refresh() {
    if (!this.ready || this.running || this.connecting || this.refreshing || this.queue.length || this.conflict) return false;
    this.refreshing = true;
    const generation = this.generation;
    try {
      const latest = await this.request();
      if (generation !== this.generation || this.queue.length || this.running || !this.canApplyState()) return false;
      if (latest.state) {
        const fingerprint = contentFingerprint(latest.state);
        if (fingerprint !== this.confirmedFingerprint) this.onState(latest.state);
        this.confirmedFingerprint = fingerprint;
      }
      this.revision = latest.revision; this.persist(); this.savedStatus();
      return true;
    } catch (error) { this.onStatus(`暂时无法读取云端 · ${error.message}`, true); return false; }
    finally { this.refreshing = false; }
  }
  async retry(fallback) {
    if (!this.ready) return this.start(fallback);
    await this.flush();
    return this.refresh();
  }
  async archiveRecords(records) {
    if (!this.ready || this.running || this.queue.length) throw new Error('请先完成同步并处理冲突');
    this.running = true;
    try {
      for (const item of records) {
        const source = item.submission_id ?? item.id ?? JSON.stringify(item);
        const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(source));
        const hash = [...new Uint8Array(bytes)].map(x => x.toString(16).padStart(2, '0')).join('');
        const { response, body: result } = await this.post({ id: `import-${hash}`, baseRevision: 0, action: `导入历史：${item.action ?? '备份记录'}`.slice(0, 120), state: item.state, createdAt: item.created_at ?? item.createdAt, archiveOnly: true });
        if (!response.ok) throw new Error(result.error || '导入历史失败，可重试续传');
      }
    } finally { this.running = false; }
  }
  async resolve(useLocal) {
    if (this.running || !this.conflict) return;
    this.running = true;
    try {
      const local = this.queue.at(-1)?.state;
      // Before resolving, preserve every unsent edit in the cloud history.
      for (const item of this.queue) {
        item.baseRevision ??= this.revision;
        const { response } = await this.post({ ...item, archiveOnly: true });
        if (!response.ok) throw new Error('历史存档失败，尚未清除待同步数据');
      }
      const latest = await this.request();
      this.revision = latest.revision;
      this.confirmedFingerprint = latest.state ? contentFingerprint(latest.state) : null;
      this.queue = []; this.conflict = false; this.persist();
      if (useLocal && local) this.enqueue(local, '处理冲突：应用本机版本');
      else if (latest.state) this.onState(latest.state);
    } finally { this.running = false; }
    await this.flush();
  }
}
