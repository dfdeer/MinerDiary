// index.html 안의 <script>를 꺼내 문법 검사하고, 금지 문자(—, •, ·)가 있는지 확인
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const file = path.join(__dirname, '..', 'index.html');
const html = fs.readFileSync(file, 'utf8');
let fail = 0;
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
if (!scripts.length) { console.error('스크립트 없음'); process.exit(1); }
scripts.forEach((code, i) => {
  try { new vm.Script(code, { filename: `index.html#script${i}` }); }
  catch (e) { fail++; console.error(`문법 오류: ${e.message}`); }
});
html.split('\n').forEach((line, n) => {
  if (/[—•·]/.test(line)) { fail++; console.error(`금지 문자 ${n + 1}행: ${line.trim()}`); }
});
if (fail) process.exit(1);
console.log(`문법 검사 통과 (스크립트 ${scripts.length}개)`);
