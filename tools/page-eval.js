/* 在客户端页面里求值。
 * 主进程 inspector 里没有 document，必须先 executeJavaScript 下沉到页面。
 *
 * 用法：node tools/page-eval.js <inspector端口> "<页面表达式>"
 */
'use strict';

const http = require('http');

const PORT = process.argv[2] || '9081';
const PAGE_EXPR = process.argv[3] || '1+1';

const hostExpr = `(function(){
  try {
    var electron = require('electron');
    function isTarget(u) {
      return typeof u === 'string' && u.indexOf('app.asar') > 0 && u.indexOf('renderer/index.html') > 0;
    }
    var list = electron.webContents.getAllWebContents().filter(function (wc) {
      var u = ''; try { u = wc.getURL() || ''; } catch (e) {}
      return isTarget(u);
    });
    if (!list.length) return 'no-page';
    return list[0].executeJavaScript(${JSON.stringify(PAGE_EXPR)}, true)
      .then(function (r) { return 'RESULT ' + (typeof r === 'string' ? r : JSON.stringify(r)); })
      .catch(function (e) { return 'PAGE_ERR ' + e.message; });
  } catch (e) { return 'HOST_ERR ' + ((e && e.message) || e); }
})()`;

function getJSON(url) {
  return new Promise((res) => {
    http.get(url, { timeout: 2000 }, (r) => {
      let b = '';
      r.on('data', (c) => b += c);
      r.on('end', () => { try { res(JSON.parse(b)); } catch (e) { res(null); } });
    }).on('error', () => res(null));
  });
}

(async () => {
  const list = await getJSON(`http://127.0.0.1:${PORT}/json/list`);
  const t = (list || []).find((x) => x.webSocketDebuggerUrl);
  if (!t) { console.log('no target'); return; }

  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r));
  const res = await new Promise((resolve) => {
    ws.addEventListener('message', (e) => {
      let m; try { m = JSON.parse(e.data); } catch (x) { return; }
      if (m.id === 1) resolve(m.result);
    });
    ws.send(JSON.stringify({
      id: 1,
      method: 'Runtime.evaluate',
      params: { expression: hostExpr, includeCommandLineAPI: true, returnByValue: true, awaitPromise: true },
    }));
  });
  const v = res && res.result && 'value' in res.result ? res.result.value : ('RAW ' + JSON.stringify(res).slice(0, 300));
  console.log(v);
  ws.close();
})();
