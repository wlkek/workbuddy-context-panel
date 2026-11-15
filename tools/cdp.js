/* 在无头浏览器里量真实几何：node tools/cdp.js <port> "<js表达式>" */
'use strict';
const http = require('http');

const port = process.argv[2] || '9333';
const expr = process.argv[3] || '1+1';

function getJSON(url) {
  return new Promise((resolve) => {
    http.get(url, { timeout: 2000 }, (res) => {
      let b = '';
      res.on('data', (c) => { b += c; });
      res.on('end', () => { try { resolve(JSON.parse(b)); } catch (e) { resolve(null); } });
    }).on('error', () => resolve(null));
  });
}

(async () => {
  const list = await getJSON('http://127.0.0.1:' + port + '/json/list');
  const pages = (list || []).filter((x) => x.type === 'page' && x.webSocketDebuggerUrl);
  const page = pages.filter((x) => (x.url || '').indexOf('fixture') >= 0)[0] ||
    pages.filter((x) => (x.url || '').indexOf('file:') === 0)[0] || pages[0];
  if (!page) { console.log('no page target'); return; }
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r));
  const result = await new Promise((resolve) => {
    ws.addEventListener('message', (e) => {
      let m;
      try { m = JSON.parse(e.data); } catch (err) { return; }
      if (m.id === 1) resolve(m.result);
    });
    ws.send(JSON.stringify({
      id: 1,
      method: 'Runtime.evaluate',
      params: { expression: expr, returnByValue: true, awaitPromise: true },
    }));
  });
  const v = result && result.result;
  if (v && 'value' in v) {
    console.log(typeof v.value === 'string' ? v.value : JSON.stringify(v.value, null, 2));
  } else {
    console.log('RAW ' + JSON.stringify(result).slice(0, 500));
  }
  ws.close();
})();
