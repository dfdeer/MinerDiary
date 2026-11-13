// index.html 안의 <script>를 꺼내 문법 검사하고, 금지 문자(—, •, ·)와 둥근 글꼴에 없는 한글이 있는지 확인
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
// 둥근 글꼴(tools/build-font.py)은 흔한 한글 2350자와 덤 글자만 담음. 그 밖의 한글을 쓰면 글꼴을 다시 만들어야 함
{
  const ks = new Set(), dec = new TextDecoder('euc-kr');
  for (let hi = 0xB0; hi <= 0xC8; hi++) for (let lo = 0xA1; lo <= 0xFE; lo++) { const ch = dec.decode(new Uint8Array([hi, lo])); if (ch.length === 1) ks.add(ch); }
  const fm = html.match(/<style id="font">[\s\S]*?덤 글자: ([^*]*)\*\//);
  if (!fm) { fail++; console.error('둥근 글꼴 묶음 없음 (python3 tools/build-font.py)'); }
  else {
    const extra = new Set(fm[1]), body = html.replace(/<style id="font">[\s\S]*?<\/style><!--font-->/, '');
    const miss = [...new Set(body.match(/[\uac00-\ud7a3]/g) || [])].filter(ch => !ks.has(ch) && !extra.has(ch));
    if (miss.length) { fail++; console.error(`글꼴에 없는 글자: ${miss.join('')} (python3 tools/build-font.py)`); }
  }
}
if (fail) process.exit(1);
console.log(`문법 검사 통과 (스크립트 ${scripts.length}개)`);
