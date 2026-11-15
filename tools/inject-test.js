/* 开发用：绕过重启，直接往正在运行的客户端主进程注入面板并回读结果。
 * 用法：node tools/inject-test.js <inspector端口> <api端口>
 * 只在已经用 --inspect 启动的客户端上有效。
 */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');

const INSPECT_PORT = process.argv[2] || '9081';
const API_PORT = process.argv[3] || '';
const MOD_DIR = path.join(__dirname, '..', 'mods', 'context-panel');
const MOD_SRC = fs.readFileSync(path.join(MOD_DIR, 'mod.js'), 'utf8');

function getJSON(url) {
  return new Promise((res) => {
    http.get(url, { timeout: 2000 }, (r) => {
      let b = '';
      r.on('data', (c) => b += c);
      r.on('end', () => { try { res(JSON.parse(b)); } catch (e) { res(null); } });
    }).on('error', () => res(null));
  });
}

const expr = `(function(){
  try {
    var req = require, electron = req('electron'), fs = req('fs');
    /* 用字符串判断代替正则，避免多层转义出错 */
    function isTarget(u) {
      return typeof u === 'string' && u.indexOf('app.asar') > 0 && u.indexOf('renderer/index.html') > 0;
    }
    var MOD = ${JSON.stringify(MOD_SRC)};
    var API = ${JSON.stringify(API_PORT)};
    var out = [];

    electron.webContents.getAllWebContents().forEach(function (wc) {
      var url = '';
      try { url = wc.getURL() || ''; } catch (e) { return; }
      if (!isTarget(url)) return;

      wc.executeJavaScript(
        '(function(){ try { delete window.__WB_CTX_PANEL__; window.__WB_CTX_PANEL__ = false;' +
        ' window.__WB_MOD_API = ' + JSON.stringify('http://127.0.0.1:' + API) + '; } catch(e){} })()',
        true
      ).then(function () {
        return wc.executeJavaScript(MOD, true);
      }).then(function () {
        return new Promise(function (r) { setTimeout(r, 1800); });
      }).then(function () {
        return wc.executeJavaScript(
          '(function(){' +
          ' var h = document.querySelector("[data-wb-ctx]");' +
          ' var sr = h && h.shadowRoot;' +
          ' return JSON.stringify({' +
          '   host: !!h,' +
          '   fab: !!(sr && sr.querySelector(".fab")),' +
          '   panel: !!(sr && sr.querySelector(".panel")),' +
          '   open: !!(sr && sr.querySelector(".panel.open")),' +
          '   rows: sr ? sr.querySelectorAll(".row").length : 0,' +
          '   sum: sr && sr.querySelector(".sum") ? sr.querySelector(".sum").textContent.replace(/\\\\s+/g," ").trim() : "",' +
          '   err: sr && sr.querySelector(".err") ? sr.querySelector(".err").textContent : ""' +
          ' }); })()',
          true
        );
      }).then(function (r) {
        out.push(r);
        fs.appendFileSync(${JSON.stringify(path.join(process.env.LOCALAPPDATA || '', 'WbMods', 'loader.log'))},
          '[' + new Date().toISOString() + '] devcheck ' + r + String.fromCharCode(10));
      }).catch(function (e) {
        fs.appendFileSync(${JSON.stringify(path.join(process.env.LOCALAPPDATA || '', 'WbMods', 'loader.log'))},
          '[' + new Date().toISOString() + '] devcheck fail ' + e.message + String.fromCharCode(10));
      });
    });
    return 'dispatched';
  } catch (e) { return 'ERR:' + ((e && e.message) || e); }
})()`;

(async () => {
  const list = await getJSON(`http://127.0.0.1:${INSPECT_PORT}/json/list`);
  const t = (list || []).find((x) => x.webSocketDebuggerUrl);
  if (!t) { console.log('没有可用的 inspector target'); return; }

  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r));
  const result = await new Promise((resolve) => {
    ws.addEventListener('message', (e) => {
      let m; try { m = JSON.parse(e.data); } catch (err) { return; }
      if (m.id === 1) resolve(m.result);
    });
    ws.send(JSON.stringify({
      id: 1, method: 'Runtime.evaluate',
      params: { expression: expr, includeCommandLineAPI: true, returnByValue: true },
    }));
  });
  console.log('下发:', JSON.stringify(result && result.result && result.result.value));
  await new Promise((r) => setTimeout(r, 4000));
  ws.close();
})();
