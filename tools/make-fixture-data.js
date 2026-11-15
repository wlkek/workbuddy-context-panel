/* 生成 fixture 用的静态数据（开发用，不打包） */
'use strict';
const fs = require('fs');
const path = require('path');

const REF = path.join(__dirname, '..', '..', '_ref');
const overview = JSON.parse(fs.readFileSync(path.join(REF, 'overview.json'), 'utf8'));
const session = JSON.parse(fs.readFileSync(path.join(REF, 'session.json'), 'utf8'));

const out = '/* 由 tools/make-fixture-data.js 生成，仅用于本地验证 */\n' +
  'window.__FIXTURE__ = ' + JSON.stringify({ overview: overview, session: session }) + ';\n';
fs.writeFileSync(path.join(__dirname, 'data.js'), out, 'utf8');
console.log('data.js', Math.round(out.length / 1024), 'KB');
