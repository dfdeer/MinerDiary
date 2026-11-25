// 앱 아이콘 만들기 (기획 77번, 80번): 게임 속 광부(chibi)가 수정 굴에서 곡괭이를 든 모습을 PNG로 구움
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
      // 바탕: 굴 안 (위는 짙은 보라 남색, 아래로 갈수록 따뜻한 등불 빛)
      const bg = c.createLinearGradient(0, 0, 0, W); bg.addColorStop(0, '#2b2350'); bg.addColorStop(.6, '#4a2f5a'); bg.addColorStop(1, '#6b3a3a'); c.fillStyle = bg; c.fillRect(0, 0, 512, 512);
      // 뒤쪽 수정 무리 (빛남)
      const crystal = (x, y, h, w, a, col, lt) => { c.save(); c.translate(x, y); c.rotate(a); c.beginPath(); c.moveTo(-w, 0); c.lineTo(-w, -h * .7); c.lineTo(0, -h); c.lineTo(w, -h * .7); c.lineTo(w, 0); c.closePath(); c.fillStyle = col; c.fill(); c.lineWidth = 7; c.strokeStyle = '#2b1a12'; c.lineJoin = 'round'; c.stroke(); c.beginPath(); c.moveTo(-w * .35, -h * .1); c.lineTo(-w * .35, -h * .7); c.lineTo(0, -h * .9); c.lineTo(0, -h * .1); c.closePath(); c.fillStyle = lt; c.fill(); c.restore(); };
      const glow = (x, y, r, col) => { const g = c.createRadialGradient(x, y, 1, x, y, r); g.addColorStop(0, col); g.addColorStop(1, 'rgba(0,0,0,0)'); c.fillStyle = g; c.fillRect(0, 0, 512, 512); };
      glow(96, 360, 200, 'rgba(120,220,255,.55)'); glow(430, 330, 190, 'rgba(255,120,200,.45)');
      crystal(92, 470, 200, 36, -.3, '#6fd2ea', '#c9f4ff'); crystal(150, 490, 140, 28, .12, '#4fb6d6', '#bdefff');
      crystal(430, 470, 190, 34, .3, '#f07ab0', '#ffd0e6'); crystal(378, 495, 120, 26, -.1, '#b9a8ff', '#e8e0ff');
      // 등불 빛 (광부 뒤)
      glow(256, 250, 230, 'rgba(255,214,120,.55)');
      // 광부: 곡괭이를 들어 올린 순간
      chibi(c, 268, 618, 11.6, { who: "miner", fx: 1, back: false, swing: .62 });
      // 앞쪽 반짝임
      const star = (x, y, r) => { c.beginPath(); for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4, rr = i % 2 ? r * .32 : r; c.lineTo(x + Math.sin(a) * rr, y - Math.cos(a) * rr); } c.closePath(); c.fillStyle = '#fff6c8'; c.fill(); };
      star(112, 118, 26); star(418, 100, 20); star(452, 178, 12);
      return cv.toDataURL('image/png');
    }, W);
    fs.writeFileSync(path.join(out, name), Buffer.from(url.split(',')[1], 'base64'));
    console.log('icons/' + name);
  }
  await b.close();
})();
