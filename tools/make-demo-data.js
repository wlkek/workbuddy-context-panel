/* 生成完全虚构的演示数据，用来出 README 截图。
 * 不要用真实会话：标题、目录、模型名都会进图片。
 *
 * 用法：node tools/make-demo-data.js
 */
'use strict';

const fs = require('fs');
const path = require('path');

/* 固定种子，保证每次生成的图一样 */
let seed = 20261115;
function rnd() {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed / 2147483648;
}
function pick(arr) { return arr[Math.floor(rnd() * arr.length)]; }
function int(a, b) { return Math.floor(a + rnd() * (b - a + 1)); }

const TITLES = [
  '示例会话：整理发布流程',
  '示例会话：排查构建失败',
  '示例会话：重构设置页',
  '示例会话：补充单元测试',
  '示例会话：分析慢查询',
  '示例会话：整理接口文档',
  '示例会话：处理合并冲突',
  '示例会话：梳理依赖升级',
  '示例会话：优化首屏加载',
  '示例会话：检查日志格式',
  '示例会话：调整错误提示',
  '示例会话：清理无用资源',
];

const CWDS = ['D:/projects/demo-app', 'D:/projects/site-kit', 'D:/projects/api-service'];
const MODELS = ['gpt-4o', 'claude-3.7-sonnet'];

const now = Date.now();
const sessions = TITLES.map((title, i) => {
  const used = int(60, 720) * 1000;
  const size = 1000000;
  const conversations = Math.round(used * 0.78);
  return {
    id: 'demo-' + String(i + 1).padStart(2, '0'),
    cwd: pick(CWDS),
    title: title,
    model: pick(MODELS),
    mode: 'build',
    status: i === 0 ? 'working' : 'completed',
    created_at: now - (i + 1) * 3600 * 1000,
    updated_at: now - i * 1800 * 1000,
    used: used,
    size: size,
    credits: Math.round(int(20, 900) * 100) / 100,
    categories: {
      systemPrompt: int(3000, 12000),
      conversation: conversations,
      tools: int(9000, 42000),
      mcp: int(200, 1500),
      skills: int(800, 4000),
      version: 1,
    },
    snap_updated: now - i * 600000,
    summary: {
      in: used * int(9, 14),
      out: used * 2,
      cached: used * 8,
      requests: int(20, 400),
      tool_calls: int(10, 300),
      compactions: int(0, 3),
      credits: Math.round(int(20, 900) * 100) / 100,
      first_ts: now - (i + 2) * 86400000,
      last_ts: now - i * 3600000,
      daily: {},
      size: 1000000,
    },
  };
});

/* 近 14 天用量 */
const days = [];
for (let i = 13; i >= 0; i--) {
  const d = new Date(now - i * 86400000);
  const p = (n) => String(n).padStart(2, '0');
  days.push({
    date: d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()),
    tokens: i % 5 === 3 ? int(1, 9) * 1000000 : int(2, 40) * 1000000,
    credits: int(50, 600),
    requests: int(8, 240),
  });
}

const composition = sessions.reduce((a, s) => {
  a.system += s.categories.systemPrompt;
  a.tools += s.categories.tools;
  a.mcp += s.categories.mcp;
  a.skills += s.categories.skills;
  a.conversation += s.categories.conversation;
  return a;
}, { system: 0, tools: 0, mcp: 0, skills: 0, conversation: 0 });

const totals = sessions.reduce((a, s) => {
  a.sessions += 1;
  if (s.used) a.active += 1;
  a.tokens += s.summary.in;
  a.output += s.summary.out;
  a.cached += s.summary.cached;
  a.credits += s.summary.credits;
  a.tools += s.summary.tool_calls;
  a.compactions += s.summary.compactions;
  a.requests += s.summary.requests;
  return a;
}, { sessions: 0, active: 0, tokens: 0, output: 0, credits: 0, cached: 0, tools: 0, compactions: 0, requests: 0 });

