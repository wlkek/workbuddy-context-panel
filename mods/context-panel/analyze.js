/* 上下文面板 —— 分析层
 * ------------------------------------------------------------------
 * 在 worker_threads 里运行，读 ~/.workbuddy 下的 SQLite 与 transcript，
 * 口径沿用 dsh-context 的统计方式，解析按 WorkBuddy 的 transcript 结构重写：
 *
 *   一次请求 = 一条带 providerData.usage.inputTokens 的记录
 *   固定开销 = 首个请求的 inputTokens − 当时可见内容（估算）
 *   各分类占比按估算长度缩放，锚定实测 inputTokens
 *
 * 只读，不写 ~/.workbuddy 下任何文件。索引缓存在 %LOCALAPPDATA%\WbMods\cache。
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const WB_HOME = path.join(os.homedir(), '.workbuddy');
const DB_PATH = path.join(WB_HOME, 'workbuddy.db');
const PROJECTS = path.join(WB_HOME, 'projects');
const STORAGE = path.join(WB_HOME, 'storage');
const CACHE_DIR = path.join(__dirname, '..', '..', 'cache');
const CACHE_FILE = path.join(CACHE_DIR, 'index.json');

const CONVO_KEYS = ['user', 'injected', 'assistant', 'reasoning', 'toolResult'];
const WRITE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'str_replace_editor']);
const READ_TOOLS = new Set(['Read', 'NotebookRead']);
const SEARCH_TOOLS = new Set(['Grep', 'Glob', 'Search', 'WebSearch', 'WebFetch']);
const SKIP_TYPES = new Set(['session-meta', 'ai-title', 'file-history-snapshot']);

/* ---------------- 基础工具 ---------------- */

/* 一次扫描同时数 CJK 与代理对：Python 的 len() 按码点算，
 * JS 的 length 按 UTF-16 单元算，emoji 会让结果差 1 token 左右。 */
const CJK_RE = /[\u3000-\u9fff\uff00-\uffef\u3040-\u30ff]|([\uD800-\uDBFF][\uDC00-\uDFFF])/g;

function estTokens(text) {
  if (!text) return 0;
  const s = String(text);
  let cjk = 0;
  let astral = 0;
  let m;
  CJK_RE.lastIndex = 0;
  while ((m = CJK_RE.exec(s)) !== null) {
    if (m[1]) astral += 1;
    else cjk += 1;
  }
  const other = s.length - cjk - astral;
  return Math.trunc(cjk * 0.7 + other * 0.25);
}

function dayKey(ms) {
  const d = new Date(ms);
  const p = (n) => (n < 10 ? '0' + n : String(n));
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}

function textOf(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    let buf = '';
    for (const c of content) {
      if (typeof c === 'string') buf += c;
      else if (c && typeof c === 'object' && typeof c.text === 'string') buf += c.text;
    }
    return buf;
  }
  if (content && typeof content === 'object' && typeof content.text === 'string') return content.text;
  return '';
}

function argsOf(arguments_) {
  if (arguments_ && typeof arguments_ === 'object' && !Array.isArray(arguments_)) return arguments_;
  if (typeof arguments_ === 'string') {
    try {
      const v = JSON.parse(arguments_);
      return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
    } catch (e) { return {}; }
  }
  return {};
}

function classifyUserText(text) {
  const t = String(text).replace(/^\s+/, '');
  const prefixes = ['<system-reminder', '<identity', '<user-context', '<project_context',
    '<available', '<connector-status', '<wecom'];
  for (const p of prefixes) if (t.startsWith(p)) return 'injected';
  return 'user';
}

/* ---------------- 数据访问 ---------------- */

let sqlite = null;

function ensureSqlite() {
  if (sqlite) return sqlite;
  sqlite = require('node:sqlite');
  return sqlite;
}

function openDb() {
  const s = ensureSqlite();
  if (!fs.existsSync(DB_PATH)) throw new Error('找不到会话库：' + DB_PATH);
  return new s.DatabaseSync(DB_PATH, { readOnly: true });
}

