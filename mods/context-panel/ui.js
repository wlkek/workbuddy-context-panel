/* 上下文面板 —— 界面
 * ------------------------------------------------------------------
 * 由 loader/injector.js 注入到 WorkBuddy 主界面。
 *
 * 数据通道：window.__WB_CTX_PUSH({rid,op,args}) 交给主进程，
 * 结果通过 window.__WB_CTX_ON_REPLY 回来。没有轮询，没有本地端口。
 *
 * 样式全部放在 shadow DOM 里，不污染宿主页面。
 */
(function () {
  'use strict';

  var MOD = 'context-panel';
  var VERSION = '1.0.0';

  function log(m) {
    try { console.log('[context-panel] ' + m); } catch (e) { /* ignore */ }
  }

  if (window.__WB_CTX_PANEL__) return;
  window.__WB_CTX_PANEL__ = true;

  /* ---------------- 颜色 ---------------- */

  var root = null;
  var C = {
    bg: '#17181c',
    bg2: '#1d1f25',
    bg3: '#23262e',
    line: 'rgba(255,255,255,.075)',
    tx: '#d8dde8',
    tx2: '#8b93a3',
    tx3: '#656d7c',
    accent: '#5b9cf8',
    ok: '#3ddc97',
    warn: '#f5b544',
    bad: '#ef6b6b'
  };

  function hostIsLight() {
    try {
      var c = getComputedStyle(document.body).backgroundColor;
      var m = c.match(/\d+/g);
      if (!m) return false;
      if (m.length > 3 && Number(m[3]) === 0) return false;
      return (0.299 * m[0] + 0.587 * m[1] + 0.114 * m[2]) > 160;
    } catch (e) { return false; }
  }

  function readVar(names) {
    try {
      var cs = getComputedStyle(document.body);
      for (var i = 0; i < names.length; i++) {
        var v = cs.getPropertyValue(names[i]).trim();
        if (v) return v;
      }
    } catch (e) { /* ignore */ }
    return '';
  }

  var CAT_COLORS = {
    fixed: '#4b5563',
    user: '#4d93f8',
    injected: '#8b6cf0',
    assistant: '#34d399',
    reasoning: '#f2b23e',
    toolResult: '#e879a9'
  };
  var CAT_LABELS = {
    fixed: '固定开销',
    user: '用户输入',
    injected: '注入内容',
    assistant: '助手输出',
    reasoning: '推理',
    toolResult: '工具返回'
  };
  var COMPO_COLORS = {
    system: '#4d93f8',
    tools: '#8b6cf0',
    mcp: '#34d399',
    skills: '#f2b23e',
    conversation: '#e879a9'
  };
  var COMPO_LABELS = {
    system: '系统提示词',
    tools: '工具定义',
    mcp: 'MCP',
    skills: '技能注入',
    conversation: '对话内容'
  };

  /* ---------------- 宿主 ---------------- */

  var host = document.createElement('div');
  host.setAttribute('data-wb-ctx', '1');
  host.style.cssText = 'position:fixed;left:0;top:0;width:0;height:0;z-index:2147483000';
  (document.body || document.documentElement).appendChild(host);
  root = host.attachShadow({ mode: 'open' });

  var CSS = `
:host{all:initial}
*{box-sizing:border-box;margin:0;padding:0}
.fab{position:fixed;right:18px;bottom:18px;width:44px;height:44px;z-index:10;
  border:1px solid rgba(255,255,255,.1);border-radius:13px;
  background:rgba(32,35,42,.94);color:#cfd6e4;cursor:pointer;
  display:flex;align-items:center;justify-content:center;
  box-shadow:0 8px 24px rgba(0,0,0,.42);backdrop-filter:blur(8px);
  transition:background .16s,border-color .16s,transform .16s}
.fab:hover{background:rgba(44,48,58,.98);border-color:rgba(255,255,255,.16)}
.fab:active{transform:scale(.94)}
.fab svg{position:absolute;width:19px;height:19px;transition:opacity .2s,transform .26s cubic-bezier(.4,.1,.2,1)}
.fab .i-x{opacity:0;transform:rotate(-45deg) scale(.6)}
.fab.on .i-bar{opacity:0;transform:rotate(45deg) scale(.6)}
.fab.on .i-x{opacity:1;transform:none}
.panel{position:fixed;top:30px;right:0;bottom:0;width:420px;z-index:5;
  display:flex;flex-direction:column;overflow:hidden;contain:layout paint style;
  background:var(--p-bg);color:var(--p-tx);
  border-left:1px solid var(--p-line);
  transform:translate3d(100%,0,0);
  transition:transform .24s cubic-bezier(.32,.72,.28,1)}
.panel.anim{will-change:transform}
.panel.open{transform:none}
.grip{position:absolute;left:0;top:0;bottom:0;width:5px;cursor:col-resize;z-index:2}
.grip:hover{background:rgba(255,255,255,.06)}
.hd{flex:0 0 auto;height:52px;display:flex;align-items:center;gap:8px;
  padding:0 12px 0 16px;border-bottom:1px solid var(--p-line)}
.hd .t{font-size:13px;font-weight:600;letter-spacing:.01em;color:var(--p-tx)}
.hd .sub{font-size:11px;color:var(--p-tx3);margin-left:2px;font-weight:400}
.hd .sp{flex:1 1 auto}
.ico{width:26px;height:26px;border-radius:7px;border:1px solid transparent;
  background:transparent;color:var(--p-tx2);cursor:pointer;display:flex;
  align-items:center;justify-content:center;font-size:13px;line-height:1;
  transition:background .15s,color .15s}
.ico:hover{background:var(--p-bg3);color:var(--p-tx)}
.body{flex:1 1 auto;overflow-y:auto;overflow-x:hidden;padding:14px 16px 76px;
  scrollbar-width:thin;scrollbar-color:rgba(255,255,255,.16) transparent}
.body::-webkit-scrollbar{width:8px}
.body::-webkit-scrollbar-thumb{background:rgba(255,255,255,.14);border-radius:4px}
.ft{flex:0 0 auto;height:32px;display:flex;align-items:center;justify-content:space-between;
  gap:8px;padding:0 72px 0 16px;border-top:1px solid var(--p-line);
  font-size:10.5px;color:var(--p-tx3);letter-spacing:.02em}

.kpis{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:16px}
.kpi{background:var(--p-bg2);border:1px solid var(--p-line);border-radius:9px;
  padding:9px 11px;min-width:0}
.kpi .k{font-size:10.5px;color:var(--p-tx3);margin-bottom:3px;white-space:nowrap}
.kpi .v{font-size:17px;font-weight:600;color:var(--p-tx);font-variant-numeric:tabular-nums;
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.kpi .v small{font-size:10.5px;font-weight:400;color:var(--p-tx3);margin-left:3px}

.sec{margin-bottom:18px}
.sh{display:flex;align-items:center;gap:8px;margin-bottom:8px}
.sh h3{font-size:11px;font-weight:500;color:var(--p-tx2);letter-spacing:.04em}
.sh .sp{flex:1 1 auto}
.chips{display:flex;gap:4px}
.chip{font-size:10.5px;padding:2px 7px;border-radius:5px;border:1px solid var(--p-line);
  background:transparent;color:var(--p-tx3);cursor:pointer}
.chip.on{background:var(--p-bg3);color:var(--p-tx);border-color:rgba(255,255,255,.14)}

.card{background:var(--p-bg2);border:1px solid var(--p-line);border-radius:10px;padding:10px 12px}
.chart{position:relative;width:100%}
.chart canvas{display:block;width:100%;height:100%}
.tip{position:absolute;pointer-events:none;z-index:20;min-width:110px;
  background:#0f1013;border:1px solid rgba(255,255,255,.14);border-radius:7px;
  padding:6px 8px;font-size:11px;line-height:1.55;color:var(--p-tx);
  box-shadow:0 8px 20px rgba(0,0,0,.5);opacity:0;transition:opacity .1s}
.tip b{font-weight:600}
.tip .r{display:flex;justify-content:space-between;gap:10px;color:var(--p-tx2)}
.tip .r i{font-style:normal;color:var(--p-tx)}

.donut{display:flex;align-items:center;gap:14px}
.donut svg{flex:0 0 auto}
.legend{flex:1 1 auto;min-width:0;display:flex;flex-direction:column;gap:4px}
.lg{display:flex;align-items:center;gap:6px;font-size:11px;color:var(--p-tx2)}
.lg i{width:7px;height:7px;border-radius:2px;flex:0 0 auto}
.lg b{margin-left:auto;font-weight:500;color:var(--p-tx);font-variant-numeric:tabular-nums}

.stack{display:flex;height:14px;border-radius:7px;overflow:hidden;background:rgba(255,255,255,.05);gap:1px}
.stack i{display:block;height:100%}
.bars{display:flex;flex-direction:column;gap:7px;margin-top:10px}
.bar{display:grid;grid-template-columns:74px 1fr 56px;align-items:center;gap:8px;font-size:11px}
.bar .n{color:var(--p-tx2);white-space:nowrap}
.bar .track{height:5px;border-radius:3px;background:rgba(255,255,255,.06);overflow:hidden}
.bar .track i{display:block;height:100%;border-radius:3px}
.bar .v{text-align:right;color:var(--p-tx);font-variant-numeric:tabular-nums}

.tools{display:flex;gap:6px;margin-bottom:10px}
.tools input{flex:1 1 auto;min-width:0;height:28px;border-radius:7px;border:1px solid var(--p-line);
  background:var(--p-bg2);color:var(--p-tx);padding:0 9px;font-size:11.5px;outline:none}
.tools input:focus{border-color:rgba(91,156,248,.5)}
.tools select{height:28px;border-radius:7px;border:1px solid var(--p-line);background:var(--p-bg2);
  color:var(--p-tx2);font-size:11.5px;padding:0 6px;outline:none}

.rows{display:flex;flex-direction:column;gap:2px}
.row{display:flex;align-items:center;gap:9px;padding:7px 8px;border-radius:8px;cursor:pointer;
  border:1px solid transparent}
.row:hover{background:var(--p-bg2);border-color:var(--p-line)}
.row .ring{flex:0 0 auto;width:26px;height:26px}
.row .mid{flex:1 1 auto;min-width:0}
.row .nm{font-size:12px;color:var(--p-tx);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.row .mt{font-size:10.5px;color:var(--p-tx3);white-space:nowrap;overflow:hidden;
  text-overflow:ellipsis;margin-top:2px}
.row .rt{flex:0 0 auto;text-align:right}
.row .pc{font-size:11.5px;color:var(--p-tx);font-variant-numeric:tabular-nums}
.row .sz{font-size:10px;color:var(--p-tx3);margin-top:2px;font-variant-numeric:tabular-nums}
.more{width:100%;margin-top:6px;height:28px;border-radius:7px;border:1px dashed var(--p-line);
  background:transparent;color:var(--p-tx3);font-size:11px;cursor:pointer}
.more:hover{color:var(--p-tx);border-color:rgba(255,255,255,.18)}

.back{display:inline-flex;align-items:center;gap:5px;height:24px;padding:0 9px;margin-bottom:10px;
  border-radius:6px;border:1px solid var(--p-line);background:transparent;color:var(--p-tx2);
  font-size:11.5px;cursor:pointer}
.back:hover{background:var(--p-bg3);color:var(--p-tx)}
.title{font-size:14px;font-weight:600;color:var(--p-tx);line-height:1.45;margin-bottom:6px;
  word-break:break-word}
.tags{display:flex;flex-wrap:wrap;gap:5px;margin-bottom:14px}
.tag{font-size:10.5px;color:var(--p-tx3);background:var(--p-bg2);border:1px solid var(--p-line);
  border-radius:5px;padding:2px 6px;max-width:100%;overflow:hidden;text-overflow:ellipsis;
  white-space:nowrap}

.tbl{display:flex;flex-direction:column;gap:1px}
.tr{display:grid;align-items:center;gap:8px;padding:5px 2px;font-size:11px;
  border-bottom:1px solid rgba(255,255,255,.04)}
.tr.head{color:var(--p-tx3);font-size:10px;border-bottom-color:var(--p-line)}
.tr .nm{color:var(--p-tx);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tr .num{text-align:right;color:var(--p-tx2);font-variant-numeric:tabular-nums;white-space:nowrap}
.tr .num b{color:var(--p-tx);font-weight:500}

.ev{display:flex;gap:8px;padding:5px 0;font-size:11px;border-bottom:1px solid rgba(255,255,255,.04)}
.ev .when{flex:0 0 auto;color:var(--p-tx3);font-variant-numeric:tabular-nums}
.ev .kind{flex:0 0 auto;font-size:10px;padding:0 5px;border-radius:4px;height:16px;line-height:16px}
.ev .kind.warn{background:rgba(245,181,68,.14);color:#f5b544}
.ev .kind.bad{background:rgba(239,107,107,.14);color:#ef6b6b}
.ev .txt{flex:1 1 auto;color:var(--p-tx2);word-break:break-word}

.empty{color:var(--p-tx3);font-size:11.5px;padding:26px 0;text-align:center}
.err{color:#ef8b8b;font-size:11.5px;padding:10px 11px;border-radius:8px;
  background:rgba(239,107,107,.08);border:1px solid rgba(239,107,107,.22);word-break:break-word}
.err button{margin-top:8px;height:24px;padding:0 9px;border-radius:6px;cursor:pointer;
  border:1px solid rgba(239,107,107,.3);background:transparent;color:#ef8b8b;font-size:11px}
.load{display:flex;flex-direction:column;align-items:center;gap:10px;padding:60px 0;color:var(--p-tx3);font-size:12px}
.spin{width:22px;height:22px;border-radius:50%;border:2px solid rgba(255,255,255,.12);
  border-top-color:var(--p-accent);animation:sp .8s linear infinite}
@keyframes sp{to{transform:rotate(360deg)}}
`;

  function applyTheme() {
    /* 能用客户端变量就用，取不到退回内置深色 */
    var light = hostIsLight();
    var bg = light ? '' : readVar(['--wb-panel-bg', '--wb-home-bg-primary', '--wb-bg-primary']);
    var tx = light ? '' : readVar(['--wb-text-primary', '--wb-fg-primary']);
    var line = light ? '' : readVar(['--wb-border-color', '--wb-line-color']);
    var style = ':host{--p-bg:' + (bg || C.bg) + ';--p-bg2:' + (bg ? 'color-mix(in srgb, ' + bg + ' 88%, white)' : C.bg2) + ';' +
      '--p-bg3:' + (bg ? 'color-mix(in srgb, ' + bg + ' 78%, white)' : C.bg3) + ';' +
      '--p-tx:' + (tx || C.tx) + ';--p-tx2:' + C.tx2 + ';--p-tx3:' + C.tx3 + ';' +
      '--p-line:' + (line || C.line) + ';--p-accent:' + C.accent + '}';
    var el = document.createElement('style');
    el.textContent = style;
    root.appendChild(el);
  }

  /* color-mix 不被支持时退回内置色，避免整块背景透明 */
  if (typeof CSS === 'undefined' || !CSS.supports || !CSS.supports('color', 'color-mix(in srgb, #000 50%, #fff)')) {
    applyTheme = function () {
      var el = document.createElement('style');
      el.textContent = ':host{--p-bg:' + C.bg + ';--p-bg2:' + C.bg2 + ';--p-bg3:' + C.bg3 +
        ';--p-tx:' + C.tx + ';--p-tx2:' + C.tx2 + ';--p-tx3:' + C.tx3 +
        ';--p-line:' + C.line + ';--p-accent:' + C.accent + '}';
      root.appendChild(el);
    };
  }
  applyTheme();

  var styleEl = document.createElement('style');
  styleEl.textContent = CSS;
  root.appendChild(styleEl);

  var wrap = document.createElement('div');
  wrap.innerHTML = `
<button class="fab" title="上下文面板（Ctrl+Shift+I 不适用，点此开关）" aria-label="上下文面板">
  <svg class="i-bar" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round">
    <path d="M4 4h2M4 9h2M4 14h2M4 19h2M9 4h11M9 9h11M9 14h11M9 19h11"/>
  </svg>
  <svg class="i-x" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
    <path d="M6 6l12 12M18 6L6 18"/>
  </svg>
</button>
<aside class="panel" role="dialog" aria-label="上下文面板">
  <div class="grip"></div>
  <div class="hd">
    <span class="t">上下文</span><span class="sub js-sub"></span>
    <span class="sp"></span>
    <button class="ico" data-act="reload" title="刷新">&#8635;</button>
    <button class="ico" data-act="close" title="关闭">&#10005;</button>
  </div>
  <div class="body js-body"><div class="load"><div class="spin"></div><div>读取中…</div></div></div>
  <div class="ft"><span class="js-src">本地只读</span><span class="js-ts"></span></div>
</aside>`;
  root.appendChild(wrap);

  var fab = root.querySelector('.fab');
  var panel = root.querySelector('.panel');
  var body = root.querySelector('.js-body');
  var sub = root.querySelector('.js-sub');
  var tsEl = root.querySelector('.js-ts');
  var srcEl = root.querySelector('.js-src');

  /* ---------------- 数据通道 ---------------- */

  var ridSeq = 0;
  var pending = {};

  /* 主进程每次只挂一个 resolver，用掉就置空，等它处理完再挂下一个。
   * 这样连点两下也不会把请求发给已经决议的 Promise。 */
  function send(msg, tries) {
    tries = tries || 0;
    /* 通道没挂上时最多等 60 秒，别无限重试 */
    if (tries > 1200) return;
    if (!window.__WB_CTX_PUSH) {
      setTimeout(function () { send(msg, tries + 1); }, 50);
      return;
    }
    var fn = window.__WB_CTX_PUSH;
    window.__WB_CTX_PUSH = null;
    try { fn(msg); } catch (e) { setTimeout(function () { send(msg, tries + 1); }, 80); }
  }

  window.__WB_CTX_ON_REPLY = function (rid, payload) {
    var p = pending[rid];
    if (!p) return;
    delete pending[rid];
    clearTimeout(p.timer);
    if (payload && payload.ok) p.resolve(payload.data);
    else p.reject(new Error((payload && payload.error) || '读取失败'));
  };

  window.__WB_CTX_ON_PROGRESS = function (rid, pr) {
    var p = pending[rid];
    if (p && p.onProgress) p.onProgress(pr);
  };

  function call(op, args, onProgress, timeout) {
    return new Promise(function (resolve, reject) {
      var rid = ++ridSeq;
      pending[rid] = {
        resolve: resolve,
        reject: reject,
        onProgress: onProgress,
        timer: setTimeout(function () {
          delete pending[rid];
          reject(new Error('分析超时，请重试'));
        }, timeout || 45000)
      };
      send({ rid: rid, mod: MOD, op: op, args: args || {} });
    });
  }

  /* ---------------- 工具函数 ---------------- */

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  function compact(n) {
    n = Number(n || 0);
    var abs = Math.abs(n);
    if (abs >= 1e9) return (n / 1e9).toFixed(2) + 'B';
    if (abs >= 1e6) return (n / 1e6).toFixed(1) + 'M';
    if (abs >= 1e3) return (n / 1e3).toFixed(1) + 'k';
    return String(Math.round(n));
  }

  function pct(used, size) {
    if (!size) return 0;
    return Math.max(0, Math.min(100, (used / size) * 100));
  }

  function ago(ms) {
    if (!ms) return '';
    var d = Date.now() - Number(ms);
    if (d < 0) d = 0;
    var m = Math.floor(d / 60000);
    if (m < 1) return '刚刚';
    if (m < 60) return m + '分钟前';
    var h = Math.floor(m / 60);
    if (h < 24) return h + '小时前';
    var day = Math.floor(h / 24);
    if (day < 30) return day + '天前';
    return Math.floor(day / 30) + '个月前';
  }

  function clock(ms) {
    if (!ms) return '';
    try {
      var d = new Date(Number(ms));
      var p = function (n) { return n < 10 ? '0' + n : String(n); };
      return p(d.getMonth() + 1) + '/' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
    } catch (e) { return ''; }
  }

  function basename(p) {
    var s = String(p || '').replace(/[\\/]+$/, '');
    var i = Math.max(s.lastIndexOf('/'), s.lastIndexOf('\\'));
    return i >= 0 ? s.slice(i + 1) : s;
  }

  /* ---------------- 布局：让位而不是盖住 ---------------- */

  var WIDTH = 420;
  var MIN_W = 360;
  var MAX_W = 680;
  var mainEl = null;

  function findMain() {
    if (mainEl && document.body.contains(mainEl)) return mainEl;
    mainEl = document.querySelector('[data-view-id="main-content"]');
    if (mainEl) return mainEl;
    /* 兜底：撑满视口的根容器 */
    var kids = [].slice.call(document.body.children);
    for (var i = 0; i < kids.length; i++) {
      var e = kids[i];
      if (e === host) continue;
      var s;
      try { s = getComputedStyle(e); } catch (err) { continue; }
      if (s.position !== 'static' && s.position !== 'relative') continue;
      var r = e.getBoundingClientRect();
      if (r.width > innerWidth * 0.8 && r.height > innerHeight * 0.8) { mainEl = e; return e; }
    }
    return null;
  }

  /* 原生详情面板（5.11 有 .detail-panel-container）：开着的时候要把位置让出来 */
  function nativeWidth() {
    var el = document.querySelector('.detail-panel-container');
    if (!el) return 0;
    var r = el.getBoundingClientRect();
    if (r.width < 8) return 0;
    if (r.right > innerWidth + 4) return 0;
    return Math.round(r.width);
  }

  function layout() {
    var nat = nativeWidth();
    panel.style.right = nat ? nat + 'px' : '0px';
    var total = WIDTH + nat;
    var m = findMain();
    if (m) {
      m.style.boxSizing = 'border-box';
      m.style.marginRight = panel.classList.contains('open') ? total + 'px' : '';
    }
  }

  function setWidth(w) {
    WIDTH = Math.max(MIN_W, Math.min(MAX_W, Math.round(w)));
    panel.style.width = WIDTH + 'px';
    try { localStorage.setItem('wb-ctx-width', String(WIDTH)); } catch (e) { /* ignore */ }
    layout();
  }

  try {
    var saved = Number(localStorage.getItem('wb-ctx-width'));
    if (saved >= MIN_W && saved <= MAX_W) WIDTH = saved;
  } catch (e) { /* ignore */ }
  panel.style.width = WIDTH + 'px';

  /* ---------------- 图表 ---------------- */

  function fitCanvas(cv, h) {
    var dpr = window.devicePixelRatio || 1;
    var w = cv.clientWidth || 300;
    var hh = h || cv.clientHeight || 120;
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(hh * dpr)) {
      cv.width = Math.round(w * dpr);
      cv.height = Math.round(hh * dpr);
    }
    var ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, hh);
    return { ctx: ctx, w: w, h: hh };
  }

  function drawDays(cv, days) {
    var s = fitCanvas(cv, cv.clientHeight);
    var ctx = s.ctx, w = s.w, h = s.h;
    var padL = 34, padR = 6, padT = 6, padB = 16;
    var iw = w - padL - padR, ih = h - padT - padB;
    var max = Math.max.apply(null, days.map(function (d) { return d.tokens; }).concat([1]));
    var bw = iw / days.length;
    var lastLabelX = -100;
    ctx.font = '9px system-ui';
    ctx.textBaseline = 'middle';

    for (var g = 0; g <= 2; g++) {
      var y = padT + ih - (ih * g) / 2;
      ctx.strokeStyle = 'rgba(255,255,255,.055)';
      ctx.beginPath(); ctx.moveTo(padL, y + .5); ctx.lineTo(w - padR, y + .5); ctx.stroke();
      ctx.fillStyle = '#656d7c';
      ctx.textAlign = 'right';
      ctx.fillText(compact(max * g / 2), padL - 5, y);
    }

    days.forEach(function (d, i) {
      var bh = max ? (d.tokens / max) * (ih - 2) : 0;
      var x = padL + i * bw + 1.5;
      var bwid = Math.max(2, bw - 3);
      var y = padT + ih - bh;
      var grad = ctx.createLinearGradient(0, y, 0, padT + ih);
      grad.addColorStop(0, 'rgba(91,156,248,.95)');
      grad.addColorStop(1, 'rgba(91,156,248,.35)');
      ctx.fillStyle = d.tokens ? grad : 'rgba(255,255,255,.05)';
      var r = Math.min(3, bwid / 2);
      ctx.beginPath();
      ctx.moveTo(x, padT + ih);
      ctx.lineTo(x, y + r);
      ctx.quadraticCurveTo(x, y, x + r, y);
      ctx.lineTo(x + bwid - r, y);
      ctx.quadraticCurveTo(x + bwid, y, x + bwid, y + r);
      ctx.lineTo(x + bwid, padT + ih);
      ctx.closePath();
      ctx.fill();
      var lx = x + bwid / 2;
      if ((i % 2 === 0 || i === days.length - 1) && lx - lastLabelX > 32) {
        lastLabelX = lx;
        ctx.fillStyle = '#656d7c';
        ctx.textAlign = 'center';
        ctx.fillText(d.date.slice(5).replace('-', '/'), lx, padT + ih + 8);
      }
    });
    cv.__days = days;
  }

  function drawTrend(cv, points, mode) {
    var s = fitCanvas(cv, cv.clientHeight);
    var ctx = s.ctx, w = s.w, h = s.h;
    var padL = 40, padR = 6, padT = 8, padB = 16;
    var iw = w - padL - padR, ih = h - padT - padB;

    /* 点太多时按桶合并，最多画 240 根 */
    var buckets = [];
    var n = points.length;
    var step = Math.max(1, Math.ceil(n / 240));
    for (var i = 0; i < n; i += step) {
      var last = points[Math.min(n - 1, i + step - 1)];
      buckets.push({ p: last, i0: i, i1: Math.min(n - 1, i + step - 1) });
    }

    var maxV = 1, minV = 0;
    if (mode === 'delta') {
      buckets.forEach(function (b) {
        maxV = Math.max(maxV, b.p.delta || 0);
        minV = Math.min(minV, b.p.delta || 0);
      });
    } else {
      buckets.forEach(function (b) { maxV = Math.max(maxV, b.p['in'] || 0); });
    }

    var span = maxV - minV || 1;
    var zeroY = padT + ih - ((0 - minV) / span) * ih;
    var scale = ih / span;

    ctx.font = '9px system-ui';
    ctx.textBaseline = 'middle';
    var ticks = mode === 'delta' ? [maxV, 0, minV] : [maxV, maxV / 2, 0];
    ticks.forEach(function (v) {
      var y = padT + ih - ((v - minV) / span) * ih;
      ctx.strokeStyle = v === 0 ? 'rgba(255,255,255,.14)' : 'rgba(255,255,255,.055)';
      ctx.beginPath(); ctx.moveTo(padL, Math.round(y) + .5); ctx.lineTo(w - padR, Math.round(y) + .5); ctx.stroke();
      ctx.fillStyle = '#656d7c';
      ctx.textAlign = 'right';
      ctx.fillText(compact(v), padL - 5, y);
    });

    var bw = iw / buckets.length;
    var keys = ['fixed', 'user', 'injected', 'assistant', 'reasoning', 'toolResult'];

    buckets.forEach(function (b, idx) {
      var x = padL + idx * bw;
      var bwid = Math.max(1, bw - (bw > 4 ? 1 : 0));
      if (mode === 'delta') {
        var v = b.p.delta || 0;
        var hh = Math.abs(v) * scale;
        var y = v >= 0 ? zeroY - hh : zeroY;
        ctx.fillStyle = v >= 0 ? 'rgba(91,156,248,.85)' : 'rgba(239,107,107,.75)';
        ctx.fillRect(x, y, bwid, Math.max(1, hh));
      } else {
        var acc = 0;
        var cats = b.p.cats || {};
        for (var k = 0; k < keys.length; k++) {
          var key = keys[k];
          var val = cats[key] || 0;
          if (!val) continue;
          var seg = val * scale;
          ctx.fillStyle = CAT_COLORS[key];
          ctx.fillRect(x, zeroY - seg - acc, bwid, Math.max(1, seg));
          acc += seg;
        }
      }
      if (b.p.compaction) {
        var cx = x + bwid / 2;
        ctx.save();
        ctx.strokeStyle = 'rgba(239,107,107,.45)';
        ctx.setLineDash([2, 3]);
        ctx.beginPath();
        ctx.moveTo(cx, padT);
        ctx.lineTo(cx, padT + ih);
        ctx.stroke();
        ctx.restore();
        ctx.fillStyle = '#ef6b6b';
        ctx.beginPath();
        ctx.arc(cx, padT + 3, 2.4, 0, Math.PI * 2);
        ctx.fill();
      }
    });

    /* 横轴：首尾时间 */
    if (points.length) {
      ctx.fillStyle = '#656d7c';
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'left';
      ctx.fillText(clock(points[0].ts).slice(0, 5), padL, padT + ih + 8);
      ctx.textAlign = 'right';
      ctx.fillText(clock(points[points.length - 1].ts).slice(0, 5), w - padR, padT + ih + 8);
    }

    cv.__buckets = buckets;
    cv.__geo = { padL: padL, padR: padR, iw: iw };
  }

  function attachTip(cv, render) {
    var tip = cv.parentNode.querySelector('.tip');
    if (!tip) {
      tip = document.createElement('div');
      tip.className = 'tip';
      cv.parentNode.appendChild(tip);
    }
    cv.addEventListener('mousemove', function (e) {
      var r = cv.getBoundingClientRect();
      var x = e.clientX - r.left;
      var html = render(x, r.width);
      if (!html) { tip.style.opacity = 0; return; }
      tip.innerHTML = html;
      tip.style.opacity = 1;
      var tw = tip.offsetWidth;
      var left = x + 12;
      if (left + tw > r.width) left = x - tw - 12;
      tip.style.left = Math.max(2, left) + 'px';
      tip.style.top = Math.max(2, e.clientY - r.top - 12) + 'px';
    });
    cv.addEventListener('mouseleave', function () { tip.style.opacity = 0; });
  }

  function ringSvg(used, size, px) {
    var p = pct(used, size);
    var r = (px - 4) / 2;
    var c = 2 * Math.PI * r;
    var color = p > 85 ? C.bad : p > 60 ? C.warn : C.accent;
    return '<svg class="ring" viewBox="0 0 ' + px + ' ' + px + '">' +
      '<circle cx="' + px / 2 + '" cy="' + px / 2 + '" r="' + r + '" fill="none" stroke="rgba(255,255,255,.09)" stroke-width="2.5"/>' +
      '<circle cx="' + px / 2 + '" cy="' + px / 2 + '" r="' + r + '" fill="none" stroke="' + color + '" stroke-width="2.5" stroke-linecap="round" ' +
      'stroke-dasharray="' + (c * p / 100).toFixed(1) + ' ' + c.toFixed(1) + '" transform="rotate(-90 ' + px / 2 + ' ' + px / 2 + ')"/>' +
      '</svg>';
  }

  function donutSvg(items, size) {
    var total = items.reduce(function (a, b) { return a + b.value; }, 0) || 1;
    var r = size / 2 - 7;
    var c = 2 * Math.PI * r;
    var off = 0;
    var body = items.map(function (it) {
      var len = (it.value / total) * c;
      var seg = '<circle cx="' + size / 2 + '" cy="' + size / 2 + '" r="' + r + '" fill="none" stroke="' + it.color + '" ' +
        'stroke-width="9" stroke-dasharray="' + Math.max(0, len - 1).toFixed(1) + ' ' + c.toFixed(1) + '" ' +
        'stroke-dashoffset="' + (-off).toFixed(1) + '" transform="rotate(-90 ' + size / 2 + ' ' + size / 2 + ')"/>';
      off += len;
      return seg;
    }).join('');
    return '<svg width="' + size + '" height="' + size + '" viewBox="0 0 ' + size + ' ' + size + '">' +
      '<circle cx="' + size / 2 + '" cy="' + size / 2 + '" r="' + r + '" fill="none" stroke="rgba(255,255,255,.06)" stroke-width="9"/>' +
      body + '</svg>';
  }

  function stackHtml(cats, size) {
    var keys = ['fixed', 'user', 'injected', 'assistant', 'reasoning', 'toolResult'];
    var used = keys.reduce(function (a, k) { return a + (cats[k] || 0); }, 0);
    size = size || used || 1;
    var free = Math.max(0, size - used);
    var parts = keys.filter(function (k) { return cats[k]; }).map(function (k) {
      var p = size ? (cats[k] / size) * 100 : 0;
      return '<i style="width:' + p.toFixed(2) + '%;background:' + CAT_COLORS[k] + '" title="' +
        CAT_LABELS[k] + ' ' + compact(cats[k]) + '"></i>';
    });
    if (free > 0) {
      parts.push('<i style="width:' + ((free / size) * 100).toFixed(2) + '%;background:repeating-linear-gradient(45deg,rgba(255,255,255,.055) 0 2px,transparent 2px 5px)"></i>');
    }
    return '<div class="stack">' + parts.join('') + '</div>';
  }

  /* ---------------- 总览 ---------------- */

  var state = {
    view: 'overview',
    data: null,
    detail: null,
    detailFor: '',
    q: '',
    sort: 'recent',
    limit: 30,
    trend: 'total',
    pick: -1
  };

  function renderOverview(d) {
    state.data = d;
    var t = d.totals || {};
    var sessions = d.sessions || [];
    var hit = t.tokens ? (t.cached / t.tokens) * 100 : 0;

    var html = '<div class="kpis">' +
      kpi('会话', t.sessions + '<small>活跃 ' + t.active + '</small>') +
      kpi('累计输入', compact(t.tokens)) +
      kpi('缓存命中', hit.toFixed(1) + '%') +
      kpi('积分', compact(t.credits)) +
      kpi('工具调用', compact(t.tools)) +
      kpi('请求数', compact(t.requests)) +
      '</div>';

    html += '<div class="sec"><div class="sh"><h3>近 14 天用量</h3></div>' +
      '<div class="card"><div class="chart" style="height:92px"><canvas id="cv-days"></canvas><div class="tip"></div></div></div></div>';

    var comp = d.composition || {};
    var items = Object.keys(COMPO_LABELS).map(function (k) {
      return { key: k, label: COMPO_LABELS[k], value: Number(comp[k]) || 0, color: COMPO_COLORS[k] };
    }).filter(function (x) { return x.value > 0; });
    var sum = items.reduce(function (a, b) { return a + b.value; }, 0) || 1;
    html += '<div class="sec"><div class="sh"><h3>当前上下文组成</h3></div><div class="card donut">' +
      donutSvg(items, 104) + '<div class="legend">' +
      items.map(function (x) {
        return '<div class="lg"><i style="background:' + x.color + '"></i>' + x.label +
          '<b>' + compact(x.value) + ' · ' + pctText(x.value / sum) + '</b></div>';
      }).join('') + '</div></div></div>';

    html += '<div class="sec"><div class="sh"><h3>会话</h3><span class="sp"></span>' +
      '<span style="font-size:10.5px;color:var(--p-tx3)">共 ' + sessions.length + '</span></div>' +
      '<div class="tools"><input class="js-q" placeholder="搜索标题或目录" value="' + esc(state.q) + '">' +
      '<select class="js-sort">' +
      '<option value="recent"' + (state.sort === 'recent' ? ' selected' : '') + '>最近</option>' +
      '<option value="used"' + (state.sort === 'used' ? ' selected' : '') + '>占用</option>' +
      '<option value="tokens"' + (state.sort === 'tokens' ? ' selected' : '') + '>用量</option>' +
      '</select></div><div class="rows js-rows"></div></div>';

    body.innerHTML = html;
    renderRows();

    var cv = body.querySelector('#cv-days');
    if (cv) {
      drawDays(cv, d.days || []);
      attachTip(cv, function (x, w) {
        var days = cv.__days || [];
        var i = Math.floor((x - 34) / ((w - 40) / days.length));
        var day = days[i];
        if (!day) return '';
        return '<b>' + day.date + '</b>' +
          '<div class="r">tokens<i>' + compact(day.tokens) + '</i></div>' +
          '<div class="r">请求<i>' + day.requests + '</i></div>' +
          '<div class="r">积分<i>' + compact(day.credits) + '</i></div>';
      });
    }

    sub.textContent = sessions.length + ' 个会话';
    tsEl.textContent = clock(d.generated_at);
    srcEl.textContent = '本地只读';
  }

  function pctText(ratio) {
    var v = ratio * 100;
    return v > 0 && v < 1 ? '<1%' : v.toFixed(0) + '%';
  }

  function kpi(k, v) {
    return '<div class="kpi"><div class="k">' + k + '</div><div class="v">' + v + '</div></div>';
  }

  function filtered() {
    var list = (state.data && state.data.sessions) || [];
    var q = state.q.trim().toLowerCase();
    if (q) {
      list = list.filter(function (s) {
        return (s.title || '').toLowerCase().indexOf(q) >= 0 ||
          (s.cwd || '').toLowerCase().indexOf(q) >= 0;
      });
    }
    list = list.slice();
    if (state.sort === 'used') list.sort(function (a, b) { return (b.used || 0) - (a.used || 0); });
    else if (state.sort === 'tokens') {
      list.sort(function (a, b) {
        return ((b.summary && b.summary['in']) || 0) - ((a.summary && a.summary['in']) || 0);
      });
    }
    return list;
  }

  function renderRows() {
    var box = body.querySelector('.js-rows');
    if (!box) return;
    var list = filtered();
    var shown = list.slice(0, state.limit);
    if (!shown.length) {
      box.innerHTML = '<div class="empty">没有匹配的会话</div>';
      return;
    }
    box.innerHTML = shown.map(function (s) {
      var sm = s.summary || {};
      var p = s.size ? pct(s.used, s.size) : 0;
      return '<div class="row" data-id="' + esc(s.id) + '">' +
        ringSvg(s.used || 0, s.size || 1, 26) +
        '<div class="mid"><div class="nm">' + esc(s.title) + '</div>' +
        '<div class="mt">' + esc(basename(s.cwd) || '—') + ' · ' + esc(s.model || '未知模型') +
        (sm.requests ? ' · ' + sm.requests + ' 请求' : '') + ' · ' + ago(s.updated_at) + '</div></div>' +
        '<div class="rt"><div class="pc">' + (s.size ? p.toFixed(0) + '%' : '—') + '</div>' +
        '<div class="sz">' + (s.size ? compact(s.used) + '/' + compact(s.size) : '—') + '</div></div>' +
        '</div>';
    }).join('');
    if (list.length > shown.length) {
      box.insertAdjacentHTML('beforeend',
        '<button class="more js-more">再显示 ' + Math.min(30, list.length - shown.length) + ' 个</button>');
    }
  }

  /* ---------------- 会话详情 ---------------- */

  function renderDetail(d) {
    state.detail = d;
    var meta = d.meta || {};
    var t = d.totals || {};
    var pts = d.points || [];
    var last = pts.length ? pts[pts.length - 1] : null;
    var size = Number(meta.size || 0) || Number((d.snapshot || {}).size || 0) || (last ? last['in'] : 0);
    var used = Number(meta.used || 0) || (last ? last['in'] : 0);
    var hit = t.input ? (t.cached / t.input) * 100 : 0;

    var html = '<button class="back" data-act="back">← 返回</button>' +
      '<div class="title">' + esc(meta.title || '(未命名会话)') + '</div>' +
      '<div class="tags">' +
      (meta.model ? '<span class="tag">' + esc(meta.model) + '</span>' : '') +
      (meta.mode ? '<span class="tag">' + esc(meta.mode) + '</span>' : '') +
      '<span class="tag">' + (d.transcript_size ? compact(d.transcript_size) + 'B transcript' : '无 transcript') + '</span>' +
      '<span class="tag">' + t.requests + ' 请求 / ' + t.turns + ' 轮</span>' +
      '</div>';

    html += '<div class="kpis">' +
      kpi('累计输入', compact(t.input)) +
      kpi('缓存命中', hit.toFixed(1) + '%') +
      kpi('工具调用', compact(t.tool_calls) + '<small>' + (t.tool_ms ? Math.round(t.tool_ms / 1000) + 's' : '') + '</small>') +
      kpi('积分', compact(t.credits) + '<small>压缩 ' + t.compactions + '</small>') +
      '</div>';

    if (last) {
      html += '<div class="sec"><div class="sh"><h3>当前上下文</h3><span class="sp"></span>' +
        '<span style="font-size:10.5px;color:var(--p-tx3)">' + compact(used) + ' / ' + compact(size) + ' · ' + pct(used, size).toFixed(1) + '%</span></div>' +
        '<div class="card">' + stackHtml(last.cats || {}, size) + compositionBars(last.cats || {}, size, d.base) + '</div></div>';
    }

    html += '<div class="sec"><div class="sh"><h3>上下文趋势</h3><span class="sp"></span>' +
      '<div class="chips"><button class="chip js-trend' + (state.trend === 'total' ? ' on' : '') + '" data-trend="total">总量</button>' +
      '<button class="chip js-trend' + (state.trend === 'delta' ? ' on' : '') + '" data-trend="delta">增量</button></div></div>' +
      '<div class="card"><div class="chart" style="height:170px"><canvas id="cv-trend"></canvas><div class="tip"></div></div>' +
      '<div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:8px;font-size:10px;color:var(--p-tx3)">' +
      Object.keys(CAT_LABELS).map(function (k) {
        return '<span style="display:inline-flex;align-items:center;gap:4px"><i style="width:6px;height:6px;border-radius:2px;background:' +
          CAT_COLORS[k] + '"></i>' + CAT_LABELS[k] + '</span>';
      }).join('') + '</div></div></div>';

    if (pts.length) {
      var idx = state.pick >= 0 && state.pick < pts.length ? state.pick : pts.length - 1;
      var p = pts[idx];
      var opts = pts.map(function (x, i) {
        return '<option value="' + i + '"' + (i === idx ? ' selected' : '') + '>#' + x.step + ' · ' +
          clock(x.ts) + ' · ' + compact(x['in']) + '</option>';
      }).slice(-80).join('');
      html += '<div class="sec"><div class="sh"><h3>请求拆解</h3><span class="sp"></span>' +
        '<select class="js-pick" style="height:24px;border-radius:6px;border:1px solid var(--p-line);background:var(--p-bg2);color:var(--p-tx2);font-size:10.5px;max-width:190px">' +
        opts + '</select></div>' +
        '<div class="card">' + stackHtml(p.cats || {}, size) + compositionBars(p.cats || {}, size, d.base) +
        '<div style="margin-top:8px;font-size:10.5px;color:var(--p-tx3);display:flex;gap:12px;flex-wrap:wrap">' +
        '<span>输入 ' + compact(p['in']) + '</span><span>输出 ' + compact(p.out) + '</span>' +
        '<span>缓存 ' + compact(p.cached) + '</span><span>积分 ' + (p.credits || 0).toFixed(2) + '</span></div>' +
        '</div></div>';
    }

    html += tableSection('工具', (d.tools || []).slice(0, 14), ['工具', '次数', '返回', '耗时'], function (x) {
      return [esc(x.name), x.count, compact(x.output), (x.ms / 1000).toFixed(1) + 's'];
    }, [1.4, .55, .65, .6]);

    html += tableSection('文件活动', (d.files || []).slice(0, 14), ['文件', '读', '写', '搜'], function (x) {
      return ['<span title="' + esc(x.path) + '">' + esc(basename(x.path)) + '</span>', x.ops.read, x.ops.write, x.ops.search];
    }, [1.6, .4, .4, .4]);

    html += tableSection('命令', (d.commands || []).slice(0, 12), ['程序', '次数', '最近'], function (x) {
      return [esc(x.program), x.count, ago(x.last_ts)];
    }, [1.4, .5, .8]);

    var evs = (d.events || []).slice(-30).reverse();
    if (evs.length) {
      html += '<div class="sec"><div class="sh"><h3>事件</h3></div><div class="card">' +
        evs.map(function (e) {
          var bad = e.kind !== 'compact';
          return '<div class="ev"><span class="when">' + clock(e.ts) + '</span>' +
            '<span class="kind ' + (bad ? 'bad' : 'warn') + '">' + (bad ? '失败' : '压缩') + '</span>' +
            '<span class="txt">' + esc(e.text) + '</span></div>';
        }).join('') + '</div></div>';
    }

    body.innerHTML = html;
    sub.textContent = '会话详情';
    tsEl.textContent = clock(Date.now());
    srcEl.textContent = (d.base && d.base.fixed) ? '固定开销 ' + compact(d.base.fixed) + ' · 估算' : '本地只读';

    var cv = body.querySelector('#cv-trend');
    if (cv) {
      drawTrend(cv, pts, state.trend);
      attachTip(cv, function (x, w) {
        var buckets = cv.__buckets || [];
        var geo = cv.__geo || { padL: 40, iw: w - 46 };
        var i = Math.floor((x - geo.padL) / (geo.iw / buckets.length));
        var b = buckets[Math.max(0, Math.min(buckets.length - 1, i))];
        if (!b) return '';
        var p = b.p;
        var rows = Object.keys(CAT_LABELS).map(function (k) {
          if (!p.cats || !p.cats[k]) return '';
          return '<div class="r">' + CAT_LABELS[k] + '<i>' + compact(p.cats[k]) + '</i></div>';
        }).join('');
        return '<b>#' + p.step + ' · ' + clock(p.ts) + '</b>' +
          '<div class="r">窗口<i>' + compact(p['in']) + '</i></div>' + rows +
          '<div class="r">输出<i>' + compact(p.out) + '</i></div>' +
          '<div class="r">缓存<i>' + compact(p.cached) + '</i></div>';
      });
    }
  }

  function compositionBars(cats, size, base) {
    var keys = ['fixed', 'user', 'injected', 'assistant', 'reasoning', 'toolResult'];
    var total = keys.reduce(function (a, k) { return a + (cats[k] || 0); }, 0) || 1;
    var max = Math.max.apply(null, keys.map(function (k) { return cats[k] || 0; }).concat([1]));
    return '<div class="bars">' + keys.map(function (k) {
      var v = cats[k] || 0;
      return '<div class="bar"><span class="n">' + CAT_LABELS[k] + '</span>' +
        '<span class="track"><i style="width:' + ((v / max) * 100).toFixed(1) + '%;background:' + CAT_COLORS[k] + '"></i></span>' +
        '<span class="v">' + compact(v) + '</span></div>';
    }).join('') + '</div>';
  }

  function tableSection(title, rows, heads, mapRow, cols) {
    if (!rows.length) return '';
    var grid = cols.map(function (c) { return c + 'fr'; }).join(' ');
    var head = '<div class="tr head" style="grid-template-columns:' + grid + '">' +
      heads.map(function (h, i) {
        return '<span class="' + (i ? 'num' : 'nm') + '">' + h + '</span>';
      }).join('') + '</div>';
    var bodyRows = rows.map(function (x) {
      var cells = mapRow(x);
      return '<div class="tr" style="grid-template-columns:' + grid + '">' +
        cells.map(function (c, i) {
          return '<span class="' + (i ? 'num' : 'nm') + '">' + c + '</span>';
        }).join('') + '</div>';
    }).join('');
    return '<div class="sec"><div class="sh"><h3>' + title + '</h3></div><div class="card"><div class="tbl">' +
      head + bodyRows + '</div></div></div>';
  }

  /* ---------------- 加载状态 ---------------- */

  function showLoad(text) {
    body.innerHTML = '<div class="load"><div class="spin"></div><div>' + esc(text || '读取中…') + '</div></div>';
  }

  function showErr(msg) {
    body.innerHTML = '<div class="err">' + esc(msg) + '<br><button class="js-retry">重试</button></div>';
  }

  function loadOverview(force) {
    state.view = 'overview';
    if (state.data && !force) { renderOverview(state.data); return; }
    if (!state.data) showLoad('读取中…');
    call('overview', {}, function (pr) {
      if (state.data) return;
      body.innerHTML = '<div class="load"><div class="spin"></div><div>首次索引 ' + pr.done + ' / ' + pr.total + '</div></div>';
    }).then(function (d) {
      state.data = d;
      if (state.view === 'overview') renderOverview(d);
    }).catch(function (e) {
      if (state.view === 'overview') showErr(e.message);
    });
  }

  function openSession(id) {
    state.view = 'session';
    state.pick = -1;
    if (state.detail && state.detailFor === id) { renderDetail(state.detail); return; }
    showLoad('解析 transcript…');
    call('session', { sid: id }, null, 60000).then(function (d) {
      state.detail = d;
      state.detailFor = id;
      if (state.view === 'session') renderDetail(d);
    }).catch(function (e) {
      if (state.view === 'session') showErr(e.message);
    });
  }

  /* ---------------- 交互 ---------------- */

  var closeTimer = null;

  var layoutTimer = null;

  function watchLayout() {
    if (layoutTimer) return;
    var last = -1;
    layoutTimer = setInterval(function () {
      var w = nativeWidth();
      if (w !== last) {
        last = w;
        layout();
      } else {
        var m = findMain();
        if (m && panel.classList.contains('open') && m.style.marginRight !== (WIDTH + w) + 'px') layout();
      }
    }, 600);
  }

  function open() {
    clearTimeout(closeTimer);
    watchLayout();
    panel.classList.add('open', 'anim');
    fab.classList.add('on');
    layout();
    panel.addEventListener('transitionend', function onEnd(e) {
      if (e.propertyName !== 'transform') return;
      panel.classList.remove('anim');
      panel.removeEventListener('transitionend', onEnd);
    });
    if (!state.data) loadOverview(false);
  }

  function close() {
    clearInterval(layoutTimer);
    layoutTimer = null;
    panel.classList.add('anim');
    panel.classList.remove('open');
    fab.classList.remove('on');
    layout();
    closeTimer = setTimeout(function () { panel.classList.remove('anim'); }, 300);
  }

  fab.addEventListener('click', function () {
    if (panel.classList.contains('open')) close(); else open();
  });

  root.addEventListener('click', function (e) {
    var t = e.target;
    var act = t && t.getAttribute && t.getAttribute('data-act');
    if (act === 'back') { state.view = 'overview'; loadOverview(false); return; }
    if (act === 'reload') { loadOverview(true); return; }
    if (act === 'close') { close(); return; }
    if (t.classList && t.classList.contains('js-retry')) {
      if (state.view === 'session' && state.detailFor) {
        state.detail = null; openSession(state.detailFor);
      } else loadOverview(true);
      return;
    }
    if (t.classList && t.classList.contains('js-trend')) {
      state.trend = t.getAttribute('data-trend');
      if (state.detail) renderDetail(state.detail);
      return;
    }
    if (t.classList && t.classList.contains('js-more')) {
      state.limit += 30;
      renderRows();
      return;
    }
    var row = t.closest ? t.closest('.row') : null;
    if (row && row.getAttribute('data-id')) {
      openSession(row.getAttribute('data-id'));
    }
  });

  root.addEventListener('input', function (e) {
    if (e.target.classList.contains('js-q')) {
      state.q = e.target.value;
      state.limit = 30;
      renderRows();
    }
  });

  root.addEventListener('change', function (e) {
    if (e.target.classList.contains('js-sort')) {
      state.sort = e.target.value;
      state.limit = 30;
      renderRows();
    } else if (e.target.classList.contains('js-pick')) {
      state.pick = Number(e.target.value);
      var d = state.detail;
      var scrollTop = body.scrollTop;
      renderDetail(d);
      body.scrollTop = scrollTop;
    }
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && panel.classList.contains('open')) close();
  }, true);

  /* 拖动左边缘调宽度；只在松手时重排，拖动过程只改面板宽度 */
  (function () {
    var grip = root.querySelector('.grip');
    var dragging = false;
    var startX = 0;
    var startW = 0;
    grip.addEventListener('pointerdown', function (e) {
      dragging = true;
      startX = e.clientX;
      startW = WIDTH;
      grip.setPointerCapture(e.pointerId);
      panel.style.transition = 'none';
    });
    grip.addEventListener('pointermove', function (e) {
      if (!dragging) return;
      var w = Math.max(MIN_W, Math.min(MAX_W, startW + (startX - e.clientX)));
      panel.style.width = w + 'px';
    });
    grip.addEventListener('pointerup', function (e) {
      if (!dragging) return;
      dragging = false;
      panel.style.transition = '';
      setWidth(parseInt(panel.style.width, 10) || WIDTH);
    });
  })();

  window.addEventListener('resize', function () { layout(); });

  /* 面板关着也先把总览算出来，点开就是现成的 */
  setTimeout(function () {
    if (!state.data && !document.hidden) loadOverview(false);
  }, 800);

  log('面板已加载 v' + VERSION);
})();
