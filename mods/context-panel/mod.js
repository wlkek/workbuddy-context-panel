/* 上下文面板 —— 页面脚本
 * ------------------------------------------------------------------
 * 由 loader/injector.js 注入到 WorkBuddy 主界面。
 * 数据从主进程的本地接口取：window.__WB_MOD_API 由注入器预先设好。
 *
 * 用 shadow DOM 隔离样式，不污染宿主页面。
 */
(function () {
  'use strict';

  var MOD_ID = 'context-panel';

  function log(m) {
    try { console.log('[context-panel] ' + m); } catch (e) { /* ignore */ }
  }

  /* 数据由注入器在注入前写进 window.__WB_CTX_DATA。
   * 不走网络：客户端刚启动时主进程的 listen 回调不会触发，拿不到端口。 */
  function getData() {
    var all = window.__WB_CTX_DATA || {};
    return all[MOD_ID] || null;
  }

  if (!getData()) {
    log('还没有数据，等下次注入');
    return;
  }

  if (window.__WB_CTX_PANEL__) return;
  window.__WB_CTX_PANEL__ = true;

  /* ---------------- 宿主容器 ---------------- */
  var host = document.createElement('div');
  host.setAttribute('data-wb-ctx', '1');
  host.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;z-index:2147483000';
  (document.body || document.documentElement).appendChild(host);
  var root = host.attachShadow({ mode: 'open' });

  var CSS = [
    ':host{all:initial}',
    '*{box-sizing:border-box;margin:0;padding:0}',
    '.fab{position:fixed;right:18px;bottom:18px;width:42px;height:42px;border-radius:12px;',
    '  border:1px solid rgba(255,255,255,.12);background:rgba(32,35,44,.92);color:#cfd6e4;',
    '  cursor:pointer;display:flex;align-items:center;justify-content:center;',
    '  box-shadow:0 6px 20px rgba(0,0,0,.38);transition:right .22s cubic-bezier(.32,.72,.28,1),background .15s;',
    '  font:0/0 a;-webkit-font-smoothing:antialiased}',
    '.fab:hover{background:rgba(45,50,62,.96)}',
    /* 面板展开时按钮让到面板左侧，避免被盖住 */
    '.fab.side{right:394px}',
    '.fab svg{width:20px;height:20px;display:block}',
    /* 5.11.3 的顶部结构：0–30px 是窗口控制区（右上角放关闭按钮），
     * 30–94px 是应用标题栏。面板从 98px 开始，两边都不碰。 */
    '.panel{position:fixed;right:10px;top:98px;bottom:10px;width:372px;max-width:78vw;',
    '  background:#1a1d24;border:1px solid rgba(255,255,255,.1);border-radius:10px;',
    '  box-shadow:0 14px 44px rgba(0,0,0,.52);display:flex;flex-direction:column;',
    '  transform:translateX(calc(100% + 24px));transition:transform .22s cubic-bezier(.32,.72,.28,1);',
    '  font:13px/1.55 system-ui,-apple-system,"Segoe UI",sans-serif;color:#c9d1de;overflow:hidden}',
    '.panel.open{transform:translateX(0)}',
    '.head{display:flex;align-items:center;justify-content:space-between;gap:10px;',
    '  padding:14px 16px;border-bottom:1px solid rgba(255,255,255,.07);flex:0 0 auto}',
    '.head h2{font-size:13px;font-weight:600;letter-spacing:.02em;color:#e6ebf4}',
    '.head .acts{display:flex;gap:6px}',
    '.ico{width:26px;height:26px;border-radius:7px;border:1px solid rgba(255,255,255,.1);',
    '  background:transparent;color:#8f9aad;cursor:pointer;display:flex;align-items:center;',
    '  justify-content:center;font-size:14px;line-height:1}',
    '.ico:hover{background:rgba(255,255,255,.06);color:#cfd6e4}',
    '.body{flex:1 1 auto;overflow-y:auto;padding:12px 16px 18px}',
    '.sum{display:flex;gap:10px;margin-bottom:14px}',
    '.cell{flex:1;background:#20242d;border:1px solid rgba(255,255,255,.06);',
    '  border-radius:9px;padding:9px 11px}',
    '.cell .k{font-size:11px;color:#7f8a9d;margin-bottom:3px}',
    '.cell .v{font-size:16px;font-weight:600;color:#e6ebf4;font-variant-numeric:tabular-nums}',
    '.sub{font-size:11px;color:#6f7a8c;margin:14px 0 7px;letter-spacing:.03em}',
    '.row{padding:8px 10px;border-radius:8px;cursor:pointer}',
    '.row:hover{background:rgba(255,255,255,.06)}',
    '.back{margin-bottom:10px;background:transparent;border:1px solid rgba(255,255,255,.12);',
    '  color:#8f9aad;border-radius:7px;padding:3px 9px;font-size:12px;cursor:pointer}',
    '.back:hover{background:rgba(255,255,255,.06);color:#cfd6e4}',
    '.kv{display:flex;justify-content:space-between;gap:10px;padding:7px 0;',
    '  border-bottom:1px solid rgba(255,255,255,.05);font-size:12px}',
    '.kv .k2{color:#7f8a9d}',
    '.kv .v2{color:#d5dce8;text-align:right;word-break:break-all;max-width:60%}',
    '.row .t{display:flex;justify-content:space-between;gap:8px;margin-bottom:5px}',
    '.row .name{color:#d5dce8;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.row .num{color:#7f8a9d;font-size:11px;font-variant-numeric:tabular-nums;flex:0 0 auto}',
    '.track{height:3px;border-radius:2px;background:rgba(255,255,255,.07);overflow:hidden}',
    '.track i{display:block;height:100%;border-radius:2px;background:linear-gradient(90deg,#4d93f8,#8b6cf0)}',
    '.empty{color:#6f7a8c;font-size:12px;padding:18px 0;text-align:center}',
    '.err{color:#e2777a;font-size:12px;padding:10px;border-radius:8px;',
    '  background:rgba(226,119,122,.08);border:1px solid rgba(226,119,122,.2);word-break:break-all}',
    '.foot{flex:0 0 auto;padding:9px 16px;border-top:1px solid rgba(255,255,255,.07);',
    '  font-size:11px;color:#6a7486;display:flex;justify-content:space-between;gap:8px}'
  ].join('');

  root.innerHTML = '<style>' + CSS + '</style>' +
    '<button class="fab" title="上下文面板" aria-label="上下文面板">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round">' +
        '<path d="M4 6h16M4 12h11M4 18h7"/>' +
      '</svg>' +
    '</button>' +
    '<aside class="panel" role="dialog" aria-label="上下文面板">' +
      '<div class="head"><h2>上下文</h2><div class="acts">' +
        '<button class="ico" data-act="reload" title="刷新">&#8635;</button>' +
        '<button class="ico" data-act="close" title="关闭">&#10005;</button>' +
      '</div></div>' +
      '<div class="body"><div class="empty">读取中…</div></div>' +
      '<div class="foot"><span class="src">本地只读</span><span class="ts"></span></div>' +
    '</aside>';

  var fab = root.querySelector('.fab');
  var panel = root.querySelector('.panel');
  var body = root.querySelector('.body');
  var ts = root.querySelector('.ts');
  var loaded = false;

  /* 面板打开时把主内容区挤窄，而不是盖在上面。
   * 5.11.3 的主容器是 body 里那个撑满视口的 static 元素，没有 class 可依赖，
   * 所以按尺寸和定位特征找。 */
  var SHIFT = 382;
  var mainEl = null;

  function findMain() {
    if (mainEl && document.body.contains(mainEl)) return mainEl;
    var kids = [].slice.call(document.body.children);
    for (var i = 0; i < kids.length; i++) {
      var e = kids[i];
      if (e === host) continue;
      var s;
      try { s = getComputedStyle(e); } catch (err) { continue; }
      if (s.position !== 'static' && s.position !== 'relative') continue;
      var r = e.getBoundingClientRect();
      if (r.width > innerWidth * 0.8 && r.height > innerHeight * 0.8) {
        mainEl = e;
        return e;
      }
    }
    return null;
  }

  function makeRoom(on) {
    var m = findMain();
    if (!m) return;
    m.style.transition = 'padding-right .22s cubic-bezier(.32,.72,.28,1)';
    m.style.paddingRight = on ? SHIFT + 'px' : '';
    m.style.boxSizing = 'border-box';
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  function compact(n) {
    n = Number(n || 0);
    if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return (n / 1e3).toFixed(1) + 'k';
    return String(Math.round(n));
  }

  function renderOverview(d) {
    if (!d || d.ok === false) {
      body.innerHTML = '<div class="err">' + esc((d && d.error) || '读取失败') + '</div>';
      return;
    }
    var t = d.totals || {};
    var sessions = d.sessions || [];
    var html = '<div class="sum">' +
      '<div class="cell"><div class="k">会话</div><div class="v">' + (t.sessions || 0) + '</div></div>' +
      '<div class="cell"><div class="k">上下文总量</div><div class="v">' + compact(t.used) + '</div></div>' +
      '</div>';

    if (!sessions.length) {
      html += '<div class="empty">没有可显示的会话</div>';
    } else {
      html += '<div class="sub">最近会话</div>';
      sessions.slice(0, 30).forEach(function (s) {
        html += '<div class="row" data-id="' + esc(s.id) + '">' +
          '<div class="t"><span class="name">' + esc(s.title) + '</span>' +
          '<span class="num">' + (s.pct ? Math.round(s.pct) + '%' : '—') + '</span></div>' +
          '<div class="track"><i style="width:' + Math.max(1, Math.min(100, s.pct || 0)) + '%"></i></div>' +
          '</div>';
      });
    }
    body.innerHTML = html;
    ts.textContent = new Date(d.generatedAt || Date.now()).toLocaleTimeString();
  }

  function fmtTime(ms) {
    if (!ms) return '—';
    try {
      return new Date(Number(ms)).toLocaleString('zh-CN', { hour12: false });
    } catch (e) { return '—'; }
  }

  function renderDetail(d) {
    if (!d || d.ok === false) {
      body.innerHTML = '<button class="back" data-act="back">← 返回</button>' +
        '<div class="err">' + esc((d && d.error) || '读取失败') + '</div>';
      return;
    }
    var s = d.session || {};
    var tr = d.transcript || null;
    function kv(k, v) {
      return '<div class="kv"><span class="k2">' + k + '</span><span class="v2">' + esc(v) + '</span></div>';
    }
    var html = '<button class="back" data-act="back">← 返回</button>';
    html += '<div class="sub" style="color:#e6ebf4;font-size:13px;margin:2px 0 6px">' + esc(s.title) + '</div>';
    html += kv('模型', s.model || '—');
    html += kv('状态', s.status || '—');
    html += kv('上下文占用', compact(s.used) + ' / ' + compact(s.size));
    html += kv('占比', (s.pct ? s.pct.toFixed(1) : '0') + '%');
    if (tr) html += kv('transcript', compact(tr.bytes) + ' 字节');
    html += kv('更新时间', fmtTime(s.updatedAt));
    body.innerHTML = html;
    ts.textContent = '详情';
  }

  /* 注入器查完会话后推回来 */
  window.addEventListener('__WB_CTX_SESSION__', function () {
    renderDetail(window.__WB_CTX_SESSION);
  });

  function load() {
    var d = getData();
    if (d) {
      loaded = true;
      renderOverview(d);
    } else {
      body.innerHTML = '<div class="empty">暂无数据</div>';
    }
  }

  /* 注入器重算后会推新数据并派发这个事件 */
  window.addEventListener('__WB_CTX_DATA__', function () {
    loaded = true;
    renderOverview(getData());
  });

  function open() {
    panel.classList.add('open');
    fab.classList.add('side');
    makeRoom(true);
    if (!loaded) load();
  }
  function close() {
    panel.classList.remove('open');
    fab.classList.remove('side');
    makeRoom(false);
  }

  fab.addEventListener('click', function () {
    if (panel.classList.contains('open')) close(); else open();
  });

  root.addEventListener('click', function (e) {
    var act = e.target && e.target.getAttribute && e.target.getAttribute('data-act');
    if (act === 'close') { close(); return; }
    if (act === 'back') { load(); return; }
    if (act === 'reload') {
      body.innerHTML = '<div class="empty">刷新中…</div>';
      /* 注入器监听了这条消息，收到会重算并推回新数据 */
      try { window.__WB_CTX_REQ = { type: 'refresh' }; } catch (err) { /* ignore */ }
      setTimeout(function () { if (body.querySelector('.empty')) load(); }, 2500);
      return;
    }

    var rowEl = e.target && e.target.closest ? e.target.closest('.row') : null;
    if (rowEl) {
      var id = rowEl.getAttribute('data-id');
      if (id) {
        body.innerHTML = '<div class="empty">加载中…</div>';
        try { window.__WB_CTX_REQ = { type: 'session', id: id }; } catch (err) { /* ignore */ }
      }
    }
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && panel.classList.contains('open')) close();
  }, true);

  log('面板已加载');
})();