function listSessions(limit) {
  const db = openDb();
  try {
    const rows = db.prepare(
      'SELECT s.id, s.cwd, s.title, s.custom_title, s.model, s.mode,' +
      '       s.status, s.created_at, s.updated_at, s.last_activity_at,' +
      '       s.context_window, u.used, u.size, u.credit_json' +
      '  FROM sessions s' +
      '  LEFT JOIN session_usage u ON u.session_id = s.id' +
      ' WHERE s.deleted_at IS NULL' +
      ' ORDER BY COALESCE(s.updated_at, 0) DESC' +
      ' LIMIT ?'
    ).all(limit || 300);

    return rows.map((r) => {
      let credits = null;
      try {
        const obj = JSON.parse(r.credit_json || '{}') || {};
        const vals = Object.keys(obj).map((k) => Number(obj[k]) || 0);
        credits = vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) * 100) / 100 : null;
      } catch (e) { credits = null; }
      return {
        id: r.id,
        cwd: r.cwd || '',
        title: r.title || r.custom_title || '(未命名会话)',
        model: r.model || '',
        mode: r.mode || '',
        status: r.status || '',
        created_at: r.created_at,
        updated_at: r.updated_at || r.created_at,
        used: r.used == null ? null : Number(r.used),
        size: r.size == null ? null : Number(r.size),
        credits: credits,
      };
    });
  } finally {
    try { db.close(); } catch (e) { /* ignore */ }
  }
}

function loadSnapshots() {
  const merged = {};
  let dirs = [];
  try { dirs = fs.readdirSync(STORAGE, { withFileTypes: true }); } catch (e) { return merged; }
  for (const d of dirs) {
    if (!d.isDirectory()) continue;
    const scoped = path.join(STORAGE, d.name, 'scoped');
    let subs = [];
    try { subs = fs.readdirSync(scoped, { withFileTypes: true }); } catch (e) { continue; }
    for (const sub of subs) {
      if (!sub.isDirectory()) continue;
      const f = path.join(scoped, sub.name, 'conversationContextUsage.json');
      let data;
      try { data = JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { continue; }
      if (!data || typeof data !== 'object') continue;
      for (const sid of Object.keys(data)) {
        const item = data[sid];
        if (!item || typeof item !== 'object') continue;
        const prev = merged[sid];
        if (!prev || (Number(item.updatedAt) || 0) >= (Number(prev.updatedAt) || 0)) merged[sid] = item;
      }
    }
  }
  return merged;
}

function transcriptPath(sid) {
  let dirs = [];
  try { dirs = fs.readdirSync(PROJECTS, { withFileTypes: true }); } catch (e) { return null; }
  let best = null;
  let bestSize = -1;
  for (const d of dirs) {
    if (!d.isDirectory()) continue;
    const p = path.join(PROJECTS, d.name, sid + '.jsonl');
    let st;
    try { st = fs.statSync(p); } catch (e) { continue; }
    if (!st.isFile()) continue;
    if (st.size > bestSize) { best = p; bestSize = st.size; }
  }
  return best;
}

function iterRecords(file) {
  const out = [];
  let raw;
  try { raw = fs.readFileSync(file, 'utf8'); } catch (e) { return out; }
  const lines = raw.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    try { out.push(JSON.parse(line)); } catch (e) { /* 坏行跳过 */ }
  }
  return out;
}

/* ---------------- 单会话分析 ---------------- */

function trackFile(filesAgg, name, args) {
  const p = args.file_path || args.path || args.notebook_path;
  if (typeof p !== 'string' || !p) return;
  let op = '';
  if (WRITE_TOOLS.has(name)) op = 'write';
  else if (READ_TOOLS.has(name)) op = 'read';
  else if (SEARCH_TOOLS.has(name)) op = 'search';
  else return;
  if (!filesAgg[p]) filesAgg[p] = { path: p, ops: { read: 0, write: 0, search: 0 } };
  filesAgg[p].ops[op] += 1;
}

