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
  const hudE = async () => +(await page.textContent('.energy b')).replace(/[^0-9]/g, '');
  ok(await page.evaluate(() => { const d = cv.getContext('2d').getImageData(Math.round(W * .5 * DPR), Math.round(H * .2 * DPR), 1, 1).data; return d[0] + d[1] + d[2] === 0; }), '등불 밖은 완전히 검음 (밝기를 올려도 안 보임)');

  // 5. 끝없는 굴: 처음 구멍까지 걸어가서 깊이 2로, 깊이 2에서 다음 구멍으로 깊이 3
  ok(await page.evaluate(() => { const L0 = hero.x; mineTapCell(20, 20); return hero.path.length === 0; }), '어둠 쪽(못 본 칸)은 눌러도 반응 없음');
  // 처음 구멍(11, 6)까지: 등불 안의 본 바닥 중 구멍에 가장 가까운 곳을 눌러 가다가, 구멍이 보이면 구멍을 누름
  for (let k = 0; k < 20 && (await deep()).L === 1; k++) {
    const t = await page.evaluate(() => { const h = [11, 6]; if (seenGet(h[0], h[1]) && Math.hypot(h[0] - hero.x, h[1] - hero.y) <= lightR()) return h; let best = null, bd = 1e9; const hx = Math.round(hero.x), hy = Math.round(hero.y); for (let y = hy - 5; y <= hy + 5; y++) for (let x = hx - 5; x <= hx + 5; x++) { if (!seenGet(x, y) || !FLOORISH(mT(x, y)) || Math.hypot(x - hero.x, y - hero.y) > lightR()) continue; const d = Math.hypot(x - h[0], y - h[1]); if (d < bd) { bd = d; best = [x, y]; } } return best; });
    await tap(t[0], t[1]);
  }
  let s = await st();
  ok(s.deep.L === 2 && s.deepest === 2, '구멍을 찾아 걸어가면 깊이 2로 내려감');
  ok(await hudE() === s.energy && s.energy < 100, `걸음으로 준 기력도 위쪽 막대 숫자에 바로 (${s.energy})`);
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
  ok(await page.evaluate(() => window.MinerDiary.hero().moving || window.MinerDiary.state().deep.L < 3 || S.exiting), '나가기를 누르면 사다리까지 걸어감 (바로 옆이면 바로 올라감)');
  await page.waitForFunction(() => window.MinerDiary.scene() === 'village', null, { timeout: 30000 });
  await page.waitForTimeout(1000);
  s = await st();
  ok(s.screen === 'village' && s.inv.copper === 5 && !Object.keys(s.carry).length, `깊이 3에서 걸어서 마을까지, 가방 것은 창고로 (${s.screen} ${JSON.stringify(s.inv)} ${JSON.stringify(s.carry)} ${s.day})`);
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
  const day = s.day, ph = await page.evaluate(() => window.MinerDiary.phaseIndex()), expE = ph === 3 ? 90 : ph <= 1 ? 110 : 100;
  await visit('house', '#sheet [data-a="sleep"]');
  await page.click('#sheet [data-a="sleep"]');
  s = await st();
  ok(s.day === day + 1 && s.energy === expE && s.minE === s.energy, `자고 나서 ${s.day}일차 기력 ${s.energy} (저녁 전에 자면 덤 110, 새벽이면 90)`);
  ok(s.quest === 6 && (await quest()).includes('숲길 치우기'), '자고 나면 이미 간 깊이 3은 바로 끝나고 「숲길 치우기」');

  // 10-1. 숲길 치우기 (🪙100), 광맥 추 받기
  if (s.gold < 100) await page.evaluate(() => { window.MinerDiary.state().gold = 100; renderHud(); });
  await visit('forest', '#sheet [data-a="restore"][data-o="forest"]');
  const gF = (await st()).gold;
  await page.click('#sheet [data-a="restore"][data-o="forest"]');
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
  const shopIx = id => page.evaluate(i => SHOP.findIndex(it => it.id === i), id);
  await page.evaluate(n => document.querySelector(`#sheet [data-a="buy"][data-n="${n}"]`).click(), await shopIx('compass'));
  await page.evaluate(n => document.querySelector(`#sheet [data-a="buy"][data-n="${n}"]`).click(), await shopIx('recall'));
  s = await st();
  ok(s.acc.have.compass === 1 && s.items.recall === 1 && s.gold === gB - 230, '나침반 🪙150과 귀환서 🪙80을 삼');
  await page.click('#sheet [data-a="close"]');

  // 10-4. 대장간: 무너진 팻말, 🪙500으로 복구, 용광로에 광석 넣기
  await visit('smithy', '#sheet h2:has-text("부서진 대장간")');
  ok((await page.textContent('#sheet')).includes('곡괭이 강화'), '부서진 대장간 팻말');
  await page.evaluate(() => { const s = window.MinerDiary.state(); s.gold = 1000; s.inv.copper = 27; s.inv.coal = 10; questEvent(); renderHud(); });
  ok((await st()).quest === 9 && (await quest()).includes('대장간 고치기'), '돈이 모이면 퀘스트 「대장간 고치기」');
  await visit('smithy', '#sheet [data-a="restore"][data-o="smithy"]');
  await page.click('#sheet [data-a="restore"][data-o="smithy"]');
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
    await page.evaluate(([x, y]) => { window.MinerDiary.setCell(x, y, 'r', ''); S.deep.steps = 0; }, r);   // 걸음 기력으로 쓰러지지 않게 (캐기에서 물어보는지만 봄)
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
  ok(await page.evaluate(() => window.MinerDiary.maxFloor()) === 7 && (await quest()).includes('시장'), '구리 곡괭이로 깊이 7까지, 다음 퀘스트 「시장 고치기」');

  // 13-0. 시장: 나무 10개와 🪙800으로 고치고, 시세대로 팔기 (많이 팔면 값이 떨어짐), 다음 날 시세는 예고대로
  await page.evaluate(() => { S.gold += 800; S.inv.wood = 10; S.inv.iron = 20; renderHud(); });
  await visit('market', '#sheet [data-a="restore"][data-o="market"]');
  await page.click('#sheet [data-a="restore"][data-o="market"]');
  s = await st();
  ok(s.restored.includes('market') && s.inv.wood === 0 && s.market && (await quest()).includes('시장에서 팔기'), '시장을 고치면 시세가 생기고 퀘스트 「시장에서 팔기」');
  await page.click('#sheet [data-a="close"]');
  const pr = await page.evaluate(() => [unitPrice('iron'), unitPrice('iron', 19), tradeValue('iron')]);
  ok(pr[1] < pr[0], `많이 팔수록 한 개 값이 떨어짐 (${pr[0]} → ${pr[1]})`);
  await visit('market', '#sheet [data-a="trade"][data-o="iron"]');
  if (shot) await page.screenshot({ path: path.join(shot, 'market.png') });
  const gM = (await st()).gold;
  await page.click('#sheet [data-a="trade"][data-o="iron"]');
  s = await st();
  ok(s.gold === gM + pr[2] + 50 && s.inv.iron === 0 && s.market.sold.iron === 20, `철 광석 20개를 시세로 팔아 🪙${pr[2]} (퀘스트 보상 🪙50)`);
  // 13-0b. 집 고치기: 최대 기력 +20
  await page.click('#sheet [data-a="close"]');
  await page.evaluate(() => { S.inv.wood = 15; S.inv.ironBar = 2; S.gold += 400; renderHud(); });
  await visit('house', '#sheet [data-a="home"]');
  const mx0 = (await st()).max;
  await page.click('#sheet [data-a="home"]');
  s = await st();
  ok(s.home === 1 && s.max === mx0 + 20 && (await page.textContent('#sheet h2')).includes('고친 집'), `집을 고치면 최대 기력 ${s.max}`);
  // 13-0c. 강가 다리 고치기, 낚싯대, 낚시 세 번 (찌가 잠길 때 당김)
  await page.click('#sheet [data-a="close"]');
  await page.evaluate(() => { S.inv.wood = 20; S.inv.ironBar = 2; S.gold += 300; renderHud(); });
  await visit('bridge', '#sheet [data-a="restore"][data-o="bridge"]');
  await page.click('#sheet [data-a="restore"][data-o="bridge"]');
  s = await st();
  ok(s.restored.includes('bridge') && s.rod && (await quest()).includes('물고기'), '다리를 고치면 낚싯대를 받고 퀘스트 「물고기 낚기」');
  await page.click('#sheet [data-a="close"]');
  ok(await page.evaluate(() => !blocked(16, riverY(16))), '고친 다리는 건널 수 있음');
  const wx = 13, wy = await page.evaluate(() => riverY(13));
  const wp = await page.evaluate(([x, y]) => window.MinerDiary.tileSpot(x, y), [wx, wy]);
  await page.mouse.click(wp.x, wp.y);
  await page.waitForSelector('#sheet [data-a="pull"]', { timeout: 15000 });
  if (shot) await page.screenshot({ path: path.join(shot, 'fishing.png') });
  const eFi = (await st()).energy;
  for (let k = 0; k < 3; k++) {
    if (k) await page.click('#sheet [data-a="cast"]');
    await page.waitForFunction(() => window.MinerDiary.fishState() === 'bite', null, { timeout: 8000, polling: 20 });
    await page.evaluate(() => document.querySelector('#sheet [data-a="pull"]').click());
  }
  s = await st();
  ok(s.fishN === 3 && Object.keys(s.inv).some(k => ['carp', 'trout', 'catfish', 'eel', 'moonkoi'].includes(k) && s.inv[k] > 0) && s.energy === eFi - 4, '강을 누르면 물가로 걸어가 낚시, 찌가 잠길 때 당기면 물고기 (던질 때 기력 2)');
  ok((await quest()).includes('밭'), '물고기 셋을 낚으면 다음 퀘스트 「밭 일구기」');
  await page.click('#sheet [data-a="close"]');

  // 13-0d. 밭: 고치고, 씨앗 사서 심고, 아침이나 점심에 물 주면 밤에 자람, 다 자라면 거둠
  await page.evaluate(() => { S.inv.wood = 8; S.gold += 400; renderHud(); });
  await visit('field', '#sheet [data-a="restore"][data-o="field"]');
  await page.click('#sheet [data-a="restore"][data-o="field"]');
  ok((await st()).restored.includes('field') && (await quest()).includes('거두기'), '밭을 고치면 퀘스트 「작물 거두기」');
  await page.click('#sheet [data-a="close"]');
  await visit('merchant', '#sheet [data-a="buy"][data-n="0"]');
  for (let k = 0; k < 3; k++) await page.evaluate(() => document.querySelector('#sheet [data-a="buy"][data-n="0"]').click());   // 상점 창이 길어 아래쪽 단추는 창 안에서 바로 누름
  ok((await st()).items.radishSeed === 3, '상인에게서 무 씨앗 셋을 삼');
  await page.click('#sheet [data-a="close"]');
  await page.evaluate(() => { S.dayStart = S.minE = S.energy; renderHud(); });   // 시간을 아침으로 (물 주기 시험)
  const plots = [[9, 28], [11, 28], [13, 28]];
  for (const [px, py] of plots) {
    const p = await page.evaluate(([x, y]) => window.MinerDiary.tileSpot(x, y), [px, py]);
    await page.mouse.click(p.x, p.y);
    await page.waitForSelector('#sheet [data-a="plant"]', { timeout: 15000 });
    await page.click('#sheet [data-a="plant"]');
    await page.waitForSelector('#sheet [data-a="water"]');
    await page.click('#sheet [data-a="water"]');
    await page.click('#sheet [data-a="close"]');
  }
  s = await st();
  ok(Object.keys(s.farm).length === 3 && Object.values(s.farm).every(p2 => p2.crop === 'radish' && p2.watered), '밭 칸을 눌러 무를 심고 물을 줌');
  if (shot) await page.screenshot({ path: path.join(shot, 'farm.png') });
  ok(await page.evaluate(() => { growFarm(); const a = Object.values(S.farm).every(p2 => p2.days === 1 && !p2.watered); growFarm(); const b = Object.values(S.farm).every(p2 => p2.days === 1); return a && b; }), '물 준 날 밤에만 하루 자람');
  await page.evaluate(() => { for (let d = 0; d < 2; d++) { Object.values(S.farm).forEach(p2 => { p2.watered = true; }); growFarm(); } });
  for (const [px, py] of plots) {
    const p = await page.evaluate(([x, y]) => window.MinerDiary.tileSpot(x, y), [px, py]);
    await page.mouse.click(p.x, p.y);
    await page.waitForSelector('#sheet [data-a="harvest"]', { timeout: 15000 });
    await page.click('#sheet [data-a="harvest"]');
  }
  s = await st();
  ok(s.harvestN === 3 && s.inv.radish >= 3 && !Object.keys(s.farm).length && (await quest()).includes('식당'), '다 자란 무를 셋 거두면 다음 퀘스트 「식당 고치기」');

  // 13-0e. 식당: 고치고, 재료 둘로 요리를 찾고, 먹으면 기력, 점심에 주민 의뢰
  await page.evaluate(() => { S.inv.wood = 15; S.inv.ironBar = 2; S.gold += 1000; S.inv.mush = 1; S.inv.herb = 1; renderHud(); });
  await visit('kitchen', '#sheet [data-a="restore"][data-o="kitchen"]');
  await page.click('#sheet [data-a="restore"][data-o="kitchen"]');
  ok((await st()).restored.includes('kitchen') && (await quest()).includes('요리'), '식당을 고치면 퀘스트 「요리 찾기」');
  await page.click('#sheet [data-a="close"]');
  await visit('kitchen', '#sheet [data-a="kpick"]');
  await page.click('#sheet [data-a="kpick"][data-o="mush"]');
  await page.click('#sheet [data-a="kpick"][data-o="herb"]');
  await page.click('#sheet [data-a="kcookSel"]');
  s = await st();
  ok(s.items.soup === 1 && s.recipes.length === 1 && !s.inv.mush && (await quest()).includes('의뢰'), '버섯과 약초로 버섯 수프를 찾음, 다음 퀘스트 「주민 의뢰 들어주기」');
  if (shot) await page.screenshot({ path: path.join(shot, 'kitchen.png') });
  await page.click('#sheet [data-a="close"]');
  await page.evaluate(() => { S.energy = 50; renderHud(); showBag(); });
  await page.click('#sheet [data-a="use"][data-o="soup"]');
  s = await st();
  ok(s.energy === 75 && !s.items.soup, '버섯 수프를 먹으면 기력 +25');
  await page.click('#sheet [data-a="close"]');
  await page.evaluate(() => { S.minE = S.dayStart - S.max * .35; const q = todayReq(); S.inv[q.item] = (S.inv[q.item] || 0) + q.n; renderHud(); });   // 시간을 점심으로, 의뢰 물건 준비
  await visit('kitchen', '#sheet [data-a="kreq"]');
  const gR = (await st()).gold, rq = (await st()).req;
  await page.click('#sheet [data-a="kreq"]');
  s = await st();
  ok(s.req.done && s.gold === gR + rq.gold + 100 && (await quest()).includes('깊이 7'), `점심에 의뢰(${rq.item} ${rq.n}개)를 들어주면 🪙${rq.gold} (퀘스트 보상 🪙100)`);
  await page.click('#sheet [data-a="close"]');
  await visit('market', '#sheet [data-a="close"]');
  ok(await page.evaluate(() => { const next = { ...S.market.next }; rollMarket(false); return Object.keys(next).every(o => Math.abs(S.market.mult[o] - next[o]) < 1e-9) && S.market.sold.iron === 10; }), '다음 날 시세는 전날 예고대로, 판 만큼 떨어진 값은 절반 회복');
  await page.click('#sheet [data-a="close"]');
  await page.evaluate(() => { const s = window.MinerDiary.state(); s.inv.ironBar = 5; s.gold += 600; renderHud(); });
  await forge();
  s = await st();
  ok(s.pick === 2 && s.inv.ironBar === 0 && await page.evaluate(() => window.MinerDiary.maxFloor()) === 10, '철 곡괭이로 단단한 바위와 깊이 10까지');

  // 13-0f. 세공소: (깊이 7을 갔다 치고) 고치고, 원석을 막대 놀이로 깎아 보석
  await page.evaluate(() => { S.deepest = 7; questEvent(); S.inv.silverBar = 3; S.inv.crystal = 3; S.gold += 1600; renderHud(); });
  ok((await quest()).includes('세공소'), '깊이 7과 철 곡괭이 다음 퀘스트 「세공소 고치기」');
  await visit('jewel', '#sheet [data-a="restore"][data-o="jewel"]');
  await page.click('#sheet [data-a="restore"][data-o="jewel"]');
  ok((await st()).restored.includes('jewel') && (await quest()).includes('보석'), '세공소를 고치면 퀘스트 「보석 깎기」');
  await page.click('#sheet [data-a="close"]');
  await visit('jewel', '#sheet [data-a="cut"][data-o="crystal"]');
  await page.click('#sheet [data-a="cut"][data-o="crystal"]');
  for (let k = 0; k < 3; k++) await page.evaluate(() => new Promise(r => { const f = () => { const n = window.MinerDiary.needle(); if (n !== null && Math.abs(n - .5) < .03) { document.querySelector('#sheet [data-a="strike"]').click(); r(); } else requestAnimationFrame(f); }; f(); }));
  await page.waitForSelector('#sheet h2:has-text("세공사")', { timeout: 3000 });
  s = await st();
  ok(s.inv.crystalGem >= 1 && s.inv.crystal === 0 && s.cutN === 1 && (await quest()).includes('깊이 10'), `수정 원석을 깎아 수정 보석 ${s.inv.crystalGem}개, 다음 퀘스트 「깊이 10 도달」`);
  await page.click('#sheet [data-a="close"]');

  // 13-0g. 성벽 문과 사냥: (깊이 10을 갔다 치고) 문을 고치고, 검을 만들고, 성 밖에서 몬스터 셋을 잡음
  await page.evaluate(() => { S.deepest = 10; questEvent(); S.inv.ironBar = 5; S.inv.wood = 20; S.inv.copperBar = 3; S.gold += 2200; renderHud(); });
  ok((await quest()).includes('성벽 문'), '깊이 10 다음 퀘스트 「성벽 문 고치기」');
  await visit('gate', '#sheet [data-a="restore"][data-o="gate"]');
  await page.click('#sheet [data-a="restore"][data-o="gate"]');
  ok((await st()).restored.includes('gate') && (await quest()).includes('사냥'), '성벽 문을 고치면 퀘스트 「성 밖에서 사냥」');
  await page.click('#sheet [data-a="close"]');
  await visit('smithy', '#sheet [data-a="sword"]');
  await page.click('#sheet [data-a="sword"]');
  ok((await st()).sword === 1 && !(await st()).inv.copperBar, '대장간에서 구리 주괴로 구리 검');
  await page.click('#sheet [data-a="close"]');
  await visit('gate', '#sheet [data-a="hunt"]');
  ok(await page.locator('#sheet [data-a="hunt"]').isDisabled() === (await page.evaluate(() => phaseIndex())) < 1, '성벽 문은 점심부터 열림');
  await page.click('#sheet [data-a="close"]');
  await page.evaluate(() => { S.minE = S.dayStart - S.max * .35; renderHud(); });
  await visit('gate', '#sheet [data-a="hunt"]:not([disabled])');
  await page.click('#sheet [data-a="hunt"]');
  ok(await page.evaluate(() => window.MinerDiary.scene()) === 'hunt' && (await page.evaluate(() => window.MinerDiary.mons())).length >= 3, '성벽 문으로 나가면 몬스터가 있는 성 밖');
  if (shot) await page.screenshot({ path: path.join(shot, 'hunt.png') });
  await page.evaluate(() => { S.energy = S.max; S.minE = S.dayStart = S.max; renderHud(); });
  const e0 = (await st()).energy;
  for (let k = 0; k < 3; k++) {
    const m = await page.evaluate(() => { const h = window.MinerDiary.hero(), m = window.MinerDiary.mons().find(o => o.hp > 0); window.MinerDiary.setMon(m.id, Math.round(h.x) + 2, Math.round(h.y) - 1); return window.MinerDiary.mons().find(o => o.id === m.id); });
    const p = await page.evaluate(([x, y]) => window.MinerDiary.huntSpot(x, y), [m.x, m.y]);
    await page.mouse.click(p.x, p.y);
    await page.waitForFunction(id => window.MinerDiary.mons().find(o => o.id === id).hp <= 0, m.id, { timeout: 15000 });
  }
  s = await st();
  ok(s.killN === 3 && (s.carry.meat || 0) + (s.carry.bone || 0) >= 1 && s.energy < e0 && (await quest()).includes('깊이 10') === false, `몬스터를 누르면 다가가 휘둘러 셋을 잡고 고기를 얻고 기력이 듦 (${e0}→${s.energy})`);
  await page.click('#minebar [data-a="leave"]');
  await page.waitForFunction(() => window.MinerDiary.scene() === 'village', null, { timeout: 15000 });
  s = await st();
  ok(s.inv.meat >= 1 && !Object.keys(s.carry).length, '나가기 단추로 마을에 돌아오면 잡은 것이 창고로');

  // 13-0h. 야시장: 아침엔 닫혀 있고, 저녁에 시장에서 수상한 상인의 의뢰를 들어줌
  ok((await quest()).includes('야시장'), '사냥 다음 퀘스트 「저녁 야시장 거래」');
  await page.evaluate(() => { S.minE = S.dayStart - S.max * .1; renderHud(); });
  await visit('market', '#sheet [data-a="close"]');
  ok(await page.locator('#sheet [data-a="nsell"]').count() === 0 && (await page.textContent('#sheet')).includes('저녁부터'), '야시장은 아침엔 닫혀 있음');
  await page.click('#sheet [data-a="close"]');
  await page.evaluate(() => { S.minE = S.dayStart - S.max * .65; const b = nightToday().buy[0]; S.inv[b.item] = (S.inv[b.item] || 0) + b.n; renderHud(); });
  await visit('market', '#sheet [data-a="nsell"]');
  const gN = (await st()).gold, nb = (await st()).night.buy[0];
  await page.click('#sheet [data-a="nsell"][data-n="0"]');
  s = await st();
  ok(s.night.buy[0].done && s.gold === gN + nb.gold + 100 && await page.locator('#sheet [data-a="nsell"][data-n="0"]').isDisabled(), `저녁 야시장에서 ${nb.item} ${nb.n}개를 🪙${nb.gold}에 팔고, 같은 의뢰는 하루 한 번`);
  await page.click('#sheet [data-a="close"]');

  // 13-0i. 박물관: 고치고 종류마다 하나씩 기증, 10종이면 보상
  await page.evaluate(() => { S.inv.silverBar = 3; S.inv.goldBar = 2; S.inv.wood = 30; S.gold += 3000; ['copper', 'coal', 'iron', 'silver', 'gold', 'crystal', 'herb', 'mush', 'fiber', 'carp', 'radish'].forEach(o => { S.inv[o] = (S.inv[o] || 0) + 1; }); renderHud(); });
  ok((await quest()).includes('박물관'), '야시장 다음 퀘스트 「박물관 고치기」');
  await visit('museum', '#sheet [data-a="restore"][data-o="museum"]');
  await page.click('#sheet [data-a="restore"][data-o="museum"]');
  ok((await st()).restored.includes('museum') && (await quest()).includes('기증'), '박물관을 고치면 퀘스트 「박물관에 기증」');
  await page.click('#sheet [data-a="close"]');
  await visit('museum', '#sheet [data-a="donate"]');
  const gMu = (await st()).gold, coal0 = (await st()).inv.coal;
  for (let k = 0; k < 10; k++) await page.click('#sheet [data-a="donate"] >> nth=0');
  s = await st();
  ok(s.museum.length === 10 && s.gold === gMu + 500 + 300 && s.inv.coal === coal0 - 1 && !s.museum.some((o, i) => s.museum.indexOf(o) !== i), '10종을 하나씩 기증하면 🪙500 (퀘스트 보상 🪙300), 같은 것은 한 번만');
  await page.click('#sheet [data-a="close"]');
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
