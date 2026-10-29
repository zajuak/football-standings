import { createId } from './core.mjs';
export const LOCAL_QUEUE_KEY = 'pku-football-local-history-queue-v1';

export class IndexedArchive {
  constructor(factory = globalThis.indexedDB) { this.factory = factory; }
  async open() {
    if (!this.connection) this.connection = new Promise((resolve, reject) => {
      if (!this.factory) { reject(new Error('当前浏览器不支持历史存档，请导出备份')); return; }
      const request = this.factory.open('pku-football-standings-history-v1', 1);
      request.onupgradeneeded = () => {
        const store = request.result.createObjectStore('submissions', { keyPath: 'revision', autoIncrement: true });
        store.createIndex('submission_id', 'submission_id', { unique: true });
      };
      request.onsuccess = () => { request.result.onversionchange = () => request.result.close(); resolve(request.result); };
      request.onerror = () => { this.connection = null; reject(request.error); };
      request.onblocked = () => { this.connection = null; reject(new Error('请关闭其他旧版积分榜页面后重试')); };
    });
    return this.connection;
  }
  async append(item) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('submissions', 'readwrite');
      const store = tx.objectStore('submissions'); let revision;
      const find = store.index('submission_id').get(item.id);
      find.onsuccess = () => {
        if (find.result) { revision = find.result.revision; return; }
        const add = store.add({ submission_id: item.id, action: item.action, state: item.state, created_at: item.createdAt, applied: 1 });
        add.onsuccess = () => { revision = add.result; };
      };
      tx.oncomplete = () => resolve(revision);
      tx.onabort = () => reject(tx.error || new Error('本机存档失败'));
      tx.onerror = () => {};
    });
  }
  async get(revision) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const request = db.transaction('submissions').objectStore('submissions').get(revision);
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
  }
  async list(before = Number.MAX_SAFE_INTEGER, full = false) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const items = [];
      const request = db.transaction('submissions').objectStore('submissions').openCursor(IDBKeyRange.upperBound(before, true), 'prev');
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor || items.length === 50) { resolve({ items, next: items.length === 50 ? items.at(-1).revision : null }); return; }
        const { state, ...metadata } = cursor.value;
        items.push(full ? { ...metadata, state } : metadata); cursor.continue();
      };
      request.onerror = () => reject(request.error);
    });
  }
  async latest() {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const request = db.transaction('submissions').objectStore('submissions').openCursor(null, 'prev');
      request.onsuccess = () => resolve(request.result?.value ?? null);
      request.onerror = () => reject(request.error);
    });
  }
}

export class LocalHistory {
  constructor({ storage, archive = new IndexedArchive(), onStatus = () => {}, onState = () => {} }) {
    this.storage = storage; this.archive = archive; this.onStatus = onStatus; this.onState = onState;
    this.revision = 0; this.queue = []; this.running = false; this.ready = false; this.conflict = false;
    try { const saved = JSON.parse(storage.getItem(LOCAL_QUEUE_KEY) || 'null'); if (Array.isArray(saved)) this.queue = saved; } catch {}
  }
  persist() {
    try { this.storage.setItem(LOCAL_QUEUE_KEY, JSON.stringify(this.queue)); this.cacheFailed = false; }
    catch { this.cacheFailed = true; }
  }
  async init(fallback) {
    try {
      const latest = await this.archive.latest(); this.ready = true;
      if (this.queue.length) { this.onState(this.queue.at(-1).state); await this.flush(); }
      else if (latest) { this.revision = latest.revision; this.onState(latest.state); this.onStatus(`已保存到本机 · 版本 ${this.revision}`); }
      else this.enqueue(fallback, '首次保存本机数据');
    } catch (error) { this.onStatus(`历史存档不可用 · ${error.message}`, true); }
  }
  enqueue(state, action) {
    this.queue.push({ id: createId('submission'), state: structuredClone(state), action, createdAt: new Date().toISOString() });
    this.persist(); this.onStatus(`正在保存 ${this.queue.length} 次提交${this.cacheFailed ? ' · 缓存失败，请先导出当前数据' : ''}`, true);
    if (this.ready) void this.flush();
  }
  async flush() {
    if (this.running || !this.ready) return;
    this.running = true;
    try {
      while (this.queue.length) {
        this.revision = await this.archive.append(this.queue[0]); this.queue.shift(); this.persist();
      }
      this.onStatus(`已保存到本机 · 版本 ${this.revision}${this.cacheFailed ? ' · 缓存不可用，请导出备份' : ''}`, Boolean(this.cacheFailed));
    } catch (error) { this.onStatus(`有 ${this.queue.length} 次提交尚未存档 · ${error.message}`, true); }
    finally { this.running = false; }
  }
  async retry(state) { if (!this.ready) await this.init(state); else await this.flush(); }
  async importHistory(records) {
    if (!this.ready) throw new Error('请先启用本机历史存档');
    if (this.queue.length) throw new Error('请先等待当前修改保存完成');
    for (const item of records) {
      await this.archive.append({ id: `import-${item.submission_id ?? item.id ?? createId()}`, state: item.state,
        action: `导入历史：${item.action ?? '备份记录'}`, createdAt: item.created_at ?? item.createdAt ?? new Date().toISOString() });
    }
  }
  async request(query = '') {
    const params = new URLSearchParams(query.replace(/^\?/, ''));
    if (params.has('history')) return this.archive.list(Number(params.get('before') ?? Number.MAX_SAFE_INTEGER), params.has('full'));
    if (params.has('revision')) {
      const saved = await this.archive.get(Number(params.get('revision')));
      if (!saved) throw new Error('未找到该历史版本'); return saved;
    }
    const saved = await this.archive.latest(); return saved ? { revision: saved.revision, state: saved.state } : { revision: 0, state: null };
  }
}