function programOf(cmd) {
  let s = String(cmd).trim();
  for (let i = 0; i < 3; i++) {
    const m = s.match(/^cd\s+[^&|;]+?\s*&&\s*/);
    if (!m) break;
    s = s.slice(m[0].length).trim();
  }
  if (!s) return '';
  let token;
  const q0 = s[0];
  if (q0 === '"' || q0 === "'") {
    const end = s.indexOf(q0, 1);
    token = end > 0 ? s.slice(1, end) : s.slice(1);
  } else {
    token = s.split(/\s+/)[0];
  }
  token = token.replace(/^["']+|["']+$/g, '');
  const parts = token.split(/[\\/]/);
  return parts[parts.length - 1].slice(0, 40);
}

function trackCommand(cmdsAgg, name, args, ts) {
  if (name !== 'Bash' && name !== 'PowerShell' && name !== 'run_command') return;
  const cmd = args.command || args.cmd || '';
  if (typeof cmd !== 'string' || !cmd.trim()) return;
  const prog = programOf(cmd);
  if (!prog) return;
  if (!cmdsAgg[prog]) cmdsAgg[prog] = { program: prog, count: 0, last_ts: 0 };
  cmdsAgg[prog].count += 1;
  cmdsAgg[prog].last_ts = Math.max(cmdsAgg[prog].last_ts, Number(ts) || 0);
}

function turnsOf(points) {
  const out = [];
  for (const p of points) {
    if (!out.length || out[out.length - 1].id !== p.id) {
      out.push({ id: p.id, ts: p.ts, points: 0, peak: 0, last: 0, credits: 0 });
    }
    const t = out[out.length - 1];
    t.points += 1;
    t.peak = Math.max(t.peak, p['in']);
    t.last = p['in'];
    t.credits += p.credits;
  }
  return out;
}

function finalize(points, result, hasSnap, snapCats) {
  if (!points.length) {
    result.base = { fixed: 0, estimated: true, snapshot: null };
    return;
  }
  const first = points[0];
  const cumSum = first.cum ? CONVO_KEYS.reduce((a, k) => a + (first.cum[k] || 0), 0) : 0;
  const fixed = first['in'] ? Math.max(0, first['in'] - cumSum) : 0;

  result.base = {
    fixed: fixed,
    estimated: true,
    snapshot: hasSnap ? {
      system: Math.trunc(Number(snapCats.systemPrompt) || 0),
      tools: Math.trunc(Number(snapCats.tools) || 0),
      mcp: Math.trunc(Number(snapCats.mcp) || 0),
      skills: Math.trunc(Number(snapCats.skills) || 0),
    } : null,
  };

  let prev = 0;
  for (const p of points) {
    const cum = p.cum || {};
    let est = 0;
    for (const k of CONVO_KEYS) est += cum[k] || 0;
    const target = Math.max(0, p['in'] - fixed);
    const cats = { fixed: Math.min(fixed, p['in']) };
    if (target > 0 && est > 0) {
      const factor = target / est;
      for (const k of CONVO_KEYS) cats[k] = Math.trunc((cum[k] || 0) * factor);
    } else if (target > 0) {
      cats.injected = target;
    }
    p.cats = cats;
    p.delta = p['in'] - prev;
    if (prev && !p.compaction && p['in'] < prev * 0.75) {
      p.compaction = true;
      result.events.push({ kind: 'compact', ts: p.ts, text: '窗口回落 ' + (prev - p['in']).toLocaleString('en-US') + ' tokens' });
    }
    if (p.compaction) {
      p.reclaimed = Math.max(0, prev - p['in']);
      result.totals.compactions += 1;
    }
    prev = p['in'];
  }

  result.points = points;
  const tot = result.totals;
  tot.requests = points.length;
  tot.input = points.reduce((a, p) => a + p['in'], 0);
  tot.output = points.reduce((a, p) => a + p.out, 0);
  tot.cached = points.reduce((a, p) => a + p.cached, 0);
  tot.credits = Math.round(points.reduce((a, p) => a + p.credits, 0) * 100) / 100;
}

function analyzeSession(sessionId, snap, credits) {
  const file = transcriptPath(sessionId);
  const result = {
    session_id: sessionId,
    transcript: file || null,
    points: [],
    turns: [],
    tools: [],
    files: [],
    commands: [],
    events: [],
    base: { fixed: 0, estimated: true, snapshot: null },
    totals: {
      requests: 0, turns: 0, input: 0, output: 0, cached: 0,
      credits: 0, tool_calls: 0, tool_ms: 0, compactions: 0,
    },
  };
  credits = credits || {};
  if (!file) return result;

  const snapCats = (snap && snap.usageByCategory) || {};
  const hasSnap = Object.keys(snapCats).length > 0;

  const cum = { user: 0, injected: 0, assistant: 0, reasoning: 0, toolResult: 0 };
  const points = [];
  const seen = new Map();
  const calls = {};
  const toolsAgg = {};
  const filesAgg = {};
  const cmdsAgg = {};
  const credited = new Set();

  for (const rec of iterRecords(file)) {
    const t = rec.type;
    if (SKIP_TYPES.has(t)) continue;
    const pd = rec.providerData || {};
    const ts = Math.trunc(Number(rec.timestamp) || 0);
    const rid = pd.conversationRequestId || '';
    const agent = String(pd.agent || '').toLowerCase();
    const isCompact = agent === 'compact';
    const step = Number.isInteger(pd.stepSeq) ? pd.stepSeq : 0;

    const usage = pd.usage;
    if (usage && typeof usage === 'object' && usage.inputTokens && rid) {
      const key = rid + '\u0000' + step;
      const inp = Math.trunc(Number(usage.inputTokens) || 0);
      const out = Math.trunc(Number(usage.outputTokens) || 0);
      const det = usage.inputTokensDetails || [];
      const cached = Array.isArray(det) && det.length ? Math.trunc(Number((det[0] || {}).cached_tokens) || 0) : 0;
      const pt = seen.get(key);
      if (!pt) {
        const p = {
          id: rid, step: step, ts: ts,
          'in': inp, out: out, cached: cached, credits: 0,
          model: pd.requestModelId || pd.model || '',
          cum: Object.assign({}, cum),
          compaction: false, reclaimed: 0,
        };
        if (!credited.has(rid)) {
          p.credits = Number(credits[rid]) || 0;
          credited.add(rid);
        }
        points.push(p);
        seen.set(key, p);
      } else {
        pt['in'] = Math.max(pt['in'], inp);
        pt.out = Math.max(pt.out, out);
        pt.cached = Math.max(pt.cached, cached);
      }
    }

    if (t === 'message') {
      const role = rec.role;
      const text = textOf(rec.content);
      if (!text) continue;
      if (role === 'user') {
        if (isCompact) {
          if (points.length) points[points.length - 1].compaction = true;
          continue;
        }
        cum[classifyUserText(text)] += estTokens(text);
      } else if (role === 'assistant') {
        if (isCompact) {
          if (points.length) points[points.length - 1].compaction = true;
          result.events.push({ kind: 'compact', ts: ts, text: '压缩摘要生成' });
        } else {
          cum.assistant += estTokens(text);
        }
      }
    } else if (t === 'reasoning') {
      if (!isCompact) {
        const text = textOf(rec.rawContent) || textOf(rec.content);
        if (text) cum.reasoning += estTokens(text);
      }
    } else if (t === 'function_call') {
      const name = rec.name || '?';
      const args = argsOf(rec.arguments);
      calls[rec.callId || ''] = { name: name, ts: ts, args: args };
      if (!toolsAgg[name]) toolsAgg[name] = { name: name, count: 0, ms: 0, output: 0 };
      toolsAgg[name].count += 1;
      trackFile(filesAgg, name, args);
      trackCommand(cmdsAgg, name, args, ts);
    } else if (t === 'function_call_result') {
      const info = calls[rec.callId || ''] || {};
      const name = rec.name || info.name || '?';
      const text = textOf(rec.output);
      const est = estTokens(text);
      cum.toolResult += est;
      if (!toolsAgg[name]) toolsAgg[name] = { name: name, count: 0, ms: 0, output: 0 };
      toolsAgg[name].output += est;
      if (info.ts && ts) toolsAgg[name].ms += Math.max(0, ts - info.ts);
      const status = rec.status;
      if (status && status !== 'completed' && status !== 'success') {
        result.events.push({ kind: 'tool_error', ts: ts, text: name + ' · ' + status });
      }
    }
  }

  finalize(points, result, hasSnap, snapCats);

  result.tools = Object.keys(toolsAgg).map((k) => toolsAgg[k]).sort((a, b) => b.count - a.count);
  result.files = Object.keys(filesAgg).map((k) => filesAgg[k]).sort((a, b) => {
    const sa = a.ops.read + a.ops.write + a.ops.search;
    const sb = b.ops.read + b.ops.write + b.ops.search;
    return sb - sa;
  });
  result.commands = Object.keys(cmdsAgg).map((k) => cmdsAgg[k]).sort((a, b) => b.count - a.count);
  result.totals.tool_ms = result.tools.reduce((a, t) => a + t.ms, 0);
  result.totals.tool_calls = result.tools.reduce((a, t) => a + t.count, 0);
  result.totals.turns = new Set(points.map((p) => p.id)).size;
  try { result.transcript_size = fs.statSync(file).size; } catch (e) { result.transcript_size = 0; }
  result.turns = turnsOf(points);
  return result;
}

/* ---------------- 跨会话索引 ---------------- */

function summarize(file, credits) {
  let totIn = 0, totOut = 0, cached = 0, requests = 0, toolCalls = 0, compactions = 0, prevIn = 0;
  const daily = {};
  let firstTs = 0, lastTs = 0;
  const seen = new Set();
  const ridTs = {};
  credits = credits || {};

  for (const rec of iterRecords(file)) {
    const pd = rec.providerData || {};
    const rid = pd.conversationRequestId;
    const step = pd.stepSeq || 0;
    const ts = Math.trunc(Number(rec.timestamp) || 0);
    if (ts) {
      lastTs = Math.max(lastTs, ts);
      if (!firstTs) firstTs = ts;
    }
    if (rec.type === 'function_call') toolCalls += 1;
    const u = pd.usage;
    if (!(u && typeof u === 'object' && u.inputTokens && rid)) continue;
    const key = rid + '\u0000' + step;
    if (seen.has(key)) continue;
    seen.add(key);
    requests += 1;
    const i = Math.trunc(Number(u.inputTokens) || 0);
    const o = Math.trunc(Number(u.outputTokens) || 0);
    const det = u.inputTokensDetails || [];
    const c = Array.isArray(det) && det.length ? Math.trunc(Number((det[0] || {}).cached_tokens) || 0) : 0;
    totIn += i; totOut += o; cached += c;
    if (prevIn && i < prevIn * 0.75) compactions += 1;
    prevIn = i;
    if (ts) {
      if (!ridTs[rid]) ridTs[rid] = ts;
      const day = dayKey(ts);
      if (!daily[day]) daily[day] = [0, 0, 0];
      daily[day][0] += i;
      daily[day][2] += 1;
    }
  }

  let creditSum = 0;
  for (const rid of Object.keys(credits)) {
    const v = Number(credits[rid]) || 0;
    creditSum += v;
    const ts = ridTs[rid];
    if (!ts) continue;
    const day = dayKey(ts);
    if (!daily[day]) daily[day] = [0, 0, 0];
    daily[day][1] += v;
  }

  let size = 0;
  try { size = fs.statSync(file).size; } catch (e) { size = 0; }

  return {
    'in': totIn, out: totOut, cached: cached,
    requests: requests, tool_calls: toolCalls, compactions: compactions,
    credits: Math.round(creditSum * 100) / 100,
    first_ts: firstTs, last_ts: lastTs,
    daily: daily, size: size,
  };
}

function readCache() {
  try { return JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8')) || {}; } catch (e) { return {}; }
}

function writeCache(cache) {
  try {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    const tmp = CACHE_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(cache), 'utf8');
    fs.renameSync(tmp, CACHE_FILE);
  } catch (e) { /* 缓存失败不影响主流程 */ }
}

function buildOverview(onProgress) {
  const t0 = Date.now();
  const sessions = listSessions(300);
  const snaps = loadSnapshots();
  const cache = readCache();
  let changed = false;
  let done = 0;

  for (const s of sessions) {
    const sid = s.id;
    const snap = snaps[sid] || {};
    s.categories = snap.usageByCategory || {};
    s.snap_updated = snap.updatedAt || 0;

    const file = transcriptPath(sid);
    if (!file) { s.summary = null; continue; }
    let st;
    try { st = fs.statSync(file); } catch (e) { s.summary = null; continue; }
    const sig = Math.trunc(st.mtimeMs / 1000) + '-' + st.size;
    const hit = cache[sid];
    if (!hit || hit.sig !== sig) {
      let credits = {};
      try {
        const db = openDb();
        try {
          const row = db.prepare('select credit_json from session_usage where session_id = ?').get(sid);
          credits = row ? (JSON.parse(row.credit_json || '{}') || {}) : {};
        } finally { db.close(); }
      } catch (e) { credits = {}; }
      cache[sid] = { sig: sig, summary: summarize(file, credits) };
      changed = true;
    }
    s.summary = (cache[sid] || {}).summary || null;
    done += 1;
    if (onProgress && done % 8 === 0) onProgress(done, sessions.length);
  }

  if (changed) writeCache(cache);

  const alive = new Set(sessions.map((s) => s.id));
  const keys = Object.keys(cache);
  let trimmed = 0;
  for (const k of keys) if (!alive.has(k)) { delete cache[k]; trimmed += 1; }
  if (trimmed) writeCache(cache);

  const totals = {
    sessions: sessions.length, active: 0, tokens: 0, output: 0,
    credits: 0, cached: 0, tools: 0, compactions: 0, requests: 0,
  };
  const days = {};
  const composition = { system: 0, tools: 0, mcp: 0, skills: 0, conversation: 0 };

  for (const s of sessions) {
    const sm = s.summary || {};
    if (s.used) totals.active += 1;
    totals.tokens += sm['in'] || 0;
    totals.output += sm.out || 0;
    totals.cached += sm.cached || 0;
    totals.credits += sm.credits || 0;
    totals.tools += sm.tool_calls || 0;
    totals.compactions += sm.compactions || 0;
    totals.requests += sm.requests || 0;

    const daily = sm.daily || {};
    for (const day of Object.keys(daily)) {
      const v = daily[day];
      if (!days[day]) days[day] = { date: day, tokens: 0, credits: 0, requests: 0 };
      days[day].tokens += v[0] || 0;
      days[day].credits += v[1] || 0;
      days[day].requests += v[2] || 0;
    }

    const cats = s.categories || {};
    composition.system += Math.trunc(Number(cats.systemPrompt) || 0);
    composition.tools += Math.trunc(Number(cats.tools) || 0);
    composition.mcp += Math.trunc(Number(cats.mcp) || 0);
    composition.skills += Math.trunc(Number(cats.skills) || 0);
    composition.conversation += Math.trunc(Number(cats.conversation) || 0);
  }

  totals.credits = Math.round(totals.credits * 100) / 100;

  const now = Date.now();
  const series = [];
  for (let i = 13; i >= 0; i--) {
    const d = dayKey(now - i * 86400000);
    series.push(days[d] || { date: d, tokens: 0, credits: 0, requests: 0 });
  }

  return {
    sessions: sessions,
    totals: totals,
    days: series,
    composition: composition,
    elapsed_ms: Date.now() - t0,
    generated_at: Date.now(),
  };
}

function sessionDetail(sid, onProgress) {
  const sessions = listSessions(300);
  const meta = sessions.filter((s) => s.id === sid)[0] || { id: sid, title: '(找不到会话)', cwd: '', model: '' };
  const snap = loadSnapshots()[sid] || {};
  let credits = {};
  try {
    const db = openDb();
    try {
      const row = db.prepare('select credit_json from session_usage where session_id = ?').get(sid);
      credits = row ? (JSON.parse(row.credit_json || '{}') || {}) : {};
    } finally { db.close(); }
  } catch (e) { credits = {}; }

  const detail = analyzeSession(sid, snap, credits);
  detail.meta = meta;
  detail.snapshot = snap;
  return detail;
}

/* 详细结果太大，只保留 UI 需要的字段 */
function trimDetail(d) {
  return {
    session_id: d.session_id,
    transcript: d.transcript,
    transcript_size: d.transcript_size,
    points: d.points.map((p) => ({
      id: p.id, step: p.step, ts: p.ts,
      'in': p['in'], out: p.out, cached: p.cached, credits: p.credits,
      model: p.model, cats: p.cats, delta: p.delta,
      compaction: p.compaction, reclaimed: p.reclaimed,
    })),
    turns: d.turns,
    tools: d.tools.slice(0, 40),
    files: d.files.slice(0, 40),
    commands: d.commands.slice(0, 30),
    events: d.events.slice(-60),
    base: d.base,
    totals: d.totals,
    meta: d.meta,
    snapshot: d.snapshot,
  };
}

module.exports = {
  buildOverview: buildOverview,
  sessionDetail: sessionDetail,
  trimDetail: trimDetail,
  listSessions: listSessions,
  estimate: estTokens,
};

/* ---------------- worker 入口 ---------------- */

try {
  const wt = require('worker_threads');
  if (!wt.isMainThread && wt.parentPort) {
    wt.parentPort.on('message', (msg) => {
      const id = msg && msg.id;
      try {
        if (msg.op === 'overview') {
          const data = buildOverview((done, total) => {
            wt.parentPort.postMessage({ id: id, progress: { done: done, total: total } });
          });
          wt.parentPort.postMessage({ id: id, ok: true, data: data });
        } else if (msg.op === 'session') {
          wt.parentPort.postMessage({ id: id, ok: true, data: trimDetail(sessionDetail(msg.args.sid)) });
        } else if (msg.op === 'ping') {
          wt.parentPort.postMessage({ id: id, ok: true, data: { ok: true } });
        } else {
          wt.parentPort.postMessage({ id: id, ok: false, error: 'unknown op: ' + msg.op });
        }
      } catch (e) {
        wt.parentPort.postMessage({ id: id, ok: false, error: String((e && e.message) || e) });
      }
    });
  }
} catch (e) { /* 主线程里 require 时忽略 */ }
