// 앱 아이콘 만들기 (기획 77번, 80번): 보석 없는 곡괭이 하나만 따뜻한 바탕에 그려 PNG로 구움
// 쓰는 법: node tools/build-icons.js  (icons/ 에 icon-512.png, icon-192.png, apple-touch-icon.png, favicon-32.png)
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
(async () => {
  const root = path.join(__dirname, '..'), out = path.join(root, 'icons');
  fs.mkdirSync(out, { recursive: true });
  const b = await chromium.launch(), p = await b.newPage();
  await p.goto('file://' + path.join(root, 'index.html'));
  await p.waitForFunction(() => window.MinerDiary && window.MinerDiary.ready);
  const sizes = { 'icon-512.png': 512, 'icon-192.png': 192, 'apple-touch-icon.png': 180, 'favicon-32.png': 32 };
  for (const [name, W] of Object.entries(sizes)) {
    const url = await p.evaluate(W => {
      const cv = document.createElement('canvas'); cv.width = cv.height = W; const c = cv.getContext('2d');
      c.scale(W / 512, W / 512);   // 512칸 기준으로 그리고 크기만 줄임
      // 바탕: 따뜻한 굴빛 둥근 빛
      const bg = c.createRadialGradient(256, 230, 20, 256, 256, 380); bg.addColorStop(0, '#f6c46a'); bg.addColorStop(.55, '#d9893e'); bg.addColorStop(1, '#8a4a24'); c.fillStyle = bg; c.fillRect(0, 0, 512, 512);
      // 곡괭이만: 보석 칸 없이 쇠 머리와 나무 자루
      const s = 430, off = document.createElement('canvas'); off.width = off.height = s;
      drawPickArt(off.getContext('2d'), s, { c: '#c9d2dc', hd: 'wood', ad: [], sp: 0 });
      c.drawImage(off, (512 - s) / 2 + 14, (512 - s) / 2 + 4);
      return cv.toDataURL('image/png');
    }, W);
    fs.writeFileSync(path.join(out, name), Buffer.from(url.split(',')[1], 'base64'));
    console.log('icons/' + name);
  }
  await b.close();
})();
