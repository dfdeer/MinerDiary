// 브라우저에서 index.html을 열어 1단계 흐름을 직접 눌러 보고 페이지 오류가 0건인지 확인
const { chromium } = require('playwright');
const path = require('path');
const url = 'file://' + path.join(__dirname, '..', 'index.html');
const shot = process.argv[2];   // 스크린숏을 남길 폴더 (선택)

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  const st = () => page.evaluate(() => JSON.parse(JSON.stringify(window.MinerDiary.state())));
  const ok = (c, msg) => { if (!c) throw new Error('실패: ' + msg); console.log('통과: ' + msg); };
  const click = sel => page.click(sel);
  // 캔버스 위 칸과 건물 누르기
  const tap = async i => { const p = await page.evaluate(i => window.MinerDiary.tilePoint(i), i); await page.mouse.click(p.x, p.y); };
  const visit = async id => { const p = await page.evaluate(id => window.MinerDiary.spotPoint(id), id); await page.mouse.click(p.x, p.y); await page.waitForSelector('#modal:not([hidden])', { timeout: 5000 }); };

  await page.goto(url);
  await page.evaluate(() => localStorage.clear());
  await page.reload();

  // 1. 촌장 소개
  for (let i = 0; i < 5; i++) await click('#modal [data-act="intro"]');
  await click('#modal [data-act="introDone"]');
  ok((await st()).introSeen, '촌장 소개를 끝까지 봄');
  if (shot) await page.screenshot({ path: path.join(shot, 'village.png') });

  // 2. 광산 입장
  await visit('mine');
  await click('#modal [data-act="enter"][data-arg="1"]');
  ok((await st()).screen === 'mine', '광산 1층 입장');
  ok(await page.evaluate(() => window.MinerDiary.state().mine.tiles.filter((t, i) => window.MinerDiary.canDig(i)).length) === 7, '처음엔 맨 윗줄 7칸만 캘 수 있음');

  // 막힌 칸은 기력을 안 씀
  const e0 = (await st()).energy;
  await tap(45);
  ok((await st()).energy === e0, '닿지 않은 칸은 못 캐고 기력 그대로');

  // 3. 계단을 찾아 내려가며 캐기 (5층까지 또는 저녁까지)
  async function digUntilStairs() {
    for (let k = 0; k < 60; k++) {
      const s = await st();
      if (s.screen !== 'mine') return false;
      if (s.mine.tiles.some(t => t.t === 'x' && t.open)) return true;
      // 계단에 가까운 칸부터 (테스트라서 답을 봄)
      const target = s.mine.tiles.findIndex(t => t.t === 'x');
      const can = await page.evaluate(() => {
        const m = window.MinerDiary; const s = m.state();
        return s.mine.tiles.map((t, i) => i).filter(i => m.canDig(i));
      });
      const dist = i => Math.abs(i % 7 - target % 7) + Math.abs(((i / 7) | 0) - ((target / 7) | 0));
      can.sort((a, b) => dist(a) - dist(b));
      await tap(can[0]);
    }
    return false;
  }
  for (let f = 1; f < 5; f++) {
    ok(await digUntilStairs(), `${f}층 계단 발견`);
    if (f === 1 && shot) await page.screenshot({ path: path.join(shot, 'mine.png') });
    await click('[data-act="descend"]');
    ok((await st()).mine.floor === f + 1, `${f + 1}층으로 내려감`);
  }
  let s = await st();
  ok(s.deepest === 5, '가장 깊은 층 5층 기록');
  ok(s.mine.tiles.slice(42).every(t => t.t === 'h'), '5층 맨 아래 줄은 단단한 바위');
  ok(!s.mine.tiles.some(t => t.t === 'x'), '5층엔 계단 없음');

  // 힌트 숫자 확인: 게임이 쓰는 숫자 = 테스트가 따로 센 주변 8칸의 남은 광석 수
  const hintsOk = await page.evaluate(() => {
    const m = window.MinerDiary, t = m.state().mine.tiles;
    return t.every((_, i) => {
      const x = i % 7, y = (i / 7) | 0;
      let n = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy;
        if ((dx || dy) && nx >= 0 && nx < 7 && ny >= 0 && ny < 7 && t[ny * 7 + nx].t === 'o' && !t[ny * 7 + nx].open) n++;
      }
      return m.hint(i) === n;
    });
  });
  ok(hintsOk, '힌트 숫자가 실제 주변 광석 수와 같음');

  // 광맥 잇기: 남은 광석 한 칸을 캐면 이어진 같은 광석이 모두 열림
  s = await st();
  const veinCheck = await page.evaluate(() => {
    const m = window.MinerDiary, s = m.state();
    const i = s.mine.tiles.findIndex((t, k) => t.t === 'o' && m.canDig(k));
    return i;
  });
  if (veinCheck >= 0) {
    const before = (await st()).mine.tiles.filter(t => t.t === 'o').length;
    await tap(veinCheck);
    const after = (await st()).mine.tiles.filter(t => t.t === 'o').length;
    ok(after < before, `광석 칸 캐기 (남은 광석 ${before} → ${after})`);
  }

  // 광맥 잇기 (정해진 판): 0, 1, 7번 칸이 이어진 구리 3칸이면 한 번에 4개
  await page.evaluate(() => {
    const s = window.MinerDiary.state();
    s.mine.tiles = s.mine.tiles.map(() => ({ t: 's', open: false }));
    [0, 1, 7].forEach(i => { s.mine.tiles[i] = { t: 'o', o: 'copper', open: false }; });
    s.mine.tiles[9] = { t: 'o', o: 'iron', open: false };
  });
  const cu = (await st()).inv.copper || 0;
  await tap(0);
  s = await st();
  ok(s.inv.copper === cu + 4 && [0, 1, 7].every(i => s.mine.tiles[i].open) && !s.mine.tiles[9].open, '광맥 잇기: 이어진 구리 3칸을 한 번에 캐고 덤 1개');
  ok(await page.evaluate(() => window.MinerDiary.hint(1) === 1 && window.MinerDiary.hint(7) === 0), '열린 1번 칸 힌트 1 (대각선 철 광석), 7번 칸은 0');

  // 시간대: 쓴 기력 비율과 맞는지
  s = await st();
  const used = (s.dayStart - s.minE) / s.max * 100;
  const expect = used >= 90 ? 3 : used >= 60 ? 2 : used >= 30 ? 1 : 0;
  ok(await page.evaluate(() => window.MinerDiary.phaseIndex()) === expect, `시간대가 쓴 기력 ${used}%와 맞음`);

  // 4. 마을로 가서 팔기
  if ((await st()).screen === 'mine') await click('[data-act="leave"]');
  s = await st();
  const value = { copper: 10, iron: 25, crystal: 60, moon: 150 };
  const worth = Object.entries(s.inv).reduce((a, [o, n]) => a + n * value[o], 0);
  ok(worth > 0, `가방에 광석 있음 (🪙${worth}어치)`);
  await visit('merchant');
  if (shot) await page.screenshot({ path: path.join(shot, 'merchant.png') });
  await click('#modal [data-act="sellAll"]');
  s = await st();
  ok(s.gold === worth && Object.values(s.inv).every(n => n === 0), '전부 팔아 돈이 정확히 들어옴');
  await click('#modal [data-act="close"]');

  // 5. 집에서 자기
  const day = s.day, late = await page.evaluate(() => window.MinerDiary.phaseIndex()) === 3;
  await visit('house');
  await click('#modal [data-act="sleep"]');
  s = await st();
  ok(s.day === day + 1 && s.energy === (late ? 90 : 100) && s.minE === s.energy, `자고 나서 ${s.day}일차 기력 ${s.energy}`);
  await click('#modal [data-act="close"]');

  // 6. 쓰러짐: 기력을 0까지 씀
  await visit('mine');
  await click('#modal [data-act="enter"][data-arg="1"]');
  const dayBefore = (await st()).day;
  for (let k = 0; k < 200; k++) {
    s = await st();
    if (s.day !== dayBefore) break;
    if (s.mine.tiles.some(t => t.t === 'x' && t.open)) { await click('[data-act="descend"]'); continue; }
    const can = await page.evaluate(() => {
      const m = window.MinerDiary, s = m.state();
      return s.mine.tiles.map((t, i) => i).filter(i => m.canDig(i));
    });
    if (!can.length) { await click('[data-act="leave"]'); await visit('mine'); await click('#modal [data-act="enter"][data-arg="1"]'); continue; }
    await tap(can[0]);
  }
  s = await st();
  ok(s.day === dayBefore + 1 && s.energy === 70 && s.screen === 'village', '쓰러지면 다음 날 집에서 기력 70');
  ok(await page.evaluate(() => window.MinerDiary.phaseIndex()) === 0, '쓰러진 다음 날도 아침에 시작');
  ok((await page.evaluate(() => window.MinerDiary.untilNext())).left === 30, '점심까지 기력 30');
  ok(await page.locator('#modal h3').textContent() === '😵 쓰러짐', '쓰러짐 안내 창');
  if (shot) await page.screenshot({ path: path.join(shot, 'faint.png') });
  await click('#modal [data-act="close"]');

  // 7. 저장 확인
  await page.reload();
  ok((await st()).day === s.day, '새로고침 후에도 날짜 유지');

  // 8. 대장간 팻말
  await visit('smithy');
  ok((await page.locator('#modal').textContent()).includes('곡괭이 강화'), '대장간 팻말');

  // 9. 가로 넘침 없음
  ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), '가로 스크롤 없음');

  await browser.close();
  if (errors.length) { console.error('페이지 오류:\n' + errors.join('\n')); process.exit(1); }
  console.log('브라우저 테스트 통과 (페이지 오류 0건)');
})().catch(e => { console.error(e.message); process.exit(1); });
