/* 后台守卫：等客户端下次启动时自动抓一次真实布局。
 *
 * 轮询 loader.log 找新的 --inspect 端口，连上主进程，在页面里读取布局信息，
 * 结果写到 dom-snapshot.json。抓完就退出。
 *
 * 用法：node tools/watch-inspect.js [超时分钟]
 */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');

const LOG = path.join(process.env.LOCALAPPDATA || '', 'WbMods', 'loader.log');
const OUT = path.join(__dirname, '..', 'dom-snapshot.json');
const TIMEOUT_MIN = Number(process.argv[2] || 90);

function readTail() {
  try { return fs.readFileSync(LOG, 'utf8').slice(-4000); } catch (e) { return ''; }
}

function findPort(text) {
  const m = text.match(/spawn app with --inspect=(\d+)[\s\S]*$/);
  return m ? m[1] : '';
}

function getJSON(url) {
  return new Promise((res) => {
    http.get(url, { timeout: 2500 }, (r) => {
      let b = '';
      r.on('data', (c) => b += c);
      r.on('end', () => { try { res(JSON.parse(b)); } catch (e) { res(null); } });
    }).on('error', () => res(null));
  });
}

const PROBE = `(function(){
  function rect(e){
    if(!e) return null;
    var r=e.getBoundingClientRect();
    var s=getComputedStyle(e);
    return {
      tag:e.tagName, cls:String(e.className||'').slice(0,90),
      x:Math.round(r.left), y:Math.round(r.top), w:Math.round(r.width), h:Math.round(r.height),
      pos:s.position, z:s.zIndex, disp:s.display, ovf:s.overflow
    };
  }
  function pick(sel){ try{ return rect(document.querySelector(sel)); }catch(e){ return null; } }
  var out={
    ready: document.readyState,
    win: { w: innerWidth, h: innerHeight, dpr: devicePixelRatio },
    body: rect(document.body),
    html: rect(document.documentElement),
    children: [].slice.call(document.body.children).slice(0,10).map(rect),
    titlebar: pick('[class*=titlebar],[class*=title-bar],[class*=TitleBar]'),
    titlebarProbe: [].slice.call(document.querySelectorAll('*')).slice(0,0),
    sidebar: pick('[class*=sidebar],[class*=side-bar]'),
    main: pick('[class*=main-content],[class*=mainContent],[class*=chat-container]'),
    textarea: pick('textarea,[contenteditable=true]'),
    closeBtn: pick('[class*=close],[aria-label*=lose]')
  };
  /* 找顶部 60px 内、宽度接近满屏的元素，基本就是标题栏 */
  var tops=[];
  [].slice.call(document.querySelectorAll('*')).forEach(function(e){
    var r=e.getBoundingClientRect();
    if(r.top<60 && r.height>0 && r.height<=60 && r.width>innerWidth*0.7){
      tops.push({tag:e.tagName, cls:String(e.className||'').slice(0,70), y:Math.round(r.top), h:Math.round(r.height), w:Math.round(r.width)});
    }
  });
  out.topBars = tops.slice(0,8);
  /* 主题色 */
  var cs=getComputedStyle(document.documentElement);
  out.cssVars={};
  ['--cr-bg','--cr-bg-base','--cr-border','--cr-text','--cr-text-secondary','--cr-accent'].forEach(function(k){
    var v=cs.getPropertyValue(k).trim(); if(v) out.cssVars[k]=v;
  });
  return JSON.stringify(out);
})()`;

const HOST = `(function(){
  try {
    var electron = require('electron');
    function isTarget(u){ return typeof u==='string' && u.indexOf('app.asar')>0 && u.indexOf('renderer/index.html')>0; }
    var ws = electron.webContents.getAllWebContents().filter(function(wc){
      var u=''; try{u=wc.getURL()||'';}catch(e){}
      return isTarget(u);
    });
    if(!ws.length) return 'NO_PAGE';
    return ws[0].executeJavaScript(${JSON.stringify(PROBE)}, true)
      .then(function(r){ return 'OK ' + r; })
      .catch(function(e){ return 'PAGE_ERR ' + e.message; });
  } catch(e){ return 'HOST_ERR ' + ((e&&e.message)||e); }
})()`;

async function probe(port) {
  const list = await getJSON(`http://127.0.0.1:${port}/json/list`);
  const t = (list || []).find((x) => x.webSocketDebuggerUrl);
  if (!t) return null;

  const ws = new WebSocket(t.webSocketDebuggerUrl);
  const opened = await new Promise((r) => {
    if (ws.readyState === 1) return r(true);
    ws.addEventListener('open', () => r(true));
    ws.addEventListener('error', () => r(false));
  });
  if (!opened) return null;

  const res = await new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), 15000);
    const onMsg = (e) => {
      let m; try { m = JSON.parse(e.data); } catch (x) { return; }
      if (m.id !== 1) return;
      ws.removeEventListener('message', onMsg);
      clearTimeout(timer);
      resolve(m.result);
    };
    ws.addEventListener('message', onMsg);
    ws.send(JSON.stringify({
      id: 1, method: 'Runtime.evaluate',
      params: { expression: HOST, includeCommandLineAPI: true, returnByValue: true, awaitPromise: true },
    }));
  });
  try { ws.close(); } catch (e) { /* ignore */ }

  const v = res && res.result && res.result.value;
  if (typeof v === 'string' && v.indexOf('OK ') === 0) {
    try { return JSON.parse(v.slice(3)); } catch (e) { return { raw: v }; }
  }
  return { raw: v || 'no-value' };
}

(async () => {
  const deadline = Date.now() + TIMEOUT_MIN * 60000;
  let seen = findPort(readTail());

  console.log('守卫启动，当前端口=' + (seen || '(无)') + '，等待新一次启动…');
  while (Date.now() < deadline) {
    const p = findPort(readTail());
    if (p && p !== seen) {
      seen = p;
      console.log('发现新端口 ' + p + '，等待页面就绪…');
      for (let i = 0; i < 20; i++) {
        await new Promise((r) => setTimeout(r, 1500));
        const snap = await probe(p);
        if (snap && snap.ready === 'complete' && snap.children && snap.children.length) {
          fs.writeFileSync(OUT, JSON.stringify(snap, null, 2), 'utf8');
          console.log('已抓取 → ' + OUT);
          process.exit(0);
        }
      }
      console.log('页面一直没就绪，放弃这次');
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  console.log('超时退出，没抓到');
})();
