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
    // 광산 칸을 화면 가운데로 옮겨 누르고, 광부가 멈출 때까지 기다림
    tap: async (x, y) => { const p = await page.evaluate(([x, y]) => window.MinerDiary.cellSpot(x, y), [x, y]); await page.mouse.click(p.x, p.y); await page.waitForTimeout(60); await page.waitForFunction(() => !window.MinerDiary.hero().moving, null, { timeout: 15000 }); await page.waitForTimeout(40); },
    // 건물이나 사람을 화면 가운데로 옮겨 누르고, 광부가 걸어가서 아래 판이 바뀔 때까지 기다림
    visit: async (id, sel) => { if (await page.locator('#sheet [data-a="close"]').isVisible()) await page.click('#sheet [data-a="close"]'); const p = await page.evaluate(id => window.MinerDiary.spotPoint(id), id); await page.mouse.click(p.x, p.y); await page.waitForSelector(sel, { timeout: 15000 }); },
    // 광부에게서 가까운, 본 적 있는 캘 수 있는 바위 (광석 있는 것 먼저 고를 수 있음)
    nearRock: oreFirst => page.evaluate(of => { const m = window.MinerDiary.state().mine, h = window.MinerDiary.hero(); let best = null, bd = 1e9; for (let i = 0; i < m.t.length; i++) { if (!m.seen[i] || (m.t[i] !== 'r' && m.t[i] !== 'b')) continue; const x = i % m.w, y = Math.floor(i / m.w); if (![[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => { const j = (y + dy) * m.w + x + dx; return m.seen[j] && 'fud'.includes(m.t[j]) && !m.hid[j]; })) continue; const d = Math.abs(x - h.x) + Math.abs(y - h.y) - (of && m.o[i] ? 100 : 0); if (d < bd) { bd = d; best = [x, y]; } } return best; }, oreFirst),
  });

  /* ===== 폰 크기 ===== */
  const page = await open(390, 844);
  const { st, tap, visit, nearRock } = helpers(page);
  await page.evaluate(() => window.MinerDiary.speed(10));

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

  let s0;
  // 4. 광산 입장
  await visit('mine', '#sheet [data-a="enter"]');
  await page.click('#sheet [data-a="enter"][data-n="1"]');
  await page.waitForFunction(() => window.MinerDiary.scene() === 'mine', null, { timeout: 5000 });
  await page.waitForTimeout(300);
  ok((await st()).screen === 'mine', '광산 1층 입장');
  ok((await quest()).includes('광석 캐기'), '광산에 들어가면 퀘스트 「광석 캐기」');
  s0 = await st();
  ok(s0.mine.hid.every((h, i) => !h || !s0.mine.seen[i]), '숨은 방은 처음엔 안 보임');
  ok(s0.mine.seen.filter(Boolean).length < s0.mine.t.length / 3, '등불이 닿는 곳만 보임');
  const e0 = s0.energy, edge = s0.mine.t.findIndex((t, i) => t === 'e' && s0.mine.seen[i]);
  await tap(edge % s0.mine.w, Math.floor(edge / s0.mine.w));
  ok((await st()).energy === e0, '끝 벽은 못 캐고 기력 그대로');

  // 5. 계단으로 5층까지. 1층은 본 계단을 아래 막대 단추로, 2~4층은 못 본 계단 쪽을 눌러 걸어가서 (막히면 길을 다시 짬)
  ok(!(await page.isEnabled('[data-a="descend"]')) || (await st()).mine.seen[(await st()).mine.t.indexOf('d')], '계단을 보기 전엔 아래층 단추가 꺼져 있음');
  await page.evaluate(() => { const m = window.MinerDiary.state().mine; m.seen[m.t.indexOf('d')] = 1; renderDock(); });
  if (shot) await page.screenshot({ path: path.join(shot, 'mine.png') });
  ok(await page.isEnabled('[data-a="descend"]'), '계단을 보면 아래층 단추가 켜짐');
  await page.click('[data-a="descend"]');
  await page.waitForFunction(() => window.MinerDiary.state().mine.floor === 2, null, { timeout: 15000 });
  ok(true, '단추를 누르면 계단까지 걸어가서 2층으로');
  for (let f = 2; f < 5; f++) {
    for (let k = 0; k < 30 && (await st()).mine.floor === f; k++) { const m = (await st()).mine, si = m.t.indexOf('d'); await tap(si % m.w, Math.floor(si / m.w)); }
    ok((await st()).mine.floor === f + 1, `${f}층 못 본 계단을 눌러 걸어가서 ${f + 1}층으로`);
  }
  let s = await st();
  ok(s.deepest === 5, '가장 깊은 층 5층 기록');
  ok(!s.mine.t.includes('d'), '5층엔 계단 없음');

  // 6. 숨은 방: 돌무더기를 치우면 열림 (기력 1)
  await page.evaluate(() => { for (let k = 0; k < 30; k++) { window.MinerDiary.newFloor(2); if (window.MinerDiary.state().mine.t.includes('b')) break; } });
  s = await st();
  const rb = s.mine.t.indexOf('b');
  ok(rb >= 0, '숨은 방을 막은 돌무더기가 있음');
  await page.evaluate(i => { window.MinerDiary.state().mine.seen[i] = 1; }, rb);
  const eR = s.energy, hid0 = s.mine.hid.filter(Boolean).length;
  await tap(rb % s.mine.w, Math.floor(rb / s.mine.w));
  s = await st();
  ok(s.mine.t[rb] === 'f' && s.energy === eR - 1, '돌무더기를 치우면 기력 1');
  ok(s.mine.hid.filter(Boolean).length === hid0 - 9, '돌무더기 뒤 숨은 방(3×3)이 열림');

  // 7. 광석 캐기: 벽에 박힌 광석을 누르면 걸어가서 캠 (기력 2, 광석 1)
  let cu = (await st()).inv.copper || 0;
  for (let k = 0; k < 5; k++) {
    const r = await nearRock(false);
    await page.evaluate(([x, y]) => { const m = window.MinerDiary.state().mine; m.o[y * m.w + x] = 'copper'; m.t[y * m.w + x] = 'r'; }, r);
    const eK = (await st()).energy;
    await tap(r[0], r[1]);
    s = await st();
    ok(s.mine.t[r[1] * s.mine.w + r[0]] === 'f' && s.energy === eK - 2 && s.inv.copper === cu + 1, `광석 바위를 캐면 구리 1개, 기력 2 (${k + 1})`);
    cu++;
  }
  // 7-1. 반짝임: 벽 너머 못 본 칸에 광석이 있으면 그 벽이 반짝임
  ok(await page.evaluate(() => {
    const MD = window.MinerDiary, m = MD.state().mine;
    for (let i = 0; i < m.t.length; i++) {
      if (!m.seen[i] || m.t[i] !== 'r') continue;
      const x = i % m.w, y = Math.floor(i / m.w);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const j = (y + dy) * m.w + x + dx; if (x + dx > 0 && y + dy > 0 && x + dx < m.w - 1 && y + dy < m.h - 1 && !m.seen[j] && m.t[j] === 'r') { const o0 = m.o[j]; m.o[j] = ''; const before = MD.glintDir(x, y).some(g => g[0] === dx && g[1] === dy); m.o[j] = 'iron'; const after = MD.glintDir(x, y).some(g => g[0] === dx && g[1] === dy && g[2] === 'iron'); m.o[j] = o0; return !before && after; } }
    }
    return false;
  }), '못 본 벽 너머 광석이 있을 때만 반짝임');

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
    const r = await nearRock(false);
    if (!r) break;
    await tap(r[0], r[1]);
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
  const dug = [];
  for (let k = 0; k < 3; k++) { const r = await d.nearRock(false); await desk.evaluate(([x, y]) => { const m = window.MinerDiary.state().mine; m.t[y * m.w + x] = 'r'; m.o[y * m.w + x] = ''; }, r); const fBefore = (await d.st()).mine.t.filter(t => t === 'f').length; await d.tap(r[0], r[1]); const s2 = await d.st(); dug.push(s2.mine.t[r[1] * s2.mine.w + r[0]] === 'f' && s2.mine.t.filter(t => t === 'f').length === fBefore + 1); }
  s = await d.st();
  ok(dug.every(Boolean) && s.energy === 94, '컴퓨터 화면에서도 누른 칸이 정확히 캐짐');
  if (shot) await desk.screenshot({ path: path.join(shot, 'desktop.png') });
  await desk.close();

  await browser.close();
  if (errors.length) { console.error('페이지 오류:\n' + errors.join('\n')); process.exit(1); }
  console.log('브라우저 테스트 통과 (페이지 오류 0건)');
})().catch(e => { console.error(e.message); process.exit(1); });