const overview = {
  sessions: sessions,
  totals: totals,
  days: days,
  composition: composition,
  generated_at: now,
};

/* 详情页：160 个请求点，用于截图里的趋势图 */
const points = [];
let cum = { user: 30000, injected: 5000, assistant: 4000, reasoning: 12000, toolResult: 18000 };
for (let i = 0; i < 160; i++) {
  cum.user += int(200, 1800);
  cum.injected += int(20, 400);
  cum.assistant += int(100, 900);
  cum.reasoning += int(300, 3000);
  cum.toolResult += int(200, 2500);
  const sum = Object.keys(cum).reduce((a, k) => a + cum[k], 0);
  const fixed = 28000;
  const inp = fixed + sum;
  const cats = { fixed: fixed };
  for (const k of Object.keys(cum)) cats[k] = Math.round(cum[k] * 0.95);
  points.push({
    id: 'req-' + i,
    step: i + 1,
    ts: now - (160 - i) * 90000,
    in: inp,
    out: int(200, 1200),
    cached: Math.round(inp * 0.9),
    credits: Math.round(rnd() * 300) / 100,
    model: 'gpt-4o',
    cats: cats,
    delta: i ? inp - points[i - 1].in : inp,
    compaction: i === 96 || i === 132,
    reclaimed: 0,
  });
}

const session = {
  session_id: 'demo-01',
  transcript: 'D:/projects/demo-app/.cache/demo-transcript.jsonl',
  transcript_size: 4820000,
  points: points,
  turns: 24,
  tools: [
    { name: 'Read', count: 96, ms: 1240, output: 184000 },
    { name: 'Bash', count: 71, ms: 486000, output: 96000 },
    { name: 'Edit', count: 44, ms: 2100, output: 8200 },
    { name: 'Grep', count: 31, ms: 640, output: 41000 },
    { name: 'Write', count: 12, ms: 380, output: 2600 },
  ],
  files: [
    { path: 'D:/projects/demo-app/src/app.ts', ops: { read: 18, write: 6, search: 3 } },
    { path: 'D:/projects/demo-app/src/settings.tsx', ops: { read: 12, write: 9, search: 1 } },
    { path: 'D:/projects/demo-app/src/api/client.ts', ops: { read: 9, write: 2, search: 4 } },
  ],
  commands: [
    { program: 'npm', count: 26, last_ts: now - 3600000 },
    { program: 'git', count: 18, last_ts: now - 7200000 },
    { program: 'node', count: 9, last_ts: now - 10800000 },
  ],
  events: [
    { kind: 'compact', ts: now - 5400000, text: '窗口回落 42,180 tokens' },
    { kind: 'compact', ts: now - 1800000, text: '压缩摘要生成' },
  ],
  base: { fixed: 28000, estimated: true, snapshot: { system: 5200, tools: 14600, mcp: 640, skills: 1800 } },
  totals: {
    requests: points.length,
    turns: 24,
    input: points.reduce((a, p) => a + p.in, 0),
    output: points.reduce((a, p) => a + p.out, 0),
    cached: points.reduce((a, p) => a + p.cached, 0),
    credits: 412.6,
    tool_calls: 254,
    tool_ms: 490360,
    compactions: 2,
  },
  meta: sessions[0],
  snapshot: { usageByCategory: sessions[0].categories, updatedAt: now },
};
session.meta = Object.assign({}, sessions[0], {
  title: '示例会话：整理发布流程',
  cwd: 'D:/projects/demo-app',
  model: 'gpt-4o',
  mode: 'build',
});

const out = '/* 由 tools/make-demo-data.js 生成，纯虚构数据，仅供截图使用 */\n' +
  'window.__FIXTURE__ = ' + JSON.stringify({ overview: overview, session: session }) + ';\n';
fs.writeFileSync(path.join(__dirname, 'data.js'), out, 'utf8');
console.log('已生成演示数据', Math.round(out.length / 1024), 'KB');
