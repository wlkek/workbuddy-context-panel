/* 测试用：把 server.js 套一层 HTTP，行为与 injector 里的路由一致 */
'use strict';
const http = require('http');
const handler = require('../mods/context-panel/server.js');

const srv = http.createServer((rq, rs) => {
  const u = new URL(rq.url, 'http://127.0.0.1');
  const seg = u.pathname.split('/').filter(Boolean);
  const h = seg[0] === 'api' ? handler : null;
  const send = (code, obj) => {
    rs.writeHead(code, {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-store',
    });
    rs.end(JSON.stringify(obj));
  };
  if (!h) return send(404, { error: 'no handler' });
  try {
    // 与 injector 一致：/api/<modId>/<rest>，处理函数只拿到 <rest>
    Promise.resolve(h(seg.slice(2), Object.fromEntries(u.searchParams)))
      .then((v) => send(200, v))
      .catch((e) => send(500, { error: String(e && e.message || e) }));
  } catch (e) { send(500, { error: String(e && e.message || e) }); }
});

srv.listen(0, '127.0.0.1', () => {
  const p = srv.address().port;
  require('fs').writeFileSync(__dirname + '/port.txt', String(p));
  console.log('mock listening', p);
});
setTimeout(() => process.exit(0), 60000);
