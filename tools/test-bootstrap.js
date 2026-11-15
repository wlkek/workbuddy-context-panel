/* bootstrap 的离线回归测试：不启动客户端，用假的 electron 模块跑一遍。
 *
 * 目的：入口判定、注入时机、日志这三件事，必须能在提交前验证。
 * 曾经因为模板字符串把正则里的 \/ 吃成 /，整行变成注释，三个 mod 全部没注入，
 * 而语法检查是通的——所以这里跑的是真实分支，不是语法。
 *
 * 用法：node tools/test-bootstrap.js
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { buildBootstrap } = require('../loader/injector.js');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-boot-'));
const modsDir = path.join(tmp, 'mods');
const logFile = path.join(tmp, 'loader.log');

/* 一个最小 mod：只有一个 ui 文件和一个 server */
const modDir = path.join(modsDir, 'context-panel');
fs.mkdirSync(modDir, { recursive: true });
fs.writeFileSync(path.join(modDir, 'manifest.json'), JSON.stringify({
  name: 'test', version: '9.9.9', main: 'ui.js', files: ['ui.js'], server: 'server.js'
}));
fs.writeFileSync(path.join(modDir, 'ui.js'), 'window.__WB_TEST_UI = 1;');
fs.writeFileSync(path.join(modDir, 'server.js'),
  'module.exports = { call: function (op) { return Promise.resolve({ op: op }); }, start: function () {} };');

/* ---- 假 electron ---- */
const appEvents = {};
const wcs = [];
let inspectorClosed = false;
const executed = [];

const fakeElectron = {
  app: {
    on(ev, fn) { appEvents[ev] = fn; },
  },
  webContents: {
    getAllWebContents() { return wcs; },
  },
};

function makeWc(url) {
  const handlers = {};
  return {
    url,
    getURL() { return this.url; },
    on(ev, fn) { (handlers[ev] = handlers[ev] || []).push(fn); },
    emit(ev) { (handlers[ev] || []).forEach((fn) => fn()); },
    executeJavaScript(code) {
      executed.push(code);
      /* 反向通道的那句要一直挂着，模拟页面还没发请求 */
      if (code.indexOf('__WB_CTX_PUSH=res') >= 0) return new Promise(() => {});
      return Promise.resolve();
    },
  };
}

function fakeRequire(id) {
  if (id === 'electron') return fakeElectron;
  if (id === 'inspector') return { close() { inspectorClosed = true; } };
  return require(id);
}

/* ---- 跑 ---- */
const src = buildBootstrap(modsDir, logFile);

const run = new Function('require', 'process', 'setTimeout', 'setInterval', 'clearInterval',
  'return ' + src);

(async () => {
  const result = await run(fakeRequire, process, setTimeout, setInterval, clearInterval);
  const check = (name, ok) => console.log((ok ? '  PASS  ' : '  FAIL  ') + name);

  console.log('bootstrap 返回:', result);
  check('返回 OK 且识别到 3 个字段', typeof result === 'string' && result.indexOf('OK mods=1 servers=1') === 0);

  /* 窗口晚了 300ms 才创建，模拟 bootstrap 早于窗口 */
  const other = makeWc('file:///C:/Program%20Files/WorkBuddy/resources/app.asar/renderer/help.html');
  wcs.push(other);
  const target = makeWc('file:///C:/Program%20Files/WorkBuddy/resources/app.asar/renderer/index.html');
  wcs.push(target);

  await new Promise((r) => setTimeout(r, 1200));

  const uiCalls = executed.filter((c) => c.indexOf('__WB_TEST_UI') >= 0);
  check('目标页面被注入一次', uiCalls.length === 1);
  check('devtools 页面被跳过', executed.every((c) => c.indexOf('__WB_TEST_UI') < 0 || c === uiCalls[0]));

  /* 页面 reload：did-start-loading 之后应该还能再注入 */
  target.emit('did-start-loading');
  await new Promise((r) => setTimeout(r, 1000));
  check('刷新后能再次注入', executed.filter((c) => c.indexOf('__WB_TEST_UI') >= 0).length === 2);

  const log = fs.readFileSync(logFile, 'utf8');
  check('日志里有 injected', /injected context-panel@9\.9\.9/.test(log));
  check('日志里有 skip wc（说明判定分支真的走了）', /skip wc/.test(log));

  await new Promise((r) => setTimeout(r, 300));
  fs.rmSync(tmp, { recursive: true, force: true });
  const failed = !(/OK mods=1/.test(String(result)) &&
    uiCalls.length === 1 && /injected context-panel@9\.9\.9/.test(log));
  process.exit(failed ? 1 : 0);
})();
