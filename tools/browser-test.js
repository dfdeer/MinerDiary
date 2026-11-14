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
  const { st, tap, visit } = helpers(page);
  await page.evaluate(() => window.MinerDiary.speed(10));

  ok(await page.locator('#loading').isHidden() && await page.evaluate(() => document.fonts.check('16px Jua', '광부')), '둥근 글꼴을 읽은 뒤 로딩 화면이 사라짐');
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
  const cell = (x, y) => page.evaluate(([x, y]) => window.MinerDiary.cell(x, y), [x, y]);
  const deep = async () => (await st()).deep;
  // 기력이 캐기 비용과 걸음(8칸마다 1)만큼 줄었는지
  const spent = (a, b) => (a.energy - b.energy) - (Math.floor(b.deep.steps / 8) - Math.floor(a.deep.steps / 8));
  // 4. 광산(땅속) 입장
  await visit('mine', '#sheet [data-a="enter"]');
  await page.click('#sheet [data-a="enter"]');
  await page.waitForFunction(() => window.MinerDiary.scene() === 'mine', null, { timeout: 5000 });
  await page.waitForTimeout(300);
  ok((await st()).screen === 'mine', '광산 입장 (깊이 1, 입구)');
  ok((await quest()).includes('광석 캐기'), '광산에 들어가면 퀘스트 「광석 캐기」');
  ok((await cell(0, 0)).t === 'u' && (await cell(0, 0)).seen && !(await cell(30, 30)).seen, '등불이 닿는 곳만 보임');
  ok(Object.keys((await deep()).seen).length >= 1, '본 곳이 저장됨');
  ok(await page.evaluate(() => { const d = cv.getContext('2d').getImageData(Math.round(W * .5 * DPR), Math.round(H * .2 * DPR), 1, 1).data; return d[0] + d[1] + d[2] === 0; }), '등불 밖은 완전히 검음 (밝기를 올려도 안 보임)');

  // 5. 끝없는 굴: 처음 구멍까지 걸어가서 깊이 2로, 깊이 2에서 다음 구멍으로 깊이 3
  for (let k = 0; k < 20 && (await deep()).L === 1; k++) { const h = await page.evaluate(() => window.MinerDiary.nearestHole()); await tap(h[0], h[1]); }
  let s = await st();
  ok(s.deep.L === 2 && s.deepest === 2, '구멍을 찾아 걸어가면 깊이 2로 내려감');
  ok((await page.evaluate(() => window.MinerDiary.ups())).length === 1 && (await cell(s.deep.x, s.deep.y - 1)).t === 'u', '내려온 자리에 위로 가는 사다리');
  if (shot) await page.screenshot({ path: path.join(shot, 'mine.png') });
  await page.evaluate(() => { const h = hero; window.MinerDiary.setCell(Math.round(h.x) + 1, Math.round(h.y), 'd'); });
  await page.evaluate(() => mineTapCell(Math.round(hero.x) + 1, Math.round(hero.y)));
  await page.waitForFunction(() => window.MinerDiary.state().deep.L === 3, null, { timeout: 15000 });
  s = await st();
  ok(s.deep.L === 3 && s.deepest === 3, '깊이 3 도달');

  // 6. 광석 캐기: 벽에 박힌 광석을 누르면 걸어가서 캐고 가방에 담김 (기력 2, 걸음 기력 따로)
  for (let k = 0; k < 5; k++) {
    const r = await page.evaluate(() => window.MinerDiary.nearRock());
    await page.evaluate(([x, y]) => window.MinerDiary.setCell(x, y, 'r', 'copper'), r);
    const a = await st();
    await tap(r[0], r[1]);
    const b = await st();
    ok((await cell(r[0], r[1])).t === 'f' && spent(a, b) === 2 && (b.carry.copper || 0) === (a.carry.copper || 0) + 1, `광석 바위를 캐면 가방에 구리 1개, 기력 2 (${k + 1})`);
    if (k === 0) ok((await page.evaluate(() => window.MinerDiary.efloats())).includes('-2'), '기력이 줄면 노란 숫자 -2가 떠오름');
  }
  // 6-1. 반짝임: 벽 너머 못 본 칸에 광석이 있을 때만
  ok(await page.evaluate(() => {
    const MD = window.MinerDiary, hx = Math.round(hero.x), hy = Math.round(hero.y);
    for (let y = hy - 6; y <= hy + 6; y++) for (let x = hx - 6; x <= hx + 6; x++) {
      const c0 = MD.cell(x, y); if (!c0.seen || c0.t !== 'r') continue;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const c1 = MD.cell(x + dx, y + dy); if (c1.seen || c1.t !== 'r') continue;
        const k = dKey(S.deep.L, x + dx, y + dy); S.deep.ore = S.deep.ore || {};
        S.deep.ore[k] = ''; const before = MD.glintDir(x, y).some(g => g[0] === dx && g[1] === dy);
        S.deep.ore[k] = 'iron'; const after = MD.glintDir(x, y).some(g => g[0] === dx && g[1] === dy && g[2] === 'iron');
        delete S.deep.ore[k]; return !before && after;
      }
    }
    return false;
  }), '못 본 벽 너머 광석이 있을 때만 반짝임');
  // 6-2. 가방이 가득이면 광석을 못 캠
  {
    const r = await page.evaluate(() => window.MinerDiary.nearRock());
    await page.evaluate(([x, y]) => { window.MinerDiary.setCell(x, y, 'r', 'iron'); S.carry.coal = 99; }, r);
    await tap(r[0], r[1]);
    ok((await cell(r[0], r[1])).t === 'r', '가방이 가득이면 광석을 캐지 않음');
    await page.evaluate(() => { delete S.carry.coal; renderDock(); });
  }

  // 7. 시간대
  s = await st();
  const used = (s.dayStart - s.minE) / s.max * 100;
  ok(await page.evaluate(() => window.MinerDiary.phaseIndex()) === (used >= 90 ? 3 : used >= 60 ? 2 : used >= 30 ? 1 : 0), `시간대가 쓴 기력 ${used}%와 맞음`);

  // 8. 나가기: 위로 가는 사다리까지 걸어가 올라가고, 깊이 1의 입구까지 이어서 마을로
  const dug0 = Object.keys((await deep()).dug).length;
  await page.click('[data-a="leave"]');
  ok(await page.evaluate(() => window.MinerDiary.hero().moving), '나가기를 누르면 사다리까지 걸어감');
  await page.waitForFunction(() => window.MinerDiary.scene() === 'village', null, { timeout: 30000 });
  await page.waitForTimeout(1000);
  s = await st();
  ok(s.screen === 'village' && s.inv.copper === 5 && !Object.keys(s.carry).length, '깊이 3에서 걸어서 마을까지, 가방 것은 창고로');
  ok(Object.keys(s.deep.dug).length >= dug0, '판 곳은 사라지지 않음');

  // 9. 팔기
  const worth = await page.evaluate(() => ORE_ORDER.reduce((a, o) => a + (S.inv[o] || 0) * ORES[o].price, 0)), g0 = s.gold;
  ok(s.quest === 3 && g0 === 20, '광석 5개를 캐면 보상 🪙20과 함께 「상인에게 광석 팔기」로');
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
  ok(s.quest === 6 && (await quest()).includes('숲길 치우기'), '자고 나면 이미 간 깊이 3은 바로 끝나고 「숲길 치우기」');

  // 10-1. 숲길 치우기 (🪙100), 광맥 추 받기
  if (s.gold < 100) await page.evaluate(() => { window.MinerDiary.state().gold = 100; renderHud(); });
  await visit('forest', '#sheet [data-a="clearForest"]');
  const gF = (await st()).gold;
  await page.click('#sheet [data-a="clearForest"]');
  s = await st();
  ok(s.gold === gF - 100 && s.restored.includes('forest') && s.acc.have.dowse === 1 && s.acc.eq.includes('dowse'), '숲길을 치우면 🪙100이 들고 광맥 추를 받아 낌');
  ok(s.quest === 7 && (await quest()).includes('채집'), '다음 퀘스트 「숲에서 채집」');

  // 10-2. 숲 채집: 안개 속에서 주울 것을 찾아 밟으면 가방에
  await visit('forest', '#sheet [data-a="forest"]');
  await page.click('#sheet [data-a="forest"]');
  await page.waitForFunction(() => window.MinerDiary.scene() === 'forest', null, { timeout: 5000 });
  s = await st();
  ok(s.forest.seen.filter(Boolean).length < s.forest.t.length / 10 && Object.keys(s.forest.it).length > 20, '숲은 안개에 덮여 있고 주울 것이 흩어져 있음');
  if (shot) await page.screenshot({ path: path.join(shot, 'forest.png') });
  const eF = s.energy;
  for (let k = 0; k < 20 && (await st()).gatherN < 5; k++) {
    const it = await page.evaluate(() => { const f = S.forest; return Object.keys(f.it).filter(k2 => f.it[k2] !== 'chest').map(k2 => k2.split(',').map(Number)).sort((a, b) => Math.hypot(a[0] - hero.x, a[1] - hero.y) - Math.hypot(b[0] - hero.x, b[1] - hero.y))[0]; });
    const p = await page.evaluate(([x, y]) => window.MinerDiary.forestSpot(x, y), it);
    await page.mouse.click(p.x, p.y); await page.waitForTimeout(60);
    await page.waitForFunction(() => !window.MinerDiary.hero().moving, null, { timeout: 15000 });
  }
  s = await st();
  ok(s.gatherN >= 5 && s.quest === 8 && Object.keys(s.carry).length > 0, '숲에서 다섯 번 주우면 퀘스트 끝, 주운 것은 가방에');
  ok(s.energy === eF - Math.floor(s.forest.steps / 5), `숲에서는 5칸마다 기력 1 (걸음 ${s.forest.steps})`);
  await page.click('[data-a="leave"]'); await page.waitForFunction(() => window.MinerDiary.scene() === 'village', null, { timeout: 20000 });
  s = await st();
  ok(!Object.keys(s.carry).length && ['herb', 'mush', 'wood', 'fiber', 'leather', 'copper'].some(k => s.inv[k] > 0), '숲에서 마을 길까지 걸어가서 마을로, 주운 것은 창고로');

  // 10-3. 상인에게서 나침반과 귀환서 사기
  await page.evaluate(() => { S.gold = Math.max(S.gold, 300); renderHud(); });
  await visit('merchant', '#sheet [data-a="buy"]');
  const gB = (await st()).gold;
  await page.click('#sheet [data-a="buy"][data-n="3"]');
  await page.click('#sheet [data-a="buy"][data-n="0"]');
  s = await st();
  ok(s.acc.have.compass === 1 && s.items.recall === 1 && s.gold === gB - 230, '나침반 🪙150과 귀환서 🪙80을 삼');
  await page.click('#sheet [data-a="close"]');

  // 10-4. 대장간: 무너진 팻말, 🪙500으로 복구, 용광로에 광석 넣기
  await visit('smithy', '#sheet h2:has-text("부서진 대장간")');
  ok((await page.textContent('#sheet')).includes('곡괭이 강화'), '부서진 대장간 팻말');
  await page.evaluate(() => { const s = window.MinerDiary.state(); s.gold = 1000; s.inv.copper = 27; s.inv.coal = 10; questEvent(); renderHud(); });
  ok((await st()).quest === 9 && (await quest()).includes('대장간 고치기'), '돈이 모이면 퀘스트 「대장간 고치기」');
  await visit('smithy', '#sheet [data-a="restoreSmithy"]');
  await page.click('#sheet [data-a="restoreSmithy"]');
  s = await st();
  ok(s.restored.includes('smithy') && s.gold === 500 && (await page.textContent('#sheet h2')).includes('대장장이'), '🪙500으로 대장간을 고치면 대장장이가 옴');
  await page.click('#sheet [data-a="close"]');
  await visit('smithy', '#sheet [data-a="smelt"]');
  if (shot) await page.screenshot({ path: path.join(shot, 'smithy.png') });
  await page.click('#sheet [data-a="smelt"][data-o="copper"]');
  s = await st();
  ok(s.furnace && s.furnace.bar === 'copperBar' && s.furnace.n === 5 && s.inv.copper === 2 && s.inv.coal === 5, '용광로에 구리 광석 25개와 석탄 5개를 넣으면 주괴 5개가 내일 나옴');
  ok(s.quest === 11 && (await quest()).includes('구리 곡괭이'), '다음 퀘스트 「구리 곡괭이 만들기」');
  await page.click('#sheet [data-a="close"]');

  // 11. 쓰러짐
  await visit('mine', '#sheet [data-a="enter"]');
  await page.click('#sheet [data-a="enter"]');
  await page.waitForFunction(() => window.MinerDiary.scene() === 'mine', null, { timeout: 5000 });
  const dayBefore = (await st()).day;
  let guarded = false;
  for (let k = 0; k < 200; k++) {
    s = await st();
    if (s.day !== dayBefore) break;
    const r = await page.evaluate(() => window.MinerDiary.nearRock());
    if (!r) break;
    await page.evaluate(([x, y]) => window.MinerDiary.setCell(x, y, 'r', ''), r);
    await tap(r[0], r[1]);
    if (await page.locator('#sheet [data-a="digForce"]').count()) { guarded = true; await page.click('#sheet [data-a="digForce"]'); }
  }
  ok(guarded, '마지막 기력에서는 쓰러지기 전에 한 번 물어봄');
  s = await st();
  ok(s.day === dayBefore + 1 && s.energy === 70 && s.screen === 'village', '쓰러지면 다음 날 집에서 기력 70');
  ok(await page.evaluate(() => window.MinerDiary.phaseIndex()) === 0, '쓰러진 다음 날도 아침에 시작');
  ok((await page.textContent('#sheet')).includes('쓰러짐'), '쓰러짐 안내');
  ok(s.inv.copperBar === 5 && !s.furnace && (await page.textContent('#sheet')).includes('구리 주괴'), '자고 일어나면(쓰러져도) 용광로에서 구리 주괴 5개');
  if (shot) await page.screenshot({ path: path.join(shot, 'faint.png') });

  // 12. 저장
  await page.reload(); await page.waitForFunction(() => window.MinerDiary && window.MinerDiary.ready, null, { timeout: 15000 }); await page.waitForTimeout(400);
  ok((await st()).day === s.day, '새로고침 후에도 날짜 유지');

  // 13. 곡괭이 강화: 망치질 세 번, 품질
  await page.evaluate(() => window.MinerDiary.speed(10));
  const forge = async () => {
    await visit('smithy', '#sheet [data-a="forge"]');
    await page.click('#sheet [data-a="forge"]');
    ok(await page.locator('#sheet [data-a="close"]').count() === 0, '망치질 중에는 창을 닫을 수 없음');
    for (let k = 0; k < 3; k++) {
      // 바늘이 가운데에 올 때 단추를 누름 (페이지 안에서 바로 눌러 지연을 없앰)
      await page.evaluate(() => new Promise(r => { const f = () => { const n = window.MinerDiary.needle(); if (n !== null && Math.abs(n - .5) < .03) { document.querySelector('#sheet [data-a="strike"]').click(); r(); } else requestAnimationFrame(f); }; f(); }));
    }
    await page.waitForSelector('#sheet h2:has-text("대장장이")', { timeout: 3000 });
    await page.click('#sheet [data-a="close"]');
  };
  const gP = (await st()).gold;
  await forge();
  s = await st();
  ok(s.pick === 1 && s.inv.copperBar === 0 && s.gold === gP - 200 + 50, '구리 주괴 5개와 🪙200으로 구리 곡괭이 (퀘스트 보상 🪙50)');
  ok(s.pickQ >= 1, `가운데를 맞춰 두드리면 품질이 오름 (${['보통', '좋음', '최상'][s.pickQ]})`);
  ok(await page.evaluate(() => window.MinerDiary.maxFloor()) === 7 && (await quest()).includes('깊이 7'), '구리 곡괭이로 깊이 7까지, 다음 퀘스트 「깊이 7 도달」');
  await page.evaluate(() => { const s = window.MinerDiary.state(); s.inv.ironBar = 5; s.gold += 600; renderHud(); });
  await forge();
  s = await st();
  ok(s.pick === 2 && s.inv.ironBar === 0 && await page.evaluate(() => window.MinerDiary.maxFloor()) === 10, '철 곡괭이로 단단한 바위와 깊이 10까지');
  await visit('smithy', '#sheet [data-a="close"]');

  // 13-1. 장신구: 만들기, 합치기, 끼기
  await page.evaluate(() => { S.inv.fiber = 6; S.inv.wood = 4; S.acc.have.plumb = 1; S.gold += 200; renderHud(); });
  await visit('smithy', '#sheet [data-a="craft"][data-o="tent"]');
  await page.click('#sheet [data-a="craft"][data-o="tent"]');
  ok((await st()).items.tent === 1, '대장간에서 풀실과 나뭇가지로 야영 천막을 만듦');
  await page.click('#sheet [data-a="combine"][data-n="0"]');
  s = await st();
  ok(s.acc.have.guide === 1 && !s.acc.have.compass && !s.acc.have.plumb, '나침반과 깊이 추를 합치면 길잡이 나침반');
  await page.click('#sheet [data-a="close"]');
  await page.evaluate(() => showBag());
  if ((await st()).acc.eq.length >= (await st()).acc.slots) await page.click('#sheet [data-a="unequip"]');
  await page.click('#sheet [data-a="equip"][data-o="guide"]');
  ok(await page.evaluate(() => window.MinerDiary.accEff('home') === 1 && window.MinerDiary.accEff('hole') === 1), '길잡이 나침반을 끼면 입구와 구멍 화살표가 켜짐');
  await page.click('#sheet [data-a="close"]');

  // 13-2. 단단한 바위와 야영지: 천막을 치고 자면 다음 날 그 자리에서 이어 감, 귀환서로 마을
  await page.evaluate(() => enterMine()); await page.waitForFunction(() => window.MinerDiary.scene() === 'mine', null, { timeout: 5000 });
  const hr = await page.evaluate(() => window.MinerDiary.nearRock());
  await page.evaluate(([x, y]) => window.MinerDiary.setCell(x, y, 'h', ''), hr);
  const hA = await st();
  await tap(hr[0], hr[1]);
  const hB = await st();
  ok((await cell(hr[0], hr[1])).t === 'f' && spent(hA, hB) === 3, '철 곡괭이로 단단한 바위를 기력 3으로 깸');
  await page.evaluate(() => { S.carry.copper = 3; showBag(); });
  await page.click('#sheet [data-a="use"][data-o="tent"]');
  s = await st();
  const camp = s.deep.lastCamp;
  ok(camp && (await cell(camp[1], camp[2])).t === 'c' && s.items.tent === 0, '천막을 치면 그 자리가 야영지');
  await page.evaluate(() => showCamp());
  const dayC = (await st()).day;
  await page.click('#sheet [data-a="campSleep"]');
  s = await st();
  ok(s.day === dayC + 1 && s.screen === 'mine' && s.deep.x === camp[1] && s.deep.y === camp[2] && s.carry.copper === 3, '야영지에서 자면 다음 날 그 자리에서 시작, 가방도 그대로');
  await page.click('#sheet [data-a="close"]');
  await page.evaluate(() => showBag());
  await page.click('#sheet [data-a="use"][data-o="recall"]');
  s = await st();
  ok(s.screen === 'village' && s.items.recall === 0 && s.inv.copper >= 3, '귀환서를 쓰면 바로 마을, 가방 것은 창고로');
  await page.waitForTimeout(800);
  await visit('smithy', '#sheet [data-a="close"]');

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
  await desk.click('#sheet [data-a="enter"]');
  await desk.waitForFunction(() => window.MinerDiary.scene() === 'mine', null, { timeout: 5000 });
  const dug = [];
  for (let k = 0; k < 3; k++) {
    const r = await desk.evaluate(() => window.MinerDiary.nearRock());
    await desk.evaluate(([x, y]) => window.MinerDiary.setCell(x, y, 'r', ''), r);
    const a = await d.st(); await d.tap(r[0], r[1]); const b = await d.st();
    dug.push((await desk.evaluate(([x, y]) => window.MinerDiary.cell(x, y).t, r)) === 'f' && (a.energy - b.energy) - (Math.floor(b.deep.steps / 8) - Math.floor(a.deep.steps / 8)) === 2);
  }
  ok(dug.every(Boolean), '컴퓨터 화면에서도 누른 칸이 정확히 캐짐');
  if (shot) await desk.screenshot({ path: path.join(shot, 'desktop.png') });
  await desk.close();

  await browser.close();
  if (errors.length) { console.error('페이지 오류:\n' + errors.join('\n')); process.exit(1); }
  console.log('브라우저 테스트 통과 (페이지 오류 0건)');
})().catch(e => { console.error(e.message); process.exit(1); });
