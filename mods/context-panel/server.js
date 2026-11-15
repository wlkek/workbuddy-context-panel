/* 上下文面板 —— 主进程服务
 * ------------------------------------------------------------------
 * 由 loader/injector.js 在主进程里 require。
 * 重活（读 SQLite、解析 transcript）交给 worker_threads，主进程只做调度，
 * 避免点击面板时把客户端界面卡住。
 *
 * 对外接口：
 *   call(op, args, onProgress) -> Promise
 *   start() / stop()
 */
'use strict';

const fs = require('fs');
const path = require('path');

const LOG = path.join(__dirname, '..', '..', 'loader.log');
const ANALYZE = path.join(__dirname, 'analyze.js');
const OVERVIEW_TTL = 4000;

let worker = null;
let workerBroken = false;
let seq = 0;
const pending = new Map();

let inlineMod = null;
let overviewCache = null;
let overviewAt = 0;
const detailCache = new Map();

function log(m) {
  try { fs.appendFileSync(LOG, '[' + new Date().toISOString() + '] server ' + m + '\n'); } catch (e) { /* ignore */ }
}

function hasWorker() {
  if (worker || workerBroken) return !!worker;
  try {
    const { Worker } = require('worker_threads');
    worker = new Worker(ANALYZE);
    worker.on('message', (msg) => {
      const p = pending.get(msg.id);
      if (!p) return;
      if (msg.progress) {
        if (p.onProgress) { try { p.onProgress(msg.progress); } catch (e) { /* ignore */ } }
        return;
      }
      pending.delete(msg.id);
      clearTimeout(p.timer);
      if (msg.ok) p.resolve(msg.data);
      else p.reject(new Error(msg.error || 'worker error'));
    });
    worker.on('error', (e) => {
      workerBroken = true;
      log('worker error: ' + ((e && e.message) || e));
      for (const [id, p] of pending) { clearTimeout(p.timer); p.reject(e); }
      pending.clear();
      try { worker.terminate(); } catch (err) { /* ignore */ }
      worker = null;
    });
    worker.on('exit', () => { worker = null; });
    worker.unref();
    log('worker started');
  } catch (e) {
    workerBroken = true;
    log('worker unavailable: ' + ((e && e.message) || e));
  }
  return !!worker;
}

function inline() {
  if (!inlineMod) inlineMod = require(ANALYZE);
  return inlineMod;
}

function run(op, args, onProgress) {
  if (hasWorker()) {
    const id = ++seq;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error('分析超时（60 秒）'));
      }, 60000);
      pending.set(id, { resolve: resolve, reject: reject, timer: timer, onProgress: onProgress });
      worker.postMessage({ id: id, op: op, args: args || {} });
    });
  }
  return new Promise((resolve, reject) => {
    try {
      const m = inline();
      if (op === 'overview') resolve(m.buildOverview());
      else if (op === 'session') resolve(m.trimDetail(m.sessionDetail(args.sid)));
      else reject(new Error('unknown op: ' + op));
    } catch (e) { reject(e); }
  });
}

function currentSig(sid, data) {
  if (!data || !data.transcript) return '';
  try {
    const st = fs.statSync(data.transcript);
    return Math.trunc(st.mtimeMs / 1000) + '-' + st.size;
  } catch (e) { return ''; }
}

function cacheGet(sid) {
  const hit = detailCache.get(sid);
  if (!hit) return null;
  if (currentSig(sid, hit.data) !== hit.sig) { detailCache.delete(sid); return null; }
  return hit.data;
}

function cachePut(sid, data) {
  if (!data || !data.transcript) return;
  detailCache.set(sid, { sig: currentSig(sid, data), data: data });
  if (detailCache.size > 4) {
    const first = detailCache.keys().next().value;
    detailCache.delete(first);
  }
}

const api = {
  call(op, args, onProgress) {
    if (op === 'health') {
      return Promise.resolve({ ok: true, worker: !!worker, workerBroken: workerBroken });
    }

    if (op === 'overview') {
      if (overviewCache && Date.now() - overviewAt < OVERVIEW_TTL) {
        return Promise.resolve(overviewCache);
      }
      return run('overview', {}, onProgress).then((d) => {
        overviewCache = d;
        overviewAt = Date.now();
        log('overview ' + d.sessions.length + ' sessions in ' + d.elapsed_ms + 'ms');
        return d;
      });
    }

    if (op === 'session') {
      const sid = args && args.sid;
      if (!sid) return Promise.reject(new Error('缺少会话 id'));
      const hit = cacheGet(sid);
      if (hit) return Promise.resolve(hit);
      return run('session', { sid: sid }).then((d) => {
        cachePut(sid, d);
        log('session ' + String(sid).slice(0, 8) + ' points=' + (d.points || []).length);
        return d;
      });
    }

    return Promise.reject(new Error('unknown op: ' + op));
  },

  start() {
    hasWorker();
    /* 预热索引：客户端启动后先算一遍，用户点开面板时多半已命中缓存。
     * 延迟 1.5 秒，避开客户端自身的启动高峰。 */
    const t = setTimeout(() => {
      api.call('overview').then(() => log('warm done')).catch((e) => log('warm failed: ' + ((e && e.message) || e)));
    }, 1500);
    if (t.unref) t.unref();
  },

  stop() {
    if (worker) { try { worker.terminate(); } catch (e) { /* ignore */ } worker = null; }
    pending.clear();
  },
};

module.exports = api;
