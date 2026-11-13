// 브라우저에서 index.html을 열어 1단계 흐름을 직접 눌러 보고 페이지 오류가 0건인지 확인
// 사용: node tools/browser-test.js [스크린숏 폴더]
const { chromium } = require('playwright');
const path = require('path');
const url = 'file://' + path.join(__dirname, '..', 'index.html');
const shot = process.argv[2];

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const ok = (c, msg) => { if (!c) throw new Error('실패: ' + msg); console.log('통과: ' + msg); };

  async function open(w, h) {
    const page = await browser.newPage({ viewport: { width: w, height: h } });
    page.on('pageerror', e => errors.push(`[${w}] pageerror: ${e.message}`));
    page.on('console', m => { if (m.type() === 'error') errors.push(`[${w}] console: ${m.text()}`); });
    await page.goto(url);
    await page.evaluate(() => localStorage.clear());
    await page.reload(); await page.waitForFunction(() => window.MinerDiary && window.MinerDiary.ready, null, { timeout: 15000 });
    await page.waitForTimeout(500);
    return page;
  }
  const helpers = page => ({
    st: () => page.evaluate(() => JSON.parse(JSON.stringify(window.MinerDiary.state()))),
    // 캔버스 위 칸 누르기
    tap: async i => { const p = await page.evaluate(i => window.MinerDiary.tilePoint(i), i); await page.mouse.click(p.x, p.y); },
    // 건물이나 사람을 화면 가운데로 옮겨 누르고, 광부가 걸어가서 아래 판이 바뀔 때까지 기다림
    visit: async (id, sel) => { if (await page.locator('#sheet [data-a="close"]').isVisible()) await page.click('#sheet [data-a="close"]'); const p = await page.evaluate(id => window.MinerDiary.spotPoint(id), id); await page.mouse.click(p.x, p.y); await page.waitForSelector(sel, { timeout: 15000 }); },
    canList: () => page.evaluate(() => { const m = window.MinerDiary, s = m.state(); return s.mine.tiles.map((t, i) => i).filter(i => m.canDig(i)); }),
  });

  /* ===== 폰 크기 ===== */
  const page = await open(390, 844);
  const { st, tap, visit, canList } = helpers(page);
  await page.evaluate(() => window.MinerDiary.speed(10));

  ok(await page.locator('#loading').isHidden(), '그림을 다 읽으면 로딩 화면이 사라짐');
  // 1. 퀘스트를 따라 촌장 만나기
  const quest = () => page.evaluate(() => document.querySelector('.quest').innerText.replace(/\s+/g, ' ').trim());
  ok(await page.locator('#sheet').isHidden() && (await quest()).includes('촌장 만나기'), '시작하면 첫 퀘스트 「촌장 만나기」가 보임');
  await page.click('[data-a="quest"]');
  await page.waitForSelector('#sheet [data-a="intro"]', { timeout: 15000 });
  ok(true, '퀘스트를 누르면 촌장에게 걸어가서 소개가 열림');
  const line1 = await page.textContent('#sheet p');
  await page.click('#sheet [data-a="intro"]');
  ok(await page.textContent('#sheet p') !== line1, '다음을 누르면 대사가 넘어감');
  await page.click('#sheet [data-a="introPrev"]');
  ok(await page.textContent('#sheet p') === line1 && await page.locator('#sheet [data-a="introPrev"]').count() === 0, '이전을 누르면 앞 대사로 돌아가고, 첫 대사엔 이전 단추가 없음');
  while (await page.locator('#sheet [data-a="intro"]').count()) await page.click('#sheet [data-a="intro"]');
  await page.click('#sheet [data-a="introDone"]');
  ok((await st()).introSeen && (await quest()).includes('광산 들어가기'), '소개가 끝나면 다음 퀘스트 「광산 들어가기」');
  ok(!/누른 곳|끌어서|스페이스바|밝은 테두리/.test(await page.evaluate(() => document.body.innerText)), '조작 설명 문구 없음');
  if (shot) await page.screenshot({ path: path.join(shot, 'village.png') });

  // 2. 상호작용하는 것끼리 화면에서 겹치지 않음 (누르는 모양 기준)
  const overlaps = await page.evaluate(() => {
    const OBJ = window.MinerDiary.objects();
    const TALL = { house: 3.4, smithy: 4, kitchen: 3.6, jewel: 3.6, market: 2.6, museum: 4, mine: 4.2, gate: 2.4, npc: 2.2, wagon: 2.2 };
    const poly = o => { const z = hgt(o.gx, o.gy), up = ZU * (TALL[o.kind] || 1.2); const a = iso(o.gx, o.gy, z), b = iso(o.gx + o.w, o.gy, z), c = iso(o.gx + o.w, o.gy + o.d, z), d = iso(o.gx, o.gy + o.d, z); return [d, c, b, [b[0], b[1] - up], [a[0], a[1] - up], [d[0], d[1] - up]]; };
    const both = (A, B) => { const xs = A.map(q => q[0]), ys = A.map(q => q[1]); for (let x = Math.min(...xs); x <= Math.max(...xs); x += 3) for (let y = Math.min(...ys); y <= Math.max(...ys); y += 3) if (inPoly(x, y, A) && inPoly(x, y, B)) return true; return false; };
    const act = OBJ.filter(o => !['bigtree', 'bridge', 'field'].includes(o.kind)), out = [];
    act.forEach((a, i) => act.forEach((b, j) => { if (j > i && both(poly(a), poly(b))) out.push(a.id + '/' + b.id); }));
    return out;
  });
  // 누를 수 있는 것끼리 바닥 칸이 2칸 이상 떨어져 있음 (사이 땅을 눌러 걸어갈 수 있게)
  const tight = await page.evaluate(() => {
    const act = window.MinerDiary.objects().filter(o => !['bigtree', 'bridge', 'field'].includes(o.kind)), out = [];
    act.forEach((a, i) => act.forEach((b, j) => { if (j <= i) return; const gx = Math.max(a.gx - (b.gx + b.w), b.gx - (a.gx + a.w)), gy = Math.max(a.gy - (b.gy + b.d), b.gy - (a.gy + a.d)); if (Math.max(gx, gy) < 2) out.push(a.id + '/' + b.id); }));
    return out;
  });
  ok(tight.length === 0, '건물과 사람 사이가 2칸 이상 떨어져 있음 ' + tight.join(' '));
  ok(overlaps.length === 0, '누를 수 있는 것끼리 겹침 없음 ' + overlaps.join(' '));
  ok(await page.evaluate(() => window.MinerDiary.objects().filter(o => o.door).every(o => !blocked(o.door[0], o.door[1]))), '모든 건물 문 앞 칸이 비어 있음');

  // 3. 촌장에게 가서 말 걸기
  await visit('chief', '#sheet h2:has-text("촌장")');
  ok(true, '촌장까지 걸어가서 대화');

  // 3-1. 대화창이 열려 있으면 다른 행동을 못 함
  const h0 = await page.evaluate(() => [hero.x, hero.y, cam.fx]);
  await page.mouse.click(60, 200);
  await page.mouse.move(200, 250); await page.mouse.down(); await page.mouse.move(80, 250, { steps: 4 }); await page.mouse.up();
  await page.waitForTimeout(300);
  const h1 = await page.evaluate(() => [hero.x, hero.y, cam.fx, hero.path.length]);
  ok(h0[0] === h1[0] && h0[1] === h1[1] && h0[2] === h1[2] && h1[3] === 0 && await page.locator('#sheet').isVisible(), '대화창이 열린 동안엔 걷기와 끌기가 막힘');

  // 4. 광산 입장
  await visit('mine', '#sheet [data-a="enter"]');
  await page.click('#sheet [data-a="enter"][data-n="1"]');
  await page.waitForFunction(() => window.MinerDiary.scene() === 'mine', null, { timeout: 5000 });
  await page.waitForTimeout(300);
  ok((await st()).screen === 'mine', '광산 1층 입장');
  ok((await quest()).includes('광석 캐기'), '광산에 들어가면 퀘스트 「광석 캐기」');
  ok((await canList()).length === 7, '처음엔 맨 윗줄 7칸만 캘 수 있음');
  const e0 = (await st()).energy;
  await tap(45);
  ok((await st()).energy === e0, '닿지 않은 칸은 못 캐고 기력 그대로');

  // 5. 계단을 찾아 5층까지
  async function digUntilStairs() {
    for (let k = 0; k < 60; k++) {
      const s = await st();
      if (s.screen !== 'mine') return false;
      if (s.mine.tiles.some(t => t.t === 'x' && t.open)) return true;
      const target = s.mine.tiles.findIndex(t => t.t === 'x');
      const can = await canList();
      const dist = i => Math.abs(i % 7 - target % 7) + Math.abs(((i / 7) | 0) - ((target / 7) | 0));
      can.sort((a, b) => dist(a) - dist(b));
      await tap(can[0]);
    }
    return false;
  }
  for (let f = 1; f < 5; f++) {
    ok(await digUntilStairs(), `${f}층 계단 발견`);
    if (f === 1 && shot) await page.screenshot({ path: path.join(shot, 'mine.png') });
    await page.click('[data-a="descend"]');
    await page.waitForTimeout(100);
    ok((await st()).mine.floor === f + 1, `${f + 1}층으로 내려감`);
  }
  let s = await st();
  ok(s.deepest === 5, '가장 깊은 층 5층 기록');
  ok(s.mine.tiles.slice(42).every(t => t.t === 'h'), '5층 맨 아래 줄은 단단한 바위');
  ok(!s.mine.tiles.some(t => t.t === 'x'), '5층엔 계단 없음');

  // 6. 힌트 숫자: 게임이 쓰는 숫자 = 따로 센 주변 8칸의 남은 광석 수
  ok(await page.evaluate(() => {
    const m = window.MinerDiary, t = m.state().mine.tiles;
    return t.every((_, i) => { const x = i % 7, y = (i / 7) | 0; let n = 0; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const a = x + dx, b = y + dy; if ((dx || dy) && a >= 0 && a < 7 && b >= 0 && b < 7 && t[b * 7 + a].t === 'o' && !t[b * 7 + a].open) n++; } return m.hint(i) === n; });
  }), '힌트 숫자가 실제 주변 광석 수와 같음');

  // 6-1. 연쇄: 광석이 하나도 없는 판에서 한 칸을 캐면 기력 2로 판 전체가 열림
  await page.evaluate(() => { const s = window.MinerDiary.state(); s.mine.tiles = s.mine.tiles.map(() => ({ t: 's', open: false })); });
  const eC = (await st()).energy;
  await tap(3);
  s = await st();
  ok(s.mine.tiles.every(t => t.open) && s.energy === eC - 2, '숫자 없는 칸은 이웃까지 연쇄로 열리고 기력은 한 번만 씀');

  // 7. 광맥 잇기 (정해진 판)
  await page.evaluate(() => { const s = window.MinerDiary.state(); s.mine.tiles = s.mine.tiles.map(() => ({ t: 's', open: false })); [0, 1, 7].forEach(i => { s.mine.tiles[i] = { t: 'o', o: 'copper', open: false }; }); s.mine.tiles[9] = { t: 'o', o: 'iron', open: false }; });
  const cu = (await st()).inv.copper || 0;
  await tap(0);
  s = await st();
  ok(s.inv.copper === cu + 4 && [0, 1, 7].every(i => s.mine.tiles[i].open) && !s.mine.tiles[9].open, '광맥 잇기: 이어진 구리 3칸을 한 번에 캐고 덤 1개');
  ok(await page.evaluate(() => window.MinerDiary.hint(1) === 1 && window.MinerDiary.hint(7) === 0), '열린 1번 칸 힌트 1, 7번 칸은 0');

  // 7-1. 광석 캐기 퀘스트가 확실히 끝나도록 구리 3칸을 한 번 더 (운에 따라 5개가 안 될 수 있음)
  await page.evaluate(() => { const s = window.MinerDiary.state(); s.mine.tiles = s.mine.tiles.map(() => ({ t: 's', open: false })); [0, 1, 7].forEach(i => { s.mine.tiles[i] = { t: 'o', o: 'copper', open: false }; }); });
  await tap(0);

  // 8. 시간대
  s = await st();
  const used = (s.dayStart - s.minE) / s.max * 100;
  ok(await page.evaluate(() => window.MinerDiary.phaseIndex()) === (used >= 90 ? 3 : used >= 60 ? 2 : used >= 30 ? 1 : 0), `시간대가 쓴 기력 ${used}%와 맞음`);

  // 9. 마을로 나와서 팔기
  await page.click('[data-a="leave"]');
  await page.waitForTimeout(1300);
  ok((await st()).screen === 'village', '마을로 돌아옴');
  s = await st();
  const value = { copper: 10, iron: 25, crystal: 60, moon: 150 };
  const worth = Object.entries(s.inv).reduce((a, [o, n]) => a + n * value[o], 0), g0 = s.gold;
  ok(s.quest === 3 && g0 === 20, '광석 5개를 캐면 보상 🪙20과 함께 「상인에게 광석 팔기」로');
  ok(worth > 0, `가방에 광석 있음 (🪙${worth}어치)`);
  await visit('merchant', '#sheet [data-a="sellAll"]');
  if (shot) await page.screenshot({ path: path.join(shot, 'merchant.png') });
  await page.click('#sheet [data-a="sellAll"]');
  s = await st();
  ok(s.gold === g0 + worth + 20 && Object.values(s.inv).every(n => n === 0), '전부 팔아 돈이 정확히 들어옴 (퀘스트 보상 🪙20 포함)');
  ok(s.quest === 4, '팔고 나면 퀘스트 「집에서 자기」');

  // 10. 집에서 자기
  const day = s.day, late = await page.evaluate(() => window.MinerDiary.phaseIndex()) === 3;
  await visit('house', '#sheet [data-a="sleep"]');
  await page.click('#sheet [data-a="sleep"]');
  s = await st();
  ok(s.day === day + 1 && s.energy === (late ? 90 : 100) && s.minE === s.energy, `자고 나서 ${s.day}일차 기력 ${s.energy}`);
  ok((s.quest === 6 || (s.quest === 7 && s.gold >= 500)) && (await quest()).includes('대장간 복구비'), '자고 나면 이미 간 3층은 바로 끝나고 「대장간 복구비 모으기」 (돈이 500 이상이면 그것도 끝)');

  // 11. 쓰러짐
  await visit('mine', '#sheet [data-a="enter"]');
  await page.click('#sheet [data-a="enter"][data-n="1"]');
  await page.waitForFunction(() => window.MinerDiary.scene() === 'mine', null, { timeout: 5000 });
  const dayBefore = (await st()).day;
  let guarded = false;
  for (let k = 0; k < 200; k++) {
    s = await st();
    if (s.day !== dayBefore) break;
    if (s.mine.tiles.some(t => t.t === 'x' && t.open)) { await page.click('[data-a="descend"]'); continue; }
    const can = await canList();
    if (!can.length) { await page.click('[data-a="leave"]'); await page.waitForTimeout(1200); await visit('mine', '#sheet [data-a="enter"]'); await page.click('#sheet [data-a="enter"][data-n="1"]'); await page.waitForFunction(() => window.MinerDiary.scene() === 'mine'); continue; }
    await tap(can[0]);
    if (await page.locator('#sheet [data-a="digForce"]').count()) { guarded = true; await page.click('#sheet [data-a="digForce"]'); }
  }
  ok(guarded, '마지막 기력에서는 쓰러지기 전에 한 번 물어봄');
  s = await st();
  ok(s.day === dayBefore + 1 && s.energy === 70 && s.screen === 'village', '쓰러지면 다음 날 집에서 기력 70');
  ok(await page.evaluate(() => window.MinerDiary.phaseIndex()) === 0, '쓰러진 다음 날도 아침에 시작');
  ok((await page.textContent('#sheet')).includes('쓰러짐'), '쓰러짐 안내');
  if (shot) await page.screenshot({ path: path.join(shot, 'faint.png') });

  // 12. 저장
  await page.reload(); await page.waitForFunction(() => window.MinerDiary && window.MinerDiary.ready, null, { timeout: 15000 }); await page.waitForTimeout(400);
  ok((await st()).day === s.day, '새로고침 후에도 날짜 유지');

  // 13. 대장간 팻말
  await page.evaluate(() => window.MinerDiary.speed(10));
  await visit('smithy', '#sheet h2:has-text("부서진 대장간")');
  ok((await page.textContent('#sheet')).includes('곡괭이 강화'), '부서진 대장간 팻말');

  // 14. 화면 밖으로 끌어도 계속 움직이고, 말풍선으로 돌아옴
  await page.click('#sheet [data-a="close"]');
  await page.waitForTimeout(1500);   // 카메라가 광부를 따라가다 멈출 때까지
  const f0 = await page.evaluate(() => [cam.fx, cam.fy]);
  await page.mouse.move(200, 300); await page.mouse.down(); await page.mouse.move(200, 650, { steps: 6 }); await page.mouse.move(200, 1100, { steps: 6 }); await page.mouse.up();
  const f1 = await page.evaluate(() => [cam.fx, cam.fy]);
  ok(Math.round(f0[1] - f1[1]) === 800, '화면 밖까지 끈 만큼 화면이 움직임');
  await page.waitForTimeout(100);
  ok(await page.evaluate(() => !!bubble), '광부가 화면 밖이면 내 위치 말풍선이 뜸');
  await page.keyboard.press('Space'); await page.waitForTimeout(1500);
  ok(await page.evaluate(() => follow && !bubble), '스페이스바로 광부에게 돌아옴');
  ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), '가로 스크롤 없음');
  await page.close();

  /* ===== 컴퓨터 크기: 누르는 위치가 맞는지 ===== */
  const desk = await open(1440, 900);
  const d = helpers(desk);
  await desk.evaluate(() => { const s = window.MinerDiary.state(); s.introSeen = true; window.MinerDiary.speed(10); });
  await d.visit('mine', '#sheet [data-a="enter"]');
  await desk.click('#sheet [data-a="enter"][data-n="1"]');
  await desk.waitForFunction(() => window.MinerDiary.scene() === 'mine', null, { timeout: 5000 });
  await desk.evaluate(() => { const s = window.MinerDiary.state(); s.mine.tiles = s.mine.tiles.map(() => ({ t: 'o', o: 'copper', open: false })); [3, 10, 17].forEach(i => { s.mine.tiles[i] = { t: 's', open: false }; }); });
  for (const i of [3, 10, 17]) await d.tap(i);
  s = await d.st();
  ok([3, 10, 17].every(i => s.mine.tiles[i].open) && s.mine.tiles.filter(t => t.open).length === 3 && s.energy === 94, '컴퓨터 화면에서도 누른 칸이 정확히 캐짐');
  if (shot) await desk.screenshot({ path: path.join(shot, 'desktop.png') });
  await desk.close();

  await browser.close();
  if (errors.length) { console.error('페이지 오류:\n' + errors.join('\n')); process.exit(1); }
  console.log('브라우저 테스트 통과 (페이지 오류 0건)');
})().catch(e => { console.error(e.message); process.exit(1); });
