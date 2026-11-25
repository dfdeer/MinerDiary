// 앱 아이콘 만들기 (기획 77번): 게임 안 곡괭이 그림(drawPickArt)을 그대로 써서 PNG로 구움
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
      // 바탕: 깊은 굴 빛 (가장자리까지 꽉 채움, 둥근 모서리는 기기가 깎음)
      const bg = c.createRadialGradient(W * .5, W * .55, W * .05, W * .5, W * .5, W * .75); bg.addColorStop(0, '#5a3a22'); bg.addColorStop(.55, '#2e1f14'); bg.addColorStop(1, '#160f0a'); c.fillStyle = bg; c.fillRect(0, 0, W, W);
      // 등불 빛
      const gl = c.createRadialGradient(W * .5, W * .46, 1, W * .5, W * .46, W * .42); gl.addColorStop(0, 'rgba(255,190,100,.55)'); gl.addColorStop(1, 'rgba(255,190,100,0)'); c.fillStyle = gl; c.fillRect(0, 0, W, W);
      // 바닥 광석 반짝이
      if (W >= 64) [[.2, .78, '#6fd2ea'], [.8, .74, '#e0884a'], [.72, .86, '#b9a8ff']].forEach(([x, y, col]) => { const r = W * .035; c.beginPath(); c.moveTo(W * x, W * y - r * 1.4); c.lineTo(W * x + r, W * y); c.lineTo(W * x, W * y + r * 1.4); c.lineTo(W * x - r, W * y); c.closePath(); c.fillStyle = col; c.fill(); c.lineWidth = Math.max(1, W * .008); c.strokeStyle = '#2b1a12'; c.stroke(); });
      // 곡괭이: 가운데 76% 안(가려지는 둥근 아이콘에서도 잘 보이게)
      const s = Math.round(W * .76), off = document.createElement('canvas'); off.width = off.height = s;
      drawPickArt(off.getContext('2d'), s, { c: '#f5cf45', hd: 'oldwood', ad: ['crystal', 'ruby'], sp: 0 });   // 특수 빛은 그림 칸 밖에서 네모로 잘려 빼고, 바탕 등불 빛을 씀
      c.drawImage(off, (W - s) / 2, (W - s) / 2 - W * .02);
      return cv.toDataURL('image/png');
    }, W);
    fs.writeFileSync(path.join(out, name), Buffer.from(url.split(',')[1], 'base64'));
    console.log('icons/' + name);
  }
  await b.close();
})();
