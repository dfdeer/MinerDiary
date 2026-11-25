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
    await page.evaluate(() => { window.MinerDiary.quietEvents(); window.MinerDiary.autoConfirm(true); });   // 저절로 생기는 이벤트와 확정 창은 따로 시험
    await page.waitForTimeout(500);
    return page;
  }
  // 아래 막대의 마을 단추: 집으로 바로 가기 (창에서 기력 단추, 이동 장면 건너뛰기)
  const goHome = async page => { await page.click('#minebar [data-a="homeFastAsk"]'); await page.click('#sheet [data-a="homeFast"]'); await page.click('#skip'); await page.waitForFunction(() => window.MinerDiary.scene() === 'village', null, { timeout: 20000 }); };
  const P = (s, k) => ((s.inv || {})[k] || 0) + ((s.carry || {})[k] || 0);   // 가방과 창고를 합친 수 (마을 안에선 둘 다 씀)
  // 건물 안 그림 장면 (기획 80번): 그림이 실제로 그려졌고, 누를 곳끼리 겹치지 않고, 이름표가 보임
  const roomOk = page => page.evaluate(() => {
    const cv = document.querySelector('#sheet canvas[data-room]'); if (!cv) return 'no room';
    const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data; let lit = 0; for (let i = 3; i < d.length; i += 400) if (d[i] > 0) lit++;
    if (lit < d.length / 400 * .9) return 'blank';
    const hs = [...document.querySelectorAll('#sheet .room .hot')].map(b => b.getBoundingClientRect()), lb = [...document.querySelectorAll('#sheet .room .hl')].map(b => b.getBoundingClientRect());
    for (let i = 0; i < hs.length; i++) for (let j = i + 1; j < hs.length; j++) { const a = hs[i], b = hs[j]; if (a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1) return 'overlap ' + i + ' ' + j; }
    for (let i = 0; i < lb.length; i++) for (let j = i + 1; j < lb.length; j++) { const a = lb[i], b = lb[j]; if (a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom) return 'label overlap ' + i + ' ' + j; }
    return hs.length ? 'ok' : 'no hot';
  });
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
  // 걷는 길 (11/25 사용자 결정): 가장 짧은 길 가운데 위로 갈 땐 오른쪽 위(y-1), 아래로 갈 땐 왼쪽 아래(y+1)를 먼저. 걸음 수는 가장 짧은 그대로
  {
    const r = await page.evaluate(() => { const up = bfs(26, 15, (x, y) => x === 23 && y === 12), dn = bfs(26, 15, (x, y) => x === 29 && y === 18); return { up, dn }; });
    ok(r.up.length === 6 && r.up[0][0] === 26 && r.up[0][1] === 14 && r.up[2][1] === 12 && r.dn.length === 6 && r.dn[0][0] === 26 && r.dn[0][1] === 16 && r.dn[2][1] === 18, `위로 갈 땐 오른쪽 위, 아래로 갈 땐 왼쪽 아래를 먼저 걷고 걸음 수는 같음 (${JSON.stringify(r)})`);
  }
  // 대장간은 첫 화면에서 일(용광로, 곡괭이, 날 세우기, 장신구, 합치기, 도구)을 고름 (기획 75번)
  const smithy = async tab => { await visit('smithy', `#sheet [data-a="smTab"][data-o="${tab}"]`); await page.click(`#sheet [data-a="smTab"][data-o="${tab}"]`); };
  await page.evaluate(() => window.MinerDiary.speed(10));

  ok(await page.locator('#loading').isHidden() && await page.evaluate(() => document.fonts.check('16px Jua', '광부')), '둥근 글꼴을 읽은 뒤 로딩 화면이 사라짐');
  // 1. 퀘스트를 따라 촌장 만나기
  const quest = () => page.evaluate(() => document.querySelector('.quest').innerText.replace(/\s+/g, ' ').trim());
  ok(await page.locator('#sheet').isHidden() && (await quest()).includes('촌장 만나기'), '시작하면 첫 퀘스트 「촌장 만나기」가 보임');
  ok(await page.locator('.quest .ico').count() >= 2 && await page.locator('.qtap').isVisible() && await page.evaluate(() => document.querySelector('.quest').classList.contains('hint')), '퀘스트 막대엔 느낌표 표시와 화살표, 처음엔 손가락이 톡톡 (글 설명 없음)');
  await page.evaluate(() => showCard(OBJ.find(o => o.id === 'forest')));
  ok(/촌장부터 만나 보기/.test(await page.textContent('#sheet')) && await page.locator('#sheet [data-a="forest"]').count() === 0 && await page.locator('#sheet [data-a="toChief"]').count() === 1, '촌장을 만나기 전에 숲을 누르면 촌장부터 만나 보라는 안내만 나오고 들어가기 단추는 없음');
  await page.evaluate(() => closeSheet());
  await page.click('[data-a="quest"]');
  ok(await page.locator('.qtap').count() === 0, '한 번 누르면 손가락은 사라짐');
  await page.waitForSelector('#sheet [data-a="intro"]', { timeout: 15000 });
  ok(true, '퀘스트를 누르면 촌장에게 걸어가서 소개가 열림');
  const line1 = await page.textContent('#sheet p');
  await page.click('#sheet [data-a="intro"]');
  ok(await page.textContent('#sheet p') !== line1, '다음을 누르면 대사가 넘어감');
  await page.click('#sheet [data-a="introPrev"]');
  ok(await page.textContent('#sheet p') === line1 && await page.locator('#sheet [data-a="introPrev"]').count() === 0, '이전을 누르면 앞 대사로 돌아가고, 첫 대사엔 이전 단추가 없음');
  while (await page.locator('#sheet [data-a="intro"]').count()) await page.click('#sheet [data-a="intro"]');
  await page.click('#sheet [data-a="introDone"]');
  ok(await page.evaluate(() => document.querySelector('.quest').classList.contains('fresh')), '새 퀘스트가 되면 퀘스트 막대가 반짝임');
  ok((await st()).introSeen && (await quest()).includes('숲 동굴'), '소개가 끝나면 다음 퀘스트 「숲 동굴 들어가기」');
  ok(!/누른 곳|끌어서|스페이스바|밝은 테두리/.test(await page.evaluate(() => document.body.innerText)), '조작 설명 문구 없음');
  if (shot) await page.screenshot({ path: path.join(shot, 'village.png') });
  // 소리: 설정에서 효과음과 배경음 크기를 따로 바꾸고, 배경음은 장소마다 다른 곡
  await page.click('[data-a="menu"]');
  await page.locator('#sheet input[data-vol="bgm"]').fill('20');
  await page.locator('#sheet input[data-vol="sfx"]').fill('60');
  await page.locator('#sheet input[data-vol="master"]').fill('50');
  ok(await page.evaluate(() => S.vol.master === .5 && Math.abs(vol('sfx') - .3) < 1e-9), '전체 음량 막대는 효과음과 배경음에 함께 곱해짐 (60 × 50% = 30)');
  await page.locator('#sheet input[data-vol="master"]').fill('100');
  let sv = await page.evaluate(() => [S.vol.bgm, S.vol.sfx, JSON.parse(localStorage.getItem('minerdiary.v1')).vol.bgm]);
  ok(sv[0] === .2 && sv[1] === .6 && sv[2] === .2, '설정에서 효과음과 배경음 크기를 따로 바꾸고 저장');
  await page.click('#sheet [data-a="close"]');
  await page.waitForFunction(() => window.MinerDiary.bgm() === 'day', null, { timeout: 5000 });
  ok(true, '마을 낮엔 낮 배경음');

  // 2. 상호작용하는 것끼리 화면에서 겹치지 않음 (누르는 모양 기준)
  const overlaps = await page.evaluate(() => {
    const OBJ = window.MinerDiary.objects();
    const TALL = { house: 3.4, smithy: 4, kitchen: 3.6, jewel: 3.6, market: 1.3, museum: 4, mine: 4.2, gate: 2.4, fgate: 2.4, npc: 2.2, wagon: 2.2 };
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

  // 3-1. 대화창이 열려 있을 때 바깥을 누르면 창만 닫히고, 그 누르기로 걷거나 화면이 끌리지 않음
  const h0 = await page.evaluate(() => [hero.x, hero.y, cam.fx]);
  await page.mouse.move(200, 250); await page.mouse.down(); await page.mouse.move(80, 250, { steps: 4 }); await page.mouse.up();
  await page.waitForTimeout(300);
  const h1 = await page.evaluate(() => [hero.x, hero.y, cam.fx, hero.path.length]);
  ok(h0[0] === h1[0] && h0[1] === h1[1] && h0[2] === h1[2] && h1[3] === 0 && await page.locator('#sheet').isHidden(), '대화창 바깥을 누르면 창이 닫히고 걷기와 끌기는 일어나지 않음');

  let s0;
  const cell = (x, y) => page.evaluate(([x, y]) => window.MinerDiary.cell(x, y), [x, y]);
  const deep = async () => (await st()).deep;
  // 기력이 캐기 비용과 걸음(8칸마다 1)만큼 줄었는지
  const spent = (a, b) => (a.energy - b.energy) - (Math.floor(b.deep.steps / 8) - Math.floor(a.deep.steps / 8));
  // 4. 숲 동굴 (연습판): 광산 입구는 무너져 있고, 숲 속 동굴에서 먼저 캐기를 익힘
  ok((await quest()).includes('숲 동굴'), '첫 퀘스트 다음은 「숲 동굴 들어가기」');
  await visit('mine', '#sheet h2:has-text("무너진 광산 입구")');
  ok(await page.locator('#sheet [data-a="restore"]').count() === 0, '광산 입구는 처음엔 무너져 있고 아직 못 고침');
  await page.click('#sheet [data-a="close"]');
  await visit('forest', '#sheet [data-a="forest"]');
  await page.click('#sheet [data-a="forest"]');
  await page.waitForFunction(() => window.MinerDiary.scene() === 'forest', null, { timeout: 5000 });
  { const p = await page.evaluate(() => window.MinerDiary.forestSpot(S.forest.ex - 6, S.forest.ey - 4)); await page.mouse.click(p.x, p.y); }
  await page.waitForFunction(() => window.MinerDiary.scene() === 'mine' && S.deep.L === 0, null, { timeout: 15000 });
  await page.waitForTimeout(300);
  ok((await quest()).includes('광석 캐기'), '숲에서 동굴 입구 2×2 칸 가운데 뒤쪽 칸을 눌러도 걸어가서 숲 동굴, 퀘스트 「광석 캐기」');
  ok(await page.evaluate(() => { let holes = 0; for (let y = -18; y <= 18; y++) for (let x = -18; x <= 18; x++) if (mT(x, y) === 'd') holes++; const e0 = S.energy; dig(30, 0); return holes === 0 && mT(30, 0) === 'w' && S.energy === e0; }), '숲 동굴은 작고(바깥 벽은 못 캠) 내려가는 구멍이 없음');
  for (let k = 0; k < 8 && ((await st()).carry.copper || 0) < 5; k++) {   // 가끔 한 번 누름이 걷기로 끝나 덜 캐지므로 다섯이 될 때까지
    const r = await page.evaluate(() => window.MinerDiary.nearRock());
    await page.evaluate(([x, y]) => window.MinerDiary.setCell(x, y, 'r', 'copper'), r);
    await tap(r[0], r[1]);
  }
  await page.waitForFunction(() => (S.carry.copper || 0) >= 5, null, { timeout: 3000 }).catch(() => {});
  ok((await st()).carry.copper >= 5 && (await quest()).includes('상인'), '동굴에서 광석 다섯을 캐면 「상인에게 광석 팔기」');
  ok((await page.evaluate(() => window.MinerDiary.mfloats())).some(t => /^구리 광석 \+[12]$/.test(t)), '캐면 광석 이름과 개수가 떠오름 (구리 광석 +1)');
  ok(!/\d+\/\d+/.test((await quest()).replace(/\d+\/\d+\s*$/, '')) && !(await page.evaluate(() => document.querySelector('.quest em'))), '퀘스트 막대에 몇 번째인지(전체 개수) 숫자가 없음');
  ok(await page.locator('#minebar [data-a="leave"]').count() === 0 && await page.locator('#minebar [data-a="homeFastAsk"]').count() === 1, '아래 막대엔 마을 단추 하나 (걸어서 나가기 단추 없음)');
  await goHome(page);
  ok(true, '숲 동굴에서 마을 단추로 집 앞까지');
  ok((await st()).carry.copper >= 5 && !(await st()).inv.copper, '숲을 지나 마을로 와도 가방은 그대로 들고 있음 (저절로 창고에 안 들어감)');
  ok(await page.evaluate(() => /\d+\/\d+/.test(document.querySelector('#dock [data-a="bag"]').textContent)), '마을 아래 가방 단추엔 가방 칸 수');
  await page.evaluate(() => { S.carry.herb = 1; sell('herb'); closeSheet(); });
  ok((await quest()).includes('상인'), '채집물만 팔면 「상인에게 광석 팔기」는 안 깨짐');
  await visit('merchant', '#sheet [data-a="sellAll"]');
  if (shot) await page.screenshot({ path: path.join(shot, 'merchant.png') });
  await page.click('#sheet [data-a="sellAll"]');
  ok((await quest()).includes('광산 입구 고치기') && (await st()).gold >= 60, `팔고 나면 「광산 입구 고치기」 (🪙${(await st()).gold})`);
  await page.click('#sheet [data-a="close"]');
  // 4-1. 광산 입구를 고치면 촌장이 본 게임을 소개하고 광맥 추를 줌
  await visit('mine', '#sheet [data-a="restore"][data-o="mine"]');
  const gMine = (await st()).gold;
  await page.click('#sheet [data-a="restore"][data-o="mine"]');
  s0 = await st();
  ok(s0.restored.includes('mine') && s0.gold === gMine - 60 && s0.acc.have.dowse === 1 && (await page.textContent('#sheet')).includes('진짜') && (await quest()).includes('광산 들어가기'), '🪙60으로 광산 입구를 고치면 촌장이 광산을 소개하고 광맥 추를 줌');
  await page.click('#sheet [data-a="close"]');
  // 4-2. 광산(땅속) 입장
  await visit('mine', '#sheet [data-a="enter"]');
  ok((await page.textContent('#sheet')).includes('최고 깊이') && !(await page.textContent('#sheet')).includes('가장 깊이'), '광산 창엔 「최고 깊이」');
  await page.click('#sheet [data-a="enter"]');
  const lb = await page.waitForFunction(() => { const l = document.querySelector('#minebar .loc'); return !!l && /깊이 \d+/.test(l.querySelector('b').textContent) && l.querySelector('small').textContent.length > 0 && !!document.querySelector('#minebar .bagm i'); }, null, { timeout: 8000 }).then(() => true).catch(async () => page.evaluate(() => document.querySelector('#minebar').innerHTML.replace(/<svg.*?<\/svg>/g, '').slice(0, 300)));
  ok(lb === true, '아래 막대: 작은 글씨로 구역, 큰 글씨로 깊이, 가방 채움 막대 ' + (lb === true ? '' : lb));
  await page.waitForFunction(() => window.MinerDiary.scene() === 'mine', null, { timeout: 5000 });
  await page.waitForTimeout(300);
  ok((await st()).screen === 'mine', '광산 입장 (깊이 1, 입구)');
  ok((await quest()).includes('집에서 자기'), '광산에 들어가면 퀘스트 「집에서 자기」');
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
    ok((await cell(r[0], r[1])).t === 'f' && spent(a, b) === 2 && [1, 2].includes((b.carry.copper || 0) - (a.carry.copper || 0)), `광석 바위를 캐면 가방에 구리 1개(연달아 캐면 가끔 2개), 기력 2 (${k + 1})`);
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
    { const t1 = /가방이 가득 차 더 못 캠/.test(await page.textContent('#toast')), t2 = (await page.evaluate(() => window.MinerDiary.mfloats())).includes('가방 가득'), t3 = await page.locator('#minebar [data-a="bag"].full').count() === 1;
      ok(t1 && t2 && t3, `가방이 가득이면 알림과 바위 위 가방 가득 글자, 가방 단추가 붉게 깜빡임 (${t1} ${t2} ${t3})`); }
    // 버리기: 고르고 수량 막대로 정함
    await page.evaluate(() => showBag());
    await page.click('#sheet [data-a="dropPick"]');
    await page.click('#sheet [data-a="dropSel"][data-o="coal"]');
    await page.locator('#sheet input[data-drop]').fill('90');
    ok((await page.textContent('#sheet .drop b')) === '×90', '수량 막대를 당기면 버릴 수량이 바뀜');
    await page.click('#sheet [data-a="dropDo"]');
    ok(await page.evaluate(() => S.carry.coal === 9 && window.MinerDiary.carryN() < 20) && await page.locator('#sheet [data-a="dropPick"]').count() === 1, '석탄 99개 중 90개를 버리면 9개 남고 가방 창으로 돌아옴');
    await page.click('#sheet [data-a="close"]');
    await page.evaluate(() => { delete S.carry.coal; renderDock(); });
  }

  // 7. 시간대
  s = await st();
  const used = (s.dayStart - s.minE) / s.max * 100;
  ok(await page.evaluate(() => window.MinerDiary.phaseIndex()) === (used >= 90 ? 3 : used >= 60 ? 2 : used >= 30 ? 1 : 0), `시간대가 쓴 기력 ${used}%와 맞음`);

  // 8. 나가기: 위로 가는 사다리까지 걸어가 올라가고, 깊이 1의 입구까지 이어서 마을로
  const dug0 = Object.keys((await deep()).dug).length;
  const carry0 = (await st()).carry;   // 구멍까지 가며 캔 바위에서 광석이 더 나올 수 있으니 나가기 직전 가방을 기준으로
  await goHome(page);
  await page.waitForTimeout(1000);
  s = await st();
  ok(s.screen === 'village' && carry0.copper >= 5 && Object.entries(carry0).every(([k, n]) => s.carry[k] === n), `깊이 3에서 마을 단추로 집 앞까지, 가방은 그대로 (${s.screen} ${JSON.stringify(s.carry)} ${s.day})`);
  // 집 창고: 가방에서 넣고 꺼냄
  await visit('house', '#sheet [data-a="store"]');
  ok(await roomOk(page) === 'ok' && await page.locator('#sheet .room [data-a="sleep"]').count() === 1 && await page.locator('#sheet .room [data-a="stats"]').count() === 1, `집 안 그림에서 침대(자기), 책상(능력치), 상자(창고)를 누름 (${await roomOk(page)})`);
  await page.click('#sheet [data-a="store"]');
  await page.click('#sheet [data-a="stAll"]');
  s = await st();
  ok(!Object.keys(s.carry).length && Object.entries(carry0).every(([k, n]) => s.inv[k] === n), '집 창고에서 모두 넣기를 누르면 가방 것이 창고로');
  await page.click('#sheet [data-a="stOut"][data-o="copper"]');
  s = await st();
  ok(s.carry.copper === carry0.copper && !s.inv.copper, '창고에서 꺼내기를 누르면 가방으로');
  await page.click('#sheet [data-a="stIn"][data-o="copper"]');
  ok((await st()).inv.copper === carry0.copper, '넣기를 누르면 그 물건만 창고로');
  await page.click('#sheet [data-a="close"]');
  ok(Object.keys(s.deep.dug).length >= dug0, '판 곳은 사라지지 않음');

  // 9. 팔기
  const worth = await page.evaluate(() => ORE_ORDER.reduce((a, o) => a + have(o) * ORES[o].price, 0)), g0 = (await st()).gold;
  await visit('merchant', '#sheet [data-a="sellAll"]');
  if (shot) await page.screenshot({ path: path.join(shot, 'merchant.png') });
  await page.click('#sheet [data-a="sellAll"]');
  s = await st();
  ok(s.gold === g0 + worth && Object.values(s.inv).every(n => n === 0) && !Object.keys(s.carry).length, '마을 안에선 창고 것도 그 자리에서 팔림, 전부 팔아 돈이 정확히 들어옴');

  // 10. 집에서 자기
  const day = s.day, ph = await page.evaluate(() => window.MinerDiary.phaseIndex()), expE = ph === 3 ? 90 : ph <= 1 ? 110 : 100;
  await visit('house', '#sheet [data-a="sleep"]');
  await page.click('#sheet [data-a="sleep"]');
  s = await st();
  ok(await page.locator('#sheet .daysum').isVisible() && s.bestDay > 0, `자면 어제 얻은 것과 값이 세어지며 나옴 (🪙${s.bestDay}, 첫날이라 최고 기록)`);
  await page.waitForFunction(() => +document.getElementById('sumv').textContent === S.bestDay, null, { timeout: 4000 });
  ok(true, '하루 정산 값이 끝까지 올라감');
  ok(s.day === day + 1 && s.energy === expE && s.minE === s.energy, `자고 나서 ${s.day}일차 기력 ${s.energy} (저녁 전에 자면 덤 110, 새벽이면 90)`);
  ok((await quest()).includes('숲에서 채집'), '자고 나면 이미 간 깊이 3은 바로 끝나고 「숲에서 채집」');

  // 10-1z. 숲 문 (기획 82번): 서쪽 성벽의 숲 문, 숲 나무 덩어리 어디를 눌러도 숲 문으로, 성벽 문 옆 성벽을 눌러도 성벽 문으로
  {
    const fg = await page.evaluate(() => { const o = OBJ.find(v => v.id === 'forest'); return { x: o.gx, y: o.gy, wall: isWall(o.gx, o.gy), door: o.door, tree: HIT_MORE.forest.find(([a, b]) => DECO_TREES.some(([u, v]) => u === a && v === b) && Math.abs(b - o.gy) > 2), gw: HIT_MORE.gate[0] }; });
    ok(fg.wall && fg.door[0] === fg.x + 1 && fg.tree && fg.gw, `숲 문은 서쪽 성벽에 있고 문 앞 칸은 성 안 (${JSON.stringify(fg)})`);
    await page.evaluate(() => closeSheet());   // 열린 창이 있으면 누르기가 창만 닫으니 먼저 닫음
    { const p = await page.evaluate(([x, y]) => window.MinerDiary.tileSpot(x, y), fg.tree); await page.mouse.click(p.x, p.y); }
    await page.waitForSelector('#sheet [data-a="forest"]', { timeout: 20000 });
    ok(await page.evaluate(([x, y]) => Math.round(hero.x) === x && Math.round(hero.y) === y, fg.door), '숲 나무 덩어리를 누르면 숲 문 앞까지 걸어가 숲 창');
    await page.click('#sheet [data-a="close"]');
    { const p = await page.evaluate(([x, y]) => window.MinerDiary.tileSpot(x, y), fg.gw); await page.mouse.click(p.x, p.y); }
    ok(await page.evaluate(() => selected && selected.id === 'gate'), '성벽 문 옆 성벽을 눌러도 성벽 문으로');
    await page.evaluate(() => { hero.path = []; hero.target = null; selected = null; closeSheet(); });
  }
  // 10-2. 숲 채집: 안개 속에서 주울 것을 찾아 밟으면 가방에
  await visit('forest', '#sheet [data-a="forest"]');
  await page.click('#sheet [data-a="forest"]');
  await page.waitForFunction(() => window.MinerDiary.scene() === 'forest', null, { timeout: 5000 });
  s = await st();
  ok(s.forest.seen.filter(Boolean).length < s.forest.t.length / 10 && Object.keys(s.forest.it).length > 20, '숲은 안개에 덮여 있고 주울 것이 흩어져 있음');
  if (shot) await page.screenshot({ path: path.join(shot, 'forest.png') });
  const eF = s.energy;
  const triedF = [];   // 한 번 눌러도 못 주운 자리(길이 막힌 곳)는 다시 고르지 않음
  for (let k = 0; k < 30 && (await st()).gatherN < 5; k++) {
    const it = await page.evaluate(tried => { const f = S.forest; return Object.keys(f.it).filter(k2 => f.it[k2] !== 'chest' && !tried.includes(k2)).map(k2 => k2.split(',').map(Number)).sort((a, b) => Math.hypot(a[0] - hero.x, a[1] - hero.y) - Math.hypot(b[0] - hero.x, b[1] - hero.y))[0]; }, triedF);
    if (!it) break;
    const n0 = (await st()).gatherN;
    const p = await page.evaluate(([x, y]) => window.MinerDiary.forestSpot(x, y), it);
    await page.mouse.click(p.x, p.y); await page.waitForTimeout(60);
    await page.waitForFunction(() => !window.MinerDiary.hero().moving, null, { timeout: 15000 });
    if ((await st()).gatherN === n0) triedF.push(it.join(','));
  }
  s = await st();
  ok(s.gatherN >= 5 && (await quest()).includes('보물') && Object.keys(s.carry).length > 0, '숲에서 다섯 번 주우면 퀘스트 끝, 주운 것은 가방에');
  ok(s.energy === eF - Math.floor(s.forest.steps / 5), `숲에서는 5칸마다 기력 1 (걸음 ${s.forest.steps})`);
  // 10-2a. 숲 깊은 곳: 큰 바위는 곡괭이 파워가 넘어야 깨짐
  const bz = await page.evaluate(() => { const bx = F_ZONES[0].x, by = S.forest.ey; for (let x = bx - 1; x <= bx + 1; x++) S.forest.seen[fI(x, by)] = 1; return [bx, by]; });
  ok(await page.evaluate(([x, y]) => window.MinerDiary.fcell(x, y), bz) === 'B' && await page.evaluate(() => window.MinerDiary.power()) === 10, '깊은 숲 앞엔 큰 바위, 낡은 곡괭이 파워는 10');
  { const p = await page.evaluate(([x, y]) => window.MinerDiary.forestSpot(x, y), bz); await page.mouse.click(p.x, p.y); await page.waitForTimeout(80); await page.waitForFunction(() => !window.MinerDiary.hero().moving, null, { timeout: 20000 }); await page.waitForTimeout(100); }
  ok(await page.evaluate(([x, y]) => window.MinerDiary.fcell(x, y), bz) === 'B' && (await page.textContent('#toast')).includes('파워 30'), '파워가 모자라면 「파워 30 필요」로 안 깨짐');
  await page.evaluate(() => { S.sharp = 5; });
  { const p = await page.evaluate(([x, y]) => window.MinerDiary.forestSpot(x, y), bz); await page.mouse.click(p.x, p.y); await page.waitForTimeout(80); await page.waitForFunction(() => !window.MinerDiary.hero().moving, null, { timeout: 20000 }); await page.waitForTimeout(100); }
  ok(await page.evaluate(([x, y]) => window.MinerDiary.fcell(x, y), bz) === 'g' && (await st()).forestOpen[1] === 1, '파워 30이 되면 큰 바위를 깨고 깊은 숲이 열림 (다음 날에도 열려 있음)');
  await page.evaluate(() => { S.sharp = 0; });
  // 10-2c. 곁가지 숲: 버섯 골짜기(가시덤불은 낫으로), 호숫가 숲(낚시)
  ok(await page.evaluate(() => [window.MinerDiary.fcell(40, 2), window.MinerDiary.fcell(40, 3), window.MinerDiary.fcell(24, FH - 3)].join('')) === 'oqo', '깊은 숲 위에 버섯 골짜기 입구(가시덤불), 오래된 숲 아래에 호숫가 숲 입구');
  await page.evaluate(() => { S.forest.mons = []; for (let y = 1; y <= S.forest.ey; y++) for (let x = 39; x <= 41; x++) S.forest.seen[fI(x, y)] = 1; });   // 밤이면 깊은 숲 늑대가 끼어드니 이 시험에선 치움
  const ftap = async (x, y) => { const p = await page.evaluate(([x, y]) => window.MinerDiary.forestSpot(x, y), [x, y]); await page.mouse.click(p.x, p.y); await page.waitForTimeout(80); await page.waitForFunction(() => !window.MinerDiary.hero().moving, null, { timeout: 20000 }); await page.waitForTimeout(100); };
  await ftap(40, 3);
  ok(await page.evaluate(() => window.MinerDiary.fcell(40, 3)) === 'q' && (await page.textContent('#toast')).includes('낫 필요'), '낫이 없으면 가시덤불을 못 침');
  await page.evaluate(() => { S.sickle = 1; });
  await ftap(40, 3);
  ok(await page.waitForFunction(() => window.MinerDiary.fcell(40, 3) === 'g', null, { timeout: 3000 }).then(() => true).catch(() => false), '낫이 있으면 가시덤불을 쳐서 길을 냄');   // 곡괭이질이 닿을 때까지 기다림
  ok(await page.evaluate(() => swingTool) === 'sickle', '가시덤불을 칠 땐 손에 낫이 들림');
  await ftap(40, 2);
  await page.waitForFunction(() => S.forest.grove === 'mush', null, { timeout: 10000 });
  ok(await page.evaluate(() => Object.values(S.forest.it).filter(k => k === 'glowcap' || k === 'truffle' || k === 'mush').length) > 10, '버섯 골짜기엔 버섯과 빛버섯, 송로버섯이 잔뜩');
  await page.evaluate(() => leaveGrove());
  await page.waitForFunction(() => window.MinerDiary.scene() === 'forest' && !S.forest.grove, null, { timeout: 20000 });
  ok(true, '곁가지 숲 길로 나가면 본 숲으로');
  await page.evaluate(() => { S.rod = 1; enterGrove('lake'); for (let i = 0; i < S.forest.seen.length; i++) S.forest.seen[i] = 1; });
  // 땅과 맞닿은 물가 중 광부에게 가까운 곳부터 (나무에 막혀 못 가는 물가가 있어 몇 곳을 차례로 시도)
  const wts = await page.evaluate(() => { const f = S.forest, out = []; for (let y = 1; y < FH - 1; y++) for (let x = 1; x < FW - 1; x++) if (f.t[fI(x, y)] === 'w' && [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => f.t[fI(x + dx, y + dy)] === 'g')) out.push([x, y]); return out.sort((a, b) => Math.hypot(a[0] - hero.x, a[1] - hero.y) - Math.hypot(b[0] - hero.x, b[1] - hero.y)).slice(0, 6); });
  for (const wt of wts) {
    await ftap(wt[0], wt[1]);
    if (await page.waitForSelector('#sheet [data-a="pull"]', { timeout: 4000 }).then(() => true).catch(() => false)) break;
    await page.evaluate(() => closeSheet());
  }
  await page.waitForSelector('#sheet [data-a="pull"]', { timeout: 3000 });
  await page.evaluate(() => { window.MinerDiary.fishBite(); document.querySelector('#sheet [data-a="pull"]').click(); });   // 무는 시간(0.75초) 안에 바로 당김
  ok(await page.evaluate(() => ['perch', 'carp', 'goldfin'].some(k => S.carry[k] > 0)), '호숫가 숲 물가를 누르면 낚시, 호수 물고기(쏘가리, 붕어, 금빛 송사리)');
  await page.click('#sheet [data-a="close"]');
  await page.evaluate(() => { leaveGrove(); S.rod = 0; S.sickle = 0; });
  await goHome(page);
  s = await st();
  ok(['herb', 'mush', 'wood', 'fiber', 'leather', 'copper'].some(k => s.carry[k] > 0), '숲에서 마을 단추로 집 앞까지, 주운 것은 가방에 그대로');

  // 10-2b. 광산: 광맥 줄기와 연속 캐기, 숨은 보물 상자
  ok((await quest()).includes('보물'), '채집 다음 퀘스트 「광산 숨은 보물 찾기」');
  await visit('mine', '#sheet [data-a="enter"]');
  await page.click('#sheet [data-a="enter"]');
  await page.waitForFunction(() => window.MinerDiary.scene() === 'mine', null, { timeout: 5000 });
  await page.waitForTimeout(300);
  await page.evaluate(() => { S.energy = S.max; S.minE = S.dayStart = S.max; S.carry = {}; renderHud(); });
  const hm = await page.evaluate(() => { const h = window.MinerDiary.hero(); return [Math.round(h.x), Math.round(h.y)]; });
  // 광부 둘레를 바닥으로 열고, 옆에 광석 바위 둘과 보물 상자 하나를 둠
  await page.evaluate(([x, y]) => { const M = window.MinerDiary; for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) M.setCell(x + dx, y + dy, 'f', ''); M.setCell(x + 1, y, 'r', 'copper'); M.setCell(x - 1, y, 'r', 'copper'); M.setCell(x, y - 2, 'T'); }, hm);
  await tap(hm[0] + 1, hm[1]); await tap(hm[0] - 1, hm[1]);
  ok(await page.evaluate(() => window.MinerDiary.combo()) >= 2 && (await st()).bestCombo >= 2, '광석을 연달아 캐면 연속 캐기가 이어짐');
  // 풍요의 고리: 끼면 광석을 캘 때마다 하나 더
  await page.evaluate(([x, y]) => { S.acc.have.plenty = 1; S.acc.eq = ['plenty']; window.MinerDiary.setCell(x + 1, y, 'r', 'iron'); }, hm);
  const ir0 = (await st()).carry.iron || 0;
  await tap(hm[0] + 1, hm[1]);
  ok(((await st()).carry.iron || 0) - ir0 >= 2, '풍요의 고리를 끼면 광석을 캘 때마다 하나 더');
  await page.evaluate(() => { S.acc.have.plenty = 0; S.acc.eq = ['dowse']; });
  // 능력치 창: 가방에서 열고, 장신구 효과는 숫자로
  await page.evaluate(() => { S.acc.have.clover = 1; S.acc.eq = ['clover']; showBag(); });
  ok((await page.textContent('#sheet')).includes('광석 2배 확률 +10%'), '가방에서 장신구 효과가 숫자로 보임 (광석 2배 확률 +10%)');
  await page.click('#sheet [data-a="stats"]');
  await page.waitForSelector('#sheet h2:has-text("능력치")');
  const stTxt = await page.textContent('#sheet');
  ok(stTxt.includes('광석 2배 확률') && stTxt.includes('10%') && stTxt.includes('캐기 기력') && stTxt.includes('가방'), '능력치 창에 2배 확률, 캐기 기력, 가방 칸 등이 숫자로');
  await page.click('#sheet [data-a="bag"]');
  await page.waitForSelector('#sheet [data-a="stats"]');
  await page.click('#sheet [data-a="close"]');
  await page.evaluate(() => { S.acc.have.clover = 0; S.acc.eq = ['dowse']; });
  const gC = (await st()).gold, nC = await page.evaluate(() => window.MinerDiary.carryN());
  await tap(hm[0], hm[1] - 2);
  s = await st();
  ok(s.chestN === 1 && s.gold > gC + 50 && await page.evaluate(() => window.MinerDiary.carryN()) > nC && (await cell(hm[0], hm[1] - 2)).t === 'f', `보물 상자를 열면 돈과 광석 (🪙${s.gold - gC}, 퀘스트 보상 🪙50 포함)`);
  ok((await quest()).includes('대장간 복구비'), '보물을 찾으면 다음 퀘스트 「대장간 복구비 모으기」');
  await page.evaluate(() => toVillage('home'));

  // 10-3. 상인에게서 나침반과 귀환서 사기
  await page.evaluate(() => { S.gold = Math.max(S.gold, 300); renderHud(); });
  await visit('merchant', '#sheet [data-a="mTab"]');
  await page.click('#sheet [data-a="mTab"][data-o="buy"]');
  ok(await page.locator('#sheet [data-a="sell"]').count() === 0 && await page.locator('#sheet .seg .on').textContent() === '구매', '떠돌이 상인은 구매와 판매 칸이 나뉨 (기획 83번)');
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
  await page.evaluate(() => { const s = window.MinerDiary.state(); s.gold = 1000; s.carry = {}; s.inv.copper = 27; s.inv.coal = 10; questEvent(); renderHud(); });
  ok((await quest()).includes('대장간 고치기'), '돈이 모이면 퀘스트 「대장간 고치기」');
  await visit('smithy', '#sheet [data-a="restore"][data-o="smithy"]');
  await page.click('#sheet [data-a="restore"][data-o="smithy"]');
  s = await st();
  ok(s.restored.includes('smithy') && s.gold === 500 && (await page.textContent('#sheet h2')).includes('대장장이'), '🪙500으로 대장간을 고치면 대장장이가 옴');
  await page.click('#sheet [data-a="close"]');
  await visit('smithy', '#sheet .room');
  ok(await page.locator('#sheet .room [data-a="smTab"]').count() >= 5 && await page.locator('#sheet [data-a="smelt"]').count() === 0 && await roomOk(page) === 'ok', `대장간 첫 화면은 안 그림에서 용광로, 모루, 숫돌, 장신구 탁자, 연장 벽을 누름 (${await roomOk(page)})`);
  await page.click('#sheet [data-a="smTab"][data-o="furnace"]');
  if (shot) await page.screenshot({ path: path.join(shot, 'smithy.png') });
  await page.click('#sheet [data-a="smelt"][data-o="copper"]');
  s = await st();
  ok(s.furnace && s.furnace.bar === 'copperBar' && s.furnace.n === 5 && s.inv.copper === 2 && s.inv.coal === 5, '용광로에 구리 광석 25개와 석탄 5개를 넣으면 주괴 5개가 내일 나옴');
  ok((await quest()).includes('구리 곡괭이'), '다음 퀘스트 「구리 곡괭이 만들기」');
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
    await page.evaluate(([x, y]) => { window.MinerDiary.setCell(x, y, 'r', ''); S.deep.steps = 0;   // 걸음 기력으로 쓰러지지 않게 (캐기에서 물어보는지만 봄): 바위 바로 옆 바닥에 세움
      const nb = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dy]) => [x + dx, y + dy]).find(([a, b]) => seenGet(a, b) && FLOORISH(mT(a, b))); if (nb) { hero.x = nb[0]; hero.y = nb[1]; hero.path = []; } }, r);
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
  await page.evaluate(() => { window.MinerDiary.quietEvents(); window.MinerDiary.autoConfirm(true); });
  ok((await st()).day === s.day, '새로고침 후에도 날짜 유지');

  // 13. 곡괭이 강화: 망치질 세 번, 품질
  await page.evaluate(() => window.MinerDiary.speed(10));
  const forge = async () => {
    await smithy('pick');
    await page.click('#sheet [data-a="forge"]');
    await page.waitForSelector('#sheet [data-a="forgeGo"]');   // 만들기 창: 자루와 추가 재료를 고름 (기본은 나뭇가지 자루, 추가 재료 없음)
    await page.click('#sheet [data-a="forgeGo"]');
    await page.mouse.click(30, 200); await page.waitForTimeout(100);
    ok(await page.locator('#sheet [data-a="close"]').count() === 0 && await page.locator('#sheet').isVisible(), '망치질 중에는 창을 닫을 수 없고 바깥을 눌러도 안 닫힘');
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
  ok(s.pick === 1 && !P(s, 'copperBar') && s.gold === gP - 200 + 50, '구리 주괴 5개와 🪙200으로 구리 곡괭이 (퀘스트 보상 🪙50)');
  ok(s.pickQ >= 1, `가운데를 맞춰 두드리면 품질이 오름 (${['보통', '좋음', '최상'][s.pickQ]})`);
  ok(await page.evaluate(() => window.MinerDiary.maxFloor()) === 7 && (await quest()).includes('다리'), '구리 곡괭이로 깊이 7까지, 다음 퀘스트 「강가 다리 고치기」');
  // 13-0x. 날 세우기: 곡괭이 파워 +4
  const pw0 = await page.evaluate(() => { S.inv.copperBar = 3; S.gold += 100; showSmithy('sharp'); return window.MinerDiary.power(); });
  await page.click('#sheet [data-a="sharp"]');
  ok((await st()).sharp === 1 && await page.evaluate(() => window.MinerDiary.power()) === pw0 + 4 && (await page.textContent('#sheet .pkcard')).includes(`파워 ${pw0 + 4}`) && await page.locator('#sheet .pips i.on').count() === 1, `대장간 날 세우기로 곡괭이 파워 +4 (${pw0} 다음 ${pw0 + 4}), 눈금 한 칸`);
  await page.evaluate(() => showSmithy('tool'));
  ok(await page.locator('#sheet [data-a="craft"][data-o="sickle"]').count() === 1 && await page.locator('#sheet [data-a="sharp"]').count() === 0, '도구 화면에서 낫을 만들 수 있고, 날 세우기는 따로');
  await page.click('#sheet [data-a="close"]');

  // 13-0c. 강가 다리 고치기, 낚싯대, 낚시 세 번 (찌가 잠길 때 당김). 시장과 밭이 강 건너라 다리가 먼저 (기획 67번)
  await page.evaluate(() => { S.inv.wood = 20; S.inv.ironBar = 2; S.gold += 300; renderHud(); });
  await visit('bridge', '#sheet [data-a="restore"][data-o="bridge"]');
  await page.click('#sheet [data-a="restore"][data-o="bridge"]');
  s = await st();
  ok(s.restored.includes('bridge') && s.rod && (await quest()).includes('물고기'), '다리를 고치면 낚싯대를 받고 퀘스트 「물고기 낚기」');
  await page.click('#sheet [data-a="close"]');
  ok(await page.evaluate(() => { const b = OBJ.find(o => o.id === 'bridge'); return !blocked(b.gx, b.gy) && !blocked(b.gx, b.gy + 1); }), '고친 다리는 건널 수 있음');
  const wx = 13, wy = await page.evaluate(() => riverY(13) + 1);
  const wp = await page.evaluate(([x, y]) => window.MinerDiary.tileSpot(x, y), [wx, wy]);
  await page.mouse.click(wp.x, wp.y);
  await page.waitForSelector('#sheet [data-a="pull"]', { timeout: 15000 });
  if (shot) await page.screenshot({ path: path.join(shot, 'fishing.png') });
  const eFi = (await st()).energy, fN0 = (await st()).fishN || 0;
  for (let k = 0; k < 3; k++) {
    if (k) await page.click('#sheet [data-a="cast"]');
    await page.waitForFunction(() => window.MinerDiary.fishState() === 'bite', null, { timeout: 8000, polling: 20 });
    await page.evaluate(() => document.querySelector('#sheet [data-a="pull"]').click());
  }
  s = await st();
  ok(s.fishN === fN0 + 3 && ['carp', 'trout', 'catfish', 'eel', 'moonkoi'].some(k => P(s, k) > 0) && s.energy === eFi - 4, '강을 누르면 물가로 걸어가 낚시, 찌가 잠길 때 당기면 물고기 (던질 때 기력 2)');
  ok((await quest()).includes('시장'), '물고기 셋을 낚으면 다음 퀘스트 「시장 고치기」');
  await page.click('#sheet [data-a="close"]');

  // 13-0. 시장: 나무 10개와 🪙800으로 고치고, 시세대로 팔기 (많이 팔면 값이 떨어짐), 다음 날 시세는 예고대로
  await page.evaluate(() => { S.gold += 800; S.inv.wood = 10; S.inv.iron = 20; renderHud(); });
  await visit('market', '#sheet [data-a="restore"][data-o="market"]');
  await page.click('#sheet [data-a="restore"][data-o="market"]');
  s = await st();
  ok(s.restored.includes('market') && !P(s, 'wood') && s.market && (await quest()).includes('시장에서 팔기'), '시장을 고치면 시세가 생기고 퀘스트 「시장에서 팔기」');
  await page.click('#sheet [data-a="close"]');
  const pr = await page.evaluate(() => [unitPrice('iron'), unitPrice('iron', 19), tradeValue('iron')]);
  ok(pr[1] < pr[0], `많이 팔수록 한 개 값이 떨어짐 (${pr[0]} → ${pr[1]})`);
  await visit('market', '#sheet [data-a="trade"][data-o="iron"]');
  if (shot) await page.screenshot({ path: path.join(shot, 'market.png') });
  const gM = (await st()).gold;
  await page.click('#sheet [data-a="trade"][data-o="iron"]');
  s = await st();
  ok(s.gold === gM + pr[2] + 50 && !P(s, 'iron') && s.market.sold.iron === 20, `철 광석 20개를 시세로 팔아 🪙${pr[2]} (퀘스트 보상 🪙50)`);
  // 13-0a2. 시장 상인들: 음식 상인과 재료 상인
  await page.evaluate(() => { S.gold += 200; marketTab = 'food'; showMarket(); });
  const gFd = (await st()).gold;
  await page.click('#sheet [data-a="mbuy"][data-o="food"][data-n="1"]');
  ok((await st()).items.bread === 1 && (await st()).gold === gFd - 35, '시장 음식 상인에게서 빵 🪙35');
  const wd0 = await page.evaluate(() => S.carry.wood || 0);
  await page.click('#sheet [data-a="mtab"][data-o="mat"]');
  await page.click('#sheet [data-a="mbuy"][data-o="mat"][data-n="0"]');
  ok(await page.evaluate(() => S.carry.wood || 0) === wd0 + 5, '시장 재료 상인에게서 산 나뭇가지 5개는 가방에');
  await page.evaluate(() => { marketTab = 'trade'; showMarket(); });

  // 13-0b. 집 고치기: 최대 기력 +20
  await page.click('#sheet [data-a="close"]');
  await page.evaluate(() => { S.inv.wood = 15; S.inv.ironBar = 2; S.gold += 400; renderHud(); });
  await visit('house', '#sheet [data-a="home"]');
  const mx0 = (await st()).max;
  await page.click('#sheet [data-a="home"]');
  s = await st();
  ok(s.home === 1 && s.max === mx0 + 20 && (await page.textContent('#sheet h2')).includes('고친 집'), `집을 고치면 최대 기력 ${s.max}`);
  await page.click('#sheet [data-a="close"]');
  // 13-0d. 밭: 고치고, 씨앗 사서 심고, 아침이나 점심에 물 주면 밤에 자람, 다 자라면 거둠
  await page.evaluate(() => { S.inv.wood = 8; S.gold += 400; renderHud(); });
  await visit('field', '#sheet [data-a="restore"][data-o="field"]');
  await page.click('#sheet [data-a="restore"][data-o="field"]');
  ok((await st()).restored.includes('field') && (await quest()).includes('거두기'), '밭을 고치면 퀘스트 「작물 거두기」');
  await page.click('#sheet [data-a="close"]');
  await visit('merchant', '#sheet [data-a="mTab"]');
  await page.click('#sheet [data-a="mTab"][data-o="buy"]');
  for (let k = 0; k < 3; k++) await page.evaluate(() => document.querySelector('#sheet [data-a="buy"][data-n="0"]').click());   // 상점 창이 길어 아래쪽 단추는 창 안에서 바로 누름
  ok((await st()).items.radishSeed === 3, '상인에게서 무 씨앗 셋을 삼');
  await page.click('#sheet [data-a="close"]');
  await page.evaluate(() => { S.dayStart = S.minE = S.energy; renderHud(); });   // 시간을 아침으로 (물 주기 시험)
  const plots = await page.evaluate(() => { const f = OBJ.find(o => o.id === 'field'); return [[f.gx + 1, f.gy + 1], [f.gx + 3, f.gy + 1], [f.gx + 5, f.gy + 1]]; });
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
  ok(s.harvestN === 3 && P(s, 'radish') >= 3 && !Object.keys(s.farm).length && (await quest()).includes('식당'), '다 자란 무를 셋 거두면 다음 퀘스트 「식당 고치기」');

  // 13-0e. 식당: 고치고, 재료 둘로 요리를 찾고, 먹으면 기력, 점심에 주민 의뢰
  await page.evaluate(() => { S.inv.wood = 15; S.inv.ironBar = 2; S.gold += 1000; S.inv.mush = 1; S.inv.herb = 1; renderHud(); });
  await visit('kitchen', '#sheet [data-a="restore"][data-o="kitchen"]');
  await page.click('#sheet [data-a="restore"][data-o="kitchen"]');
  ok((await st()).restored.includes('kitchen') && (await quest()).includes('요리'), '식당을 고치면 퀘스트 「요리 찾기」');
  await page.click('#sheet [data-a="close"]');
  await visit('kitchen', '#sheet [data-a="kpick"]');
  ok(await roomOk(page) === 'ok', `식당 안 그림 (${await roomOk(page)})`);
  await page.click('#sheet .chip[data-a="kpick"][data-o="mush"]');
  ok(await page.locator('#sheet .potslot.ps0 .ore.mush').count() === 1, '고른 재료는 냄비 위 칸에 들어감');
  await page.click('#sheet .chip[data-a="kpick"][data-o="herb"]');
  await page.click('#sheet [data-a="kcookSel"]');
  s = await st();
  ok(s.items.soup === 1 && s.recipes.length === 1 && !P(s, 'mush') && (await quest()).includes('의뢰'), '버섯과 약초로 버섯 수프를 찾음, 다음 퀘스트 「주민 의뢰 들어주기」');
  if (shot) await page.screenshot({ path: path.join(shot, 'kitchen.png') });
  await page.click('#sheet [data-a="close"]');
  await page.evaluate(() => { S.energy = 50; renderHud(); showBag(); });
  await page.click('#sheet [data-a="use"][data-o="soup"]');
  s = await st();
  ok(s.energy === 75 && !s.items.soup, '버섯 수프를 먹으면 기력 +25');
  await page.click('#sheet [data-a="close"]');
  await page.evaluate(() => { S.minE = S.dayStart - S.max * .35; const q = todayReq(); S.inv[q.item] = (S.inv[q.item] || 0) + q.n; renderHud(); });   // 시간을 점심으로, 의뢰 물건 준비
  await visit('kitchen', '#sheet [data-a="kTab"][data-o="req"]');
  ok(await page.locator('#sheet .room [data-a="kTab"][data-o="req"] .dot').count() === 1, '의뢰를 들어줄 수 있으면 쪽지판에 알림 점');
  await page.click('#sheet [data-a="kTab"][data-o="req"]');
  await page.waitForSelector('#sheet [data-a="kreq"]');
  const gR = (await st()).gold, rq = (await st()).req;
  await page.click('#sheet [data-a="kreq"]');
  s = await st();
  ok(s.req.done && s.gold === gR + rq.gold + 100 && (await quest()).includes('밭 넓히기'), `점심에 의뢰(${rq.item} ${rq.n}개)를 들어주면 🪙${rq.gold} (퀘스트 보상 🪙100), 다음 퀘스트 「밭 넓히기」`);
  await page.click('#sheet [data-a="close"]');
  // 13-0e1. 밭 넓히기: 거친 밭을 고치면 두 번째 밭에도 심을 수 있음 (기획 67번)
  await page.evaluate(() => { S.inv.wood = (S.inv.wood || 0) + 20; S.gold += 600; renderHud(); });
  await visit('field2', '#sheet [data-a="restore"][data-o="field2"]');
  await page.click('#sheet [data-a="restore"][data-o="field2"]');
  ok((await st()).restored.includes('field2') && (await quest()).includes('의뢰판'), '넓힐 밭을 고치면 퀘스트 「촌장 의뢰판 의뢰」');
  await page.click('#sheet [data-a="close"]');
  {
    const f2 = await page.evaluate(() => { const f = OBJ.find(o => o.id === 'field2'); S.items.radishSeed = 1; return [f.gx + 2, f.gy + 1]; });
    const p = await page.evaluate(([x, y]) => window.MinerDiary.tileSpot(x, y), f2);
    await page.mouse.click(p.x, p.y);
    await page.waitForSelector('#sheet [data-a="plant"]', { timeout: 15000 });
    await page.click('#sheet [data-a="plant"]');
    ok((await st()).farm[f2[0] + ',' + f2[1]], '넓힌 밭 칸을 눌러 씨앗을 심음');
    await page.click('#sheet [data-a="close"]');
  }
  // 13-0e2. 의뢰판: 촌장에게 날마다 의뢰 셋. 물건 의뢰 하나를 끝냄
  const bi = await page.evaluate(() => { const L = todayBoard().list, i = L.findIndex(b => b.kind === 'item'); S.inv[L[i].item] = (S.inv[L[i].item] || 0) + L[i].n; return i; });
  await visit('chief', `#sheet [data-a="board"][data-n="${bi}"]`);
  ok(await page.locator('#sheet [data-a="board"]').count() === 3, '촌장에게 가면 의뢰판에 의뢰 셋');
  const gBd = (await st()).gold, bd = (await st()).board.list[bi];
  await page.click(`#sheet [data-a="board"][data-n="${bi}"]`);
  s = await st();
  ok(s.board.list[bi].done && s.gold === gBd + bd.gold + 100 && (await quest()).includes('깊이 7') && await page.locator(`#sheet [data-a="board"][data-n="${bi}"]`).isDisabled(), `의뢰판 의뢰(${bd.item} ${bd.n}개)를 끝내면 🪙${bd.gold} (퀘스트 보상 🪙100), 다시는 못 함`);
  await page.click('#sheet [data-a="close"]');
  await visit('market', '#sheet [data-a="close"]');
  ok(await page.evaluate(() => { const next = { ...S.market.next }; rollMarket(false); return Object.keys(next).every(o => Math.abs(S.market.mult[o] - next[o]) < 1e-9) && S.market.sold.iron === 10; }), '다음 날 시세는 전날 예고대로, 판 만큼 떨어진 값은 절반 회복');
  await page.click('#sheet [data-a="close"]');
  await page.evaluate(() => { const s = window.MinerDiary.state(); s.inv.ironBar = 5; s.gold += 600; renderHud(); });
  await forge();
  s = await st();
  ok(s.pick === 2 && !P(s, 'ironBar') && await page.evaluate(() => window.MinerDiary.maxFloor()) === 10, '철 곡괭이로 단단한 바위와 깊이 10까지');

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
  ok(P(s, 'crystalGem') >= 1 && !P(s, 'crystal') && s.cutN === 1 && (await quest()).includes('낫'), `수정 원석을 깎아 수정 보석 ${P(s, 'crystalGem')}개, 다음 퀘스트 「낫 만들기」`);
  await page.evaluate(() => { const r = CRAFTS.find(q => q.id === 'sickle'); Object.entries(r.need).forEach(([k, n]) => { S.inv[k] = (S.inv[k] || 0) + n; }); S.gold += r.gold; renderHud(); });
  await smithy('tool');
  await page.click('#sheet [data-a="craft"][data-o="sickle"]');
  ok((await st()).sickle === 1 && (await quest()).includes('깊이 10'), '대장간에서 낫을 만들면 다음 퀘스트 「깊이 10 도달」');
  await page.click('#sheet [data-a="close"]');

  // 13-0g. 성벽 문과 사냥: (깊이 10을 갔다 치고) 문을 고치고, 검을 만들고, 성 밖에서 몬스터 셋을 잡음
  await page.evaluate(() => { S.deepest = 10; questEvent(); S.inv.ironBar = 5; S.inv.wood = 20; S.inv.copperBar = 3; S.gold += 2200; renderHud(); });
  ok((await quest()).includes('성벽 문'), '깊이 10 다음 퀘스트 「성벽 문 고치기」');
  await visit('gate', '#sheet [data-a="restore"][data-o="gate"]');
  await page.click('#sheet [data-a="restore"][data-o="gate"]');
  ok((await st()).restored.includes('gate') && (await quest()).includes('사냥'), '성벽 문을 고치면 퀘스트 「성 밖에서 사냥」');
  await page.click('#sheet [data-a="close"]');
  ok(await page.evaluate(() => power() === PICK_ATK[S.pick] && !document.querySelector('[data-a="sword"]')), '검은 없고 공격력은 곡괭이 단계를 따름 (기획 70번)');
  await visit('gate', '#sheet [data-a="stage"][data-n="0"]');
  ok(await page.locator('#sheet [data-a="stage"][data-n="0"]').isDisabled() === (await page.evaluate(() => phaseIndex())) < 1 && await page.locator('#sheet [data-a="stage"][data-n="1"]').isDisabled(), '성벽 문은 점심부터 열리고, 토벌 2단계는 1단계를 깨야 열림');
  await page.click('#sheet [data-a="close"]');
  await page.evaluate(() => { S.minE = S.dayStart - S.max * .35; renderHud(); });
  await visit('gate', '#sheet [data-a="stage"][data-n="0"]:not([disabled])');
  await page.click('#sheet [data-a="stage"][data-n="0"]');
  ok(await page.evaluate(() => window.MinerDiary.scene()) === 'hunt' && (await page.evaluate(() => window.MinerDiary.mons())).length === 3, '토벌 1단계: 성 밖 들판에 멧돼지 셋');
  if (shot) await page.screenshot({ path: path.join(shot, 'hunt.png') });
  await page.waitForFunction(() => window.MinerDiary.bgm() === 'hunt', null, { timeout: 5000 });
  ok(true, '성 밖에선 배경음이 사냥 곡으로 바뀜');
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
  ok(await page.evaluate(() => swingTool) === 'pick', '몬스터도 곡괭이로 침');
  await page.waitForSelector('#sheet [data-a="leaveHunt"]', { timeout: 5000 }); s = await st();
  ok((await page.textContent('#sheet')).includes('1단계') && s.huntClear.home[0] === 1 && (s.carry.leather || 0) >= 2, '다 잡으면 「들판 1단계 토벌」, 처음 보상(가죽 둘)');
  await page.click('#sheet [data-a="stage"][data-n="1"]');
  ok(await page.evaluate(() => window.MinerDiary.scene() === 'hunt' && S.hunt.stage === 1 && S.hunt.mons.some(m => m.kind === 'wolf')), '다음 단계 단추로 2단계 (늑대가 섞임)');
  // 돌진과 빛 구슬, 왕 멧돼지의 부름
  const beh = await page.evaluate(async () => {
    hero.atk = null; hero.path = []; S.energy = S.max;   // 쫓던 몬스터가 있으면 멈칫할 때 쳐서 돌진이 끊기니 비움, 돌진에 맞아 쓰러지지 않게 기력을 채움
    const H = S.hunt, b = H.mons.find(m => m.kind === 'boar'); H.mons.forEach(m => { if (m !== b) m.hp = 0; }); b.hp = 99; b.x = hero.x + 3; b.y = hero.y; b.cd2 = 0; b.st = 'walk';
    const seen = new Set(); for (let i = 0; i < 120; i++) { huntTick(.02); seen.add(b.st); } b.hp = 0;
    H.won = true; H.mons.push(newMon(H.nid++, 'spirit', hero.x + 4, hero.y)); const sp = H.mons[H.mons.length - 1]; sp.cd2 = 0; huntTick(.02); const shot = H.shots.length > 0 || sp.cd2 > 1;   // 막힌 곳에 쏘면 구슬이 바로 사라질 수 있어 쏜 뒤 기다림으로도 봄 sp.hp = 0; H.shots = [];
    const k = newMon(H.nid++, 'king', hero.x + 5, hero.y - 2); k.sum = 0; k.cd2 = 9; H.mons.push(k); const n0 = H.mons.length; let called = false; for (let i = 0; i < 6 && !called; i++) { k.sum = 0; huntTick(.02); called = H.mons.length > n0; }   // 부른 멧돼지 자리는 무작위라 몇 번 기회를 줌 H.mons.forEach(m => { m.hp = 0; });
    return { wind: seen.has('wind'), dash: seen.has('dash'), shot, called };
  });
  ok(beh.wind && beh.dash && beh.shot && beh.called, '멧돼지는 멈칫했다가 돌진, 정령은 빛 구슬을 쏨, 왕 멧돼지는 멧돼지를 부름 ' + (beh.wind && beh.dash && beh.shot && beh.called ? '' : JSON.stringify(beh)));
  await goHome(page);
  s = await st();
  ok(s.carry.meat >= 1, '마을 단추로 돌아오면 잡은 것은 가방에 그대로');

  // 13-0g2. 세계 지도와 눈 덮인 산마을: 짐을 꾸려 길을 떠나고, 산마을 시장에 팔고, 산 광산에 들어가고, 여관에서 자고, 돌아옴
  ok((await quest()).includes('토벌 3단계'), '사냥 다음 퀘스트 「들판 토벌 3단계 깨기」 (기획 69번)');
  await page.evaluate(() => { S.huntClear.home[1] = S.huntClear.home[2] = 1; questEvent(); });
  ok((await quest()).includes('산마을'), '토벌 3단계를 깨면 다음 퀘스트 「눈 덮인 산마을 가기」');
  await page.evaluate(() => { S.inv.coal = 10; S.gold += 100; S.energy = S.max; S.minE = S.dayStart - S.max * .35; renderHud(); });
  await visit('gate', '#sheet [data-a="world"]');
  await page.click('#sheet [data-a="world"]');
  ok(await page.locator('#sheet [data-a="pack"]').count() === 0, '지도엔 짐 꾸리기가 없음 (창고는 집에서)');
  await page.evaluate(() => { closeSheet(); S.carry = {}; storeOut('coal'); closeSheet(); });
  ok((await st()).carry.coal === 10 && !(await st()).inv.coal, '집 창고에서 석탄을 꺼내 가방에');
  await page.evaluate(() => { S.inv.copper = 7; showWorld(); });
  ok(await page.locator('#sheet [data-a="travel"][data-o="mtn"]').count() === 0 && await page.locator('#sheet [data-a="walk"][data-o="mtn"]').count() === 1, '처음 가는 마을은 바로 가기 없이 걸어가기만');
  await page.click('#sheet [data-a="walk"][data-o="mtn"]');
  await page.waitForFunction(() => window.MinerDiary.scene() === 'forest' && S.forest.road === 'mtn', null, { timeout: 5000 });
  ok((await page.textContent('#minebar')).includes('눈길') && (await st()).carry.coal === 10, '첫 길은 눈길을 직접 걸음 (짐은 가방에 그대로)');
  ok(await page.evaluate(() => have('copper') === 0 && S.inv.copper === 7), '마을 밖에선 집 창고 것을 못 씀 (가방 것만)');
  if (shot) await page.screenshot({ path: path.join(shot, 'road.png') });
  // 길가 광석 바위 캐기
  const mr = await page.evaluate(() => { const f = S.forest; for (let y = 1; y < FH - 1; y++) for (let x = 1; x < FW - 1; x++) if (f.t[fI(x, y)] === 'm') { for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) f.seen[fI(x + dx, y + dy)] = 1; const n = [[1, 0], [-1, 0], [0, 1], [0, -1]].find(([dx, dy]) => f.t[fI(x + dx, y + dy)] === 'g'); if (n) { hero.x = x + n[0]; hero.y = y + n[1]; return [x, y]; } } return null; });
  if (mr) {
    const p = await page.evaluate(([x, y]) => window.MinerDiary.forestSpot(x, y), mr); await page.mouse.click(p.x, p.y); await page.waitForTimeout(300);
    ok(await page.evaluate(([x, y]) => window.MinerDiary.fcell(x, y), mr) === 'g' && await page.evaluate(() => ['silver', 'iron', 'crystal'].some(k => S.carry[k] > 0)), '길가 광석 바위를 캐면 그 지역 광석 (눈길은 은, 철, 수정)');
  }
  await page.evaluate(() => { const f = S.forest; hero.x = f.zx + 2; hero.y = f.zy; for (let dy = -2; dy <= 2; dy++) for (let dx = -1; dx <= 3; dx++) f.seen[fI(f.zx + dx, f.zy + dy)] = 1; S.forest.t[fI(f.zx + 1, f.zy)] = 'g'; });
  { const p = await page.evaluate(() => window.MinerDiary.forestSpot(S.forest.zx, S.forest.zy)); await page.mouse.click(p.x, p.y); }
  await page.waitForFunction(() => window.MinerDiary.scene() === 'town', null, { timeout: 15000 });
  s = await st();
  ok(s.loc === 'mtn' && s.visited.mtn && (await quest()).includes('손수레'), '길 끝까지 걸으면 눈 덮인 산마을에 도착, 다음 퀘스트 「손수레 만들기」');
  await page.evaluate(() => { S.carry.coal = 10; });
  if (shot) await page.screenshot({ path: path.join(shot, 'town.png') });
  const tclick = async (x, y, sel) => { const p = await page.evaluate(([x, y]) => window.MinerDiary.townSpot(x, y), [x, y]); await page.mouse.click(p.x, p.y); await page.waitForSelector(sel, { timeout: 15000 }); };
  await tclick(13, 5, '#sheet [data-a="tsell"][data-o="coal"]');
  const gTs = (await st()).gold;
  await page.click('#sheet [data-a="tsell"][data-o="coal"]');
  ok((await st()).gold === gTs + 10 * Math.round(6 * 2) && !(await st()).carry.coal, '산마을 시장은 석탄을 마을보다 두 배 비싸게 삼 (🪙12)');
  await page.click('#sheet [data-a="close"]');
  await tclick(9, 12, '#sheet [data-a="townmine"]');
  await page.click('#sheet [data-a="townmine"]');
  await page.waitForFunction(() => window.MinerDiary.scene() === 'mine', null, { timeout: 5000 });
  s = await st();
  ok(s.deep.town === 'mtn' && s.deepMain && !s.deepMain.town && (await page.textContent('#minebar')).includes('산 '), '산 광산은 마을 광산과 따로 (한 구역 깊게 시작)');
  ok(await page.evaluate(() => { const L = S.deep.L; let ores = {}; for (let y = -20; y <= 20; y++) for (let x = -20; x <= 20; x++) { const o = dOre(L, x, y); if (o) ores[o] = 1; } return ores.silver || ores.crystal; }), '산 광산엔 은과 수정이 많음');
  await page.click('[data-a="leave"]');
  await page.waitForFunction(() => window.MinerDiary.scene() === 'town', null, { timeout: 20000 });
  ok(!(await st()).deep.town && !(await st()).deepMain, '산 광산에서 나오면 산마을로, 광산 기록도 원래대로');
  const dIn = (await st()).day, gIn = (await st()).gold;
  await tclick(5, 5, '#sheet [data-a="inn"]');
  await page.click('#sheet [data-a="inn"]');
  s = await st();
  ok(s.day === dIn + 1 && s.gold === gIn - 50 && await page.evaluate(() => window.MinerDiary.scene()) === 'town', '여관에서 🪙50에 자면 다음 날 산마을에서 시작');
  await page.click('#sheet [data-a="close"]');
  // 여관 창고: 이 마을 안에서만 씀
  await page.evaluate(() => { S.carry.iron = 4; });
  await tclick(5, 5, '#sheet [data-a="store"]');
  await page.click('#sheet [data-a="store"]');
  await page.click('#sheet [data-a="stAll"]');
  ok(await page.evaluate(() => S.stash.mtn.iron === 4 && !S.carry.iron && have('iron') === 4), '여관 창고에 넣은 것은 산마을 안에서는 들고 있지 않아도 씀');
  await page.click('#sheet [data-a="close"]');
  await page.click('#minebar [data-a="world"]');
  await page.click('#sheet [data-a="travel"][data-o="home"]');
  await page.waitForFunction(() => window.MinerDiary.scene() === 'village', null, { timeout: 5000 });
  await page.evaluate(() => showWorld());
  ok(await page.locator('#sheet [data-a="travel"][data-o="mtn"]').count() === 1, '한 번 가 본 마을은 지도에서 기력만 내고 바로 감');
  await page.click('#sheet [data-a="close"]');
  await page.waitForFunction(() => window.MinerDiary.scene() === 'village', null, { timeout: 5000 });
  ok((await st()).loc === 'home', '지도에서 마을로 돌아옴 (성벽 문 앞)');
  ok(await page.evaluate(() => have('iron') === (S.inv.iron || 0) + (S.carry.iron || 0) && S.stash.mtn.iron === 4), '산마을 여관 창고 것은 처음 마을에서 못 씀');
  // 이동수단: 손수레(대장간)는 길 기력 15와 가방 +10, 당나귀 수레(산마을 시장)는 길 기력 5와 가방 +20
  await page.evaluate(() => { S.inv.wood = (S.inv.wood || 0) + 20; S.inv.ironBar = (S.inv.ironBar || 0) + 3; S.gold += 500; renderHud(); });
  await smithy('tool');
  await page.click('#sheet [data-a="craft"][data-o="cart"]');
  const wk = await page.evaluate(() => Math.ceil(roadSteps('mtn') / F_STEP));
  ok((await st()).cart === 1 && await page.evaluate(w => travelCost('mtn') === Math.ceil(w * .6) && travelCost('mtn') < w && bagCap() === 30, wk), `바로 가기 기력은 길을 가장 짧게 걸을 때 기력(${wk}), 손수레면 6할에 가방 30칸`);
  ok((await quest()).includes('야시장'), '손수레를 만들면 다음 퀘스트 「저녁 야시장 거래」');
  await page.click('#sheet [data-a="close"]');
  await page.evaluate(() => { S.gold += 3000; enterTown('mtn', 'road'); showTownObj(TOWN_OBJ[1]); });
  await page.click('#sheet [data-a="donkey"]');
  ok((await st()).donkey === 1 && await page.evaluate(w => travelCost('mtn') === Math.ceil(w * .2) && bagCap() === 40, wk), '산마을 시장에서 당나귀 수레를 사면 길 기력 2할, 가방 40칸');
  await page.evaluate(() => { closeSheet(); homeFromTown(); });
  // 다른 마을: 항구(박물관 뒤)와 화산 기슭(깊이 12 뒤), 세 마을을 다 가 보면 광차 철길
  await page.evaluate(() => { S.restored.push('museum'); S.deepest = Math.max(S.deepest, 12); S.energy = S.max; showWorld(); });
  ok(await page.locator('#sheet [data-a="walk"][data-o="port"]').count() === 1 && await page.locator('#sheet [data-a="walk"][data-o="volcano"]').count() === 1, '박물관을 고치면 항구 마을, 깊이 12면 화산 기슭 마을이 지도에 생김');
  await page.evaluate(() => { S.carry = { crystalGem: 2 }; S.visited.port = 1; showWorld(); });
  await page.click('#sheet [data-a="travel"][data-o="port"]');
  ok(await page.evaluate(() => window.MinerDiary.trip()) === 'donkey', '가 본 마을로 바로 갈 땐 이동 장면 (당나귀 수레를 타고 감)');
  if (shot) await page.screenshot({ path: path.join(shot, 'trip.png') });
  ok((await page.evaluate(() => document.getElementById('skip').hidden)) === false, '이동 장면엔 오른쪽 아래 네모난 건너뛰기 단추');
  await page.click('#skip');
  await page.waitForFunction(() => window.MinerDiary.scene() === 'town' && S.loc === 'port', null, { timeout: 1500 });
  ok(await page.locator('#skip').isHidden(), '건너뛰기를 누르면 바로 도착');
  await page.evaluate(() => travel('home'));
  await page.waitForFunction(() => window.MinerDiary.scene() === 'village', null, { timeout: 3500 });
  ok(true, '건너뛰지 않아도 2초쯤 뒤 알아서 도착');
  await page.evaluate(() => { S.energy = S.max; enterTown('port', 'road'); S.inv.crystalGem = 0; S.carry = { crystalGem: 2 }; });
  const gPt = (await st()).gold;
  await page.evaluate(() => showTownObj(TOWN_OBJ[1]));
  await page.click('#sheet [data-a="tsell"][data-o="crystalGem"]');
  ok((await st()).gold === gPt + 2 * Math.round(180 * 1.6), '항구 마을은 보석을 1.6배에 삼');
  await page.evaluate(() => { closeSheet(); enterTownMine(); });
  ok(await page.evaluate(() => S.deep.town === 'port' && TOWNS.port.ores.flat().some(([k]) => k === 'pearl')), '바닷가 광산엔 진주');
  await page.evaluate(() => { leaveTownMine(); homeFromTown(); enterTown('volcano', 'road'); homeFromTown(); S.inv.ironBar = 20; S.inv.oldwood = 20; S.gold += 5000; showWorld(); });
  await page.click('#sheet [data-a="rail"]');
  ok((await st()).rail === 1 && await page.evaluate(() => travelCost('volcano') === 0), '세 마을을 다 가 본 뒤 광차 철길을 놓으면 길 기력 0');
  await page.evaluate(() => { S.rail = 0; S.donkey = 0; S.cart = 0; S.visited = { mtn: 1 }; S.restored = S.restored.filter(o => o !== 'museum'); applyRestored(); closeSheet(); });   // 뒤 시험을 위해 되돌림

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
  const gMu = (await st()).gold, coal0 = P(await st(), 'coal');
  for (let k = 0; k < 10; k++) await page.click('#sheet [data-a="donate"] >> nth=0');
  s = await st();
  ok(s.museum.length === 10 && s.gold === gMu + 500 + 300 && P(s, 'coal') === coal0 - 1 && !s.museum.some((o, i) => s.museum.indexOf(o) !== i), '10종을 하나씩 기증하면 🪙500 (퀘스트 보상 🪙300), 같은 것은 한 번만');
  await page.click('#sheet [data-a="close"]');

  // 13-0j. 옛 광부의 갱도: 깊이 5에 처음 가면 가까이에 옛 갱도 방이 생기고, 일지를 읽으면 이야기와 보상
  ok((await quest()).includes('항구 마을'), '박물관 다음 퀘스트 「항구 마을 가기」');
  await page.evaluate(() => { enterTown('port', 'road'); homeFromTown(); });
  ok((await quest()).includes('은 곡괭이'), '항구 마을에 다녀오면 다음 퀘스트 「은 곡괭이 만들기」');
  const lr = await page.evaluate(() => { S.energy = S.max; S.minE = S.dayStart = S.max; startDeep(5, 0, 1); const r = S.deep.lore[5]; startDeep(5, r[0], r[1] + 1); for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) seenSet(r[0] + dx, r[1] + dy); return r; });
  ok((await cell(lr[0] - 1, lr[1])).t === 'J' && (await cell(lr[0] + 1, lr[1])).t === 'T', '깊이 5에 처음 가면 옛 갱도 방(일지와 상자)이 생김');
  const gL = (await st()).gold;
  await tap(lr[0] - 1, lr[1]);
  await page.waitForSelector('#sheet h2:has-text("일지 1/5")', { timeout: 5000 });
  s = await st();
  ok(s.loreN === 1 && s.gold === gL + 300 && s.acc.have.firefly >= 1 && (await cell(lr[0] - 1, lr[1])).t === 'f', '일지를 읽으면 이야기 1/5와 🪙300, 반딧불 병');
  await page.click('#sheet [data-a="close"]');
  await page.evaluate(() => toVillage('home'));
  await visit('smithy', '#sheet [data-a="close"]');

  // 13-1. 장신구: 만들기, 합치기, 끼기
  await page.evaluate(() => { S.inv.fiber = 6; S.inv.wood = 4; S.acc.have.plumb = 1; S.gold += 200; renderHud(); });
  await smithy('tool');
  await page.click('#sheet [data-a="craft"][data-o="tent"]');
  ok((await st()).items.tent === 1, '대장간에서 풀실과 나뭇가지로 야영 천막을 만듦');
  await page.evaluate(() => showSmithy('fuse'));
  await page.click('#sheet [data-a="combine"][data-n="0"]');
  s = await st();
  ok(s.acc.have.guide === 1 && !s.acc.have.compass && !s.acc.have.plumb, '나침반과 깊이 추를 합치면 길잡이 나침반');
  await page.click('#sheet [data-a="close"]');
  await page.evaluate(() => showBag());
  ok(/소모품/.test(await page.textContent('#sheet')) && !/쓸 것/.test(await page.textContent('#sheet')), '가방의 쓰는 물건 칸 이름은 소모품');
  ok(await page.locator('#sheet [data-a="store"]').count() === 1, '마을 안에선 가방에서 바로 창고를 염 (기획 76번)');
  ok(await page.locator('#sheet .slot').count() === 3 && await page.locator('#sheet .slot.lock').count() === 3 - (await st()).acc.slots, '장신구 칸은 늘 세 칸, 안 열린 칸은 자물쇠');
  await page.click('#sheet .slot.lock');
  ok(/장신구 고리|깊이 10/.test(await page.textContent('#toast')), '잠긴 칸을 누르면 여는 방법');
  if ((await st()).acc.eq.length) {
    const eq0 = (await st()).acc.eq[0];
    ok(await page.locator(`#sheet .rowi[data-o="${eq0}"] .eff`).count() === 1, '끼운 장신구에도 효과 설명');
    await page.click(`#sheet .slot.on[data-o="${eq0}"]`);
    ok(await page.locator('#sheet .eff').count() >= 1 && await page.locator(`#sheet [data-a="unequip"][data-o="${eq0}"]`).count() === 1, '끼운 칸을 누르면 상세(효과)와 빼기 단추');
    await page.click(`#sheet [data-a="unequip"][data-o="${eq0}"]`);
    ok(!(await st()).acc.eq.includes(eq0), '빼기 단추를 누르면 장신구가 빠짐');
  }
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
  ok(s.screen === 'village' && s.items.recall === 0 && s.carry.copper >= 3, '귀환서를 쓰면 바로 마을, 가방은 그대로');
  await page.waitForTimeout(800);
  await visit('smithy', '#sheet [data-a="close"]');

  // 13-2b. 날씨 (기획 78번): 날짜로 정해지고 첫 이틀은 맑음, 비는 밭을 적시고, 가뭄은 작물 값을 올림, 위쪽 날짜 단추와 소식 창
  {
    const w = await page.evaluate(() => { closeSheet(); window.MinerDiary.setWx(null); const days = []; for (let d = 3; d < 400; d++) days.push(rollWx(d)); return { d12: rollWx(1) + rollWx(2), same: rollWx(9) === rollWx(9), kinds: [...new Set(days)].sort().join() }; });
    ok(w.d12 === 'clearclear' && w.same && w.kinds === 'clear,drought,fog,rain', `날씨는 날짜로 정해지고 첫 이틀은 맑음, 넷이 다 나옴 (${w.kinds})`);
    const r = await page.evaluate(() => { const day0 = S.day, e0 = S.energy; S.farm['0,0'] = { crop: 'radish', days: 0, watered: false }; window.MinerDiary.setWx('rain'); newDay('normal'); const wet = S.farm['0,0'].watered; delete S.farm['0,0']; S.day = day0; S.energy = S.minE = S.dayStart = e0; return wet; });
    ok(r, '비 오는 아침엔 밭이 저절로 젖음');
    const pr = await page.evaluate(() => { if (!S.market) return null; window.MinerDiary.setWx('clear'); const a = unitPrice('radish'); window.MinerDiary.setWx('drought'); const b = unitPrice('radish'); return b / a; });
    ok(pr === null || Math.abs(pr - 1.4) < .05, `가뭄엔 작물 시세 1.4배 (${pr && pr.toFixed(2)})`);
    await page.evaluate(() => { window.MinerDiary.setWx('fog'); closeSheet(); });
    ok(await page.locator('#hud .day .wxi').count() === 1, '맑지 않은 날엔 위쪽 날짜 단추에 날씨 그림');
    await page.click('#hud [data-a="news"]');
    ok(/오늘 안개/.test(await page.textContent('#sheet')) && /내일/.test(await page.textContent('#sheet')), '날짜 단추를 누르면 오늘과 내일 날씨');
    if (shot) await page.screenshot({ path: path.join(shot, 'weather-fog.png') });
    await page.evaluate(() => { closeSheet(); window.MinerDiary.setWx('clear'); });
  }

  // 13-2c. 큰 이야기 (기획 79번): 일지 다섯, 깊이 30의 산의 심장, 바치면 엔딩과 광장 축제 등불
  {
    ok(await page.evaluate(() => LORE_N === 5 && !!LORE[18] && !!LORE[24]), '옛 광부 일지는 다섯 (깊이 5, 8, 12, 18, 24)');
    const hz = await page.evaluate(() => { closeSheet(); S.energy = S.max; S.minE = S.dayStart = S.max; startDeep(30, 0, 1); const h = S.deep.heart; startDeep(30, h[0], h[1] + 1); for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) seenSet(h[0] + dx, h[1] + dy); return h; });
    ok((await cell(hz[0], hz[1])).t === 'Q', '깊이 30에 처음 가면 가까이에 산의 심장 방이 생김');
    await tap(hz[0], hz[1]);
    await page.waitForSelector('#sheet h2:has-text("산의 심장")', { timeout: 5000 });
    ok(await page.locator('#sheet [data-a="calmHeart"]').isDisabled() && (await st()).heartSeen === 1, '심장에 가면 바칠 것(월광 주괴, 루비 보석, 수정 보석)이 보이고, 모자라면 못 바침');
    await page.evaluate(() => { Object.assign(S.carry, { moonBar: 3, rubyGem: 2, crystalGem: 3 }); showHeart(); });
    await page.click('#sheet [data-a="calmHeart"]');
    ok((await st()).heartCalm > 0 && (await page.textContent('#sheet h2')).includes('산의 심장') && await page.locator('#sheet [data-a="close"]').count() === 0, '바치면 심장이 잠들고 엔딩 이야기가 시작됨 (도중엔 닫기 없음)');
    for (let k = 0; k < 6; k++) await page.click('#sheet [data-a="ending"]:not(:has-text("이전"))');
    ok((await page.textContent('#sheet')).includes('마을이 다시 숨을 쉼') && (await page.textContent('#sheet')).includes('지난 날'), '엔딩 끝엔 기록 카드');
    await page.click('#sheet [data-a="endingDone"]');
    if (shot) await page.screenshot({ path: path.join(shot, 'heart.png') });
    await page.evaluate(() => toVillage('home'));
    await page.waitForTimeout(300);
    ok(await page.evaluate(() => S.heartCalm > 0 && window.MinerDiary.scene() === 'village'), '엔딩 뒤에도 계속 놀 수 있고 광장에 축제 등불');
  }

  // 13-3. 곡괭이 조합 (기획 71번): 자루와 추가 재료, 금 곡괭이 다음 특수 곡괭이와 도감, 곡괭이질 빠르기
  {
    const sp0 = await page.evaluate(() => { closeSheet(); S.pick = 3; S.pickQ = 0; S.pk = { handle: 'wood', adds: [], head: null, sp: null }; const s0 = swingSpd();
      Object.assign(S.inv, { goldBar: 5, oldwood: 2, fiber: 5, coal: 3, rubyGem: 5, bone: 3, ruby: 1, manastone: 1 }); S.gold += 9000; renderHud(); return s0; });
    await smithy('pick');
    await page.click('#sheet [data-a="forge"]');
    ok(await page.locator('#sheet .drawer').count() === 0 && await page.locator('#sheet .bslot[data-o="a1"]').count() === 1 && await page.locator('#sheet canvas[data-pick]').count() === 1 && (await page.textContent('#sheet .stats3')).includes('빠르기'), '곡괭이 공방: 작업대 가운데 곡괭이 그림과 둘레 칸, 세기 막대, 금 곡괭이부터 재료칸 둘 (기획 73번)');
    await page.click('#sheet [data-a="fslot"][data-o="handle"]');
    const hl = await page.evaluate(() => { const ids = [...document.querySelectorAll('#sheet .drawer [data-k="handle"]')].map(b => b.dataset.o); return { t: ids.join(), ok: ids.includes('oldwood') && ids.includes('bone') && ids.every(id => !HANDLES[id].k || have(HANDLES[id].item) > 0) && Object.keys(HANDLES).every(id => ids.includes(id) || have(HANDLES[id].item) === 0) }; });
    ok(hl.ok, `자루칸을 누르면 아래에서 가진 자루만 목록으로 (${hl.t})`);
    ok(await page.evaluate(() => { sheet.scrollTop = 9999; const h = document.querySelector('#sheet > header').getBoundingClientRect(), sh = sheet.getBoundingClientRect(); return h.top >= sh.top - 1 && h.top < sh.top + 30; }), '목록이 올라와 창 안이 스크롤돼도 제목 줄과 닫기 단추는 맨 위에 그대로');
    await page.click('#sheet [data-a="fsel"][data-k="handle"][data-o="oldwood"]');
    ok(await page.locator('#sheet .drawer').count() === 0, '고르면 목록이 닫히고 칸에 들어감');
    await page.click('#sheet [data-a="fslot"][data-o="a0"]');
    await page.click('#sheet [data-a="fsel"][data-k="add"][data-o="fiber"]');
    await page.click('#sheet [data-a="fslot"][data-o="a1"]');
    await page.click('#sheet [data-a="fsel"][data-k="add"][data-o="coal"]');
    await page.click('#sheet [data-a="forgeGo"]');
    for (let k = 0; k < 3; k++) {
      await page.evaluate(() => new Promise(r => { const f = () => { const n = window.MinerDiary.needle(); if (n !== null && Math.abs(n - .5) < .03) { document.querySelector('#sheet [data-a="strike"]').click(); r(); } else requestAnimationFrame(f); }; f(); }));
    }
    await page.waitForSelector('#sheet h2:has-text("대장장이")', { timeout: 3000 });
    const r1 = await page.evaluate(() => ({ pick: S.pick, h: S.pk.handle, a: S.pk.adds.slice().sort().join(), spd: swingSpd(), oldwood: have('oldwood'), fiber: have('fiber') }));
    ok(r1.pick === 4 && r1.h === 'oldwood' && r1.a === 'coal,fiber' && Math.abs(r1.spd - sp0 - .1 - .1 - .08) < 1e-9 && !r1.oldwood && !r1.fiber, `고목 자루와 풀실로 곡괭이질 빠르기가 오름 (${Math.round((1 + r1.spd) * 100)}%, 품질 최상 +10%)`);
    await smithy('pick');
    await page.click('#sheet [data-a="codex"]');
    ok((await page.textContent('#sheet')).includes('0/8') && (await page.locator('#sheet .card.unk').count()) === 8, '금 곡괭이 다음엔 특수 곡괭이 만들기와 그림자 카드 여덟 장의 도감');
    await page.click('#sheet [data-a="smithyBack"]');
    const atk0 = await page.evaluate(() => power());
    await page.click('#sheet [data-a="forgeSp"]');
    for (const [slot, k, o] of [['head', 'head', 'ruby'], ['handle', 'handle', 'bone'], ['a0', 'add', 'ruby'], ['a1', 'add', 'manastone']]) { await page.click(`#sheet [data-a="fslot"][data-o="${slot}"]`); await page.click(`#sheet [data-a="fsel"][data-k="${k}"][data-o="${o}"]`); }
    await page.click('#sheet [data-a="forgeGo"]');
    for (let k = 0; k < 3; k++) {
      await page.evaluate(() => new Promise(r => { const f = () => { const n = window.MinerDiary.needle(); if (n !== null && Math.abs(n - .5) < .03) { document.querySelector('#sheet [data-a="strike"]').click(); r(); } else requestAnimationFrame(f); }; f(); }));
    }
    await page.waitForSelector('#sheet h2:has-text("대장장이")', { timeout: 3000 });
    const r2 = await page.evaluate(() => ({ sp: S.pk.sp, q: S.spc.hunter, atk: power(), pick: S.pick, gem: have('rubyGem') }));
    ok(r2.sp === 'hunter' && r2.q === 2 && r2.pick === 4 && !r2.gem && r2.atk === (9 + 2 + 3) * 2 && (await page.textContent('#sheet')).includes('도감에 새 곡괭이'), `루비 머리, 뼈 자루, 루비, 마석으로 사냥꾼 곡괭이 (공격 ${atk0} 다음 ${r2.atk})`);
    const noRe = await page.evaluate(() => { closeSheet(); S.spc.bolt = 0; showSpCard('hunter'); return !document.querySelector('#sheet [data-a="spHammer"]'); });
    await page.evaluate(() => showCodex());
    ok(noRe && (await page.textContent('#sheet')).includes('2/8') && await page.locator('#sheet .card.eq').count() === 1 && await page.locator('#sheet .card.unk').count() === 6, '도감 카드: 든 곡괭이는 표시, 최상은 다시 망치질 단추가 없음');
    await page.click('#sheet [data-a="spCard"][data-o="bolt"]');
    await page.click('#sheet [data-a="spEquip"][data-o="bolt"]');
    const r3 = await page.evaluate(() => ({ sp: S.pk.sp, spd: swingSpd(), q: S.pickQ }));
    ok(r3.sp === 'bolt' && r3.q === 0 && Math.abs(r3.spd - Math.min(.4, sp0 + .25 + .08)) < 1e-9, `번개 곡괭이를 들면 곡괭이질 빠르기 ${Math.round((1 + r3.spd) * 100)}% (최대 140%)`);
    await page.click('#sheet [data-a="spCard"][data-o="bolt"]');
    await page.click('#sheet [data-a="spHammer"][data-o="bolt"]');
    for (let k = 0; k < 3; k++) {
      await page.evaluate(() => new Promise(r => { const f = () => { const n = window.MinerDiary.needle(); if (n !== null && Math.abs(n - .5) < .03) { document.querySelector('#sheet [data-a="strike"]').click(); r(); } else requestAnimationFrame(f); }; f(); }));
    }
    await page.waitForSelector('#sheet h2:has-text("대장장이")', { timeout: 3000 });
    ok(await page.evaluate(() => S.spc.bolt === 2 && S.pickQ === 2 && S.pk.adds.includes('fiber')), '다시 망치질하면 재료와 효과는 그대로 두고 품질만 오름');
    // 곡괭이 걸이 (기획 74번): 마을 아래 단추로 언제든 바꿔 듦
    await page.evaluate(() => { closeSheet(); renderDock(); });
    ok(await page.locator('#dock [data-a="rack"]').count() === 1, '특수 곡괭이가 생기면 마을 아래에 곡괭이 걸이 단추');
    await page.click('#dock [data-a="rack"]');
    ok(await page.locator('#sheet [data-a="rackPick"]').count() === 3 && await page.locator('#sheet .card.eq').count() === 1, '곡괭이 걸이엔 보통 곡괭이 하나와 만든 특수 곡괭이 둘');
    await page.click('#sheet [data-a="rackPick"][data-o="base"]');
    ok(await page.evaluate(() => !S.pk.sp && S.pk.handle === 'oldwood' && S.pk.adds.slice().sort().join() === 'coal,fiber' && S.pickQ === 2 && pickName() === '금 곡괭이'), '걸이에서 보통 곡괭이로 바꾸면 자루와 재료, 품질이 그대로 돌아옴');
    await page.click('#sheet [data-a="rackPick"][data-o="hunter"]');
    ok(await page.evaluate(() => S.pk.sp === 'hunter' && power() === 28), '걸이에서 사냥꾼 곡괭이로 바꿔 듦');
    await page.evaluate(() => closeSheet());
    await visit('smithy', '#sheet [data-a="close"]');
  }

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

  /* ===== 돌발 이벤트: 처음 운석은 3일차 아침에 촌장이 알림, 숲에서 캐면 운석 조각. 시세 폭등은 하루 전에 알리고 다음 날부터 시장 값 두 배 ===== */
  {
    const ev = await open(390, 844);
    await ev.evaluate(() => { evQuiet = false; closeSheet(); S.introSeen = true; S.day = 2; window.MinerDiary.speed(10); sleep(false); });
    ok((await ev.textContent('#sheet')).includes('별똥별') && await ev.evaluate(() => window.MinerDiary.events().some(e => e.k === 'meteor' && e.from === S.day)), '3일차 아침 촌장이 숲에 떨어진 별똥별을 알림 (첫 운석은 정한 날)');
    ok(await ev.locator('#hud .evdot').count() === 1, '소식이 있으면 날짜 단추에 점');
    await ev.evaluate(() => closeSheet()); await ev.click('#hud [data-a="news"]');
    ok((await ev.textContent('#sheet')).includes('운석'), '날짜 단추를 누르면 소식 창에 운석');
    const mp = await ev.evaluate(() => { closeSheet(); enterForest(); const e = window.MinerDiary.events().find(o => o.k === 'meteor'); for (let i = 0; i < S.forest.seen.length; i++) S.forest.seen[i] = 1; return S.forest.t[fI(e.x, e.y)] === 'M' ? [e.x, e.y] : null; });
    ok(!!mp, '숲 열린 구역 풀밭에 운석이 떨어져 있음');
    ok(await ev.evaluate(() => { const e = window.MinerDiary.events().find(o => o.k === 'meteor'), f = S.forest, n = METEOR[e.size].n, z = fZone(e.x), x1 = (z ? F_ZONES[z - 1].x : FW) - 1, [cx, cy] = mCenter(e);
      let far = true; for (let y = 0; y < FH; y++) for (let x = 0; x < FW; x++) if ('voxz'.includes(f.t[fI(x, y)]) && Math.hypot(x - cx, y - cy) <= 3 + n / 2) far = false;
      return e.x >= F_ZONES[z].x + 3 && e.x + n - 1 <= x1 - 3 && e.y >= 3 && e.y + n - 1 <= FH - 4 && far; }), '운석은 구역 경계와 숲 가장자리에서 3칸 안쪽, 동굴 입구와 들머리 둘레엔 안 떨어짐');
    ok(await ev.evaluate(() => { const d0 = S.day; for (let i = 0; i < 40; i++) { S.day++; evMorning(); } const ms = S.ev.list.filter(o => o.k === 'meteor'); S.day = d0; return ms.length === 1 && !ms[0].dug; }), '다 캐기 전엔 운석이 사라지지 않고 새 운석도 안 떨어짐');
    const big = await ev.evaluate(([x, y]) => { const e = window.MinerDiary.events().find(o => o.k === 'meteor'), m = S.fmem.main; S.energy = S.max; return { cells: S.forest.t.filter(t => t === 'M').length, size: e.size, crater: (m.craters || []).length, debris: Object.values(S.forest.it).filter(v => v === 'debris').length, open: ['t', 's', 'k'].every(t => S.forest.t[fI(x + 1, y)] !== t) }; }, mp);
    ok(big.size === 'b' && big.cells === 9 && big.crater === 1 && big.debris >= 8, `첫 운석은 3×3 칸 큰 운석: 둘레가 패어 구덩이, 잔해 ${big.debris}개`);
    const hits = [];
    for (let k = 0; k < 17; k++) {
      const p = await ev.evaluate(([x, y]) => window.MinerDiary.forestSpot(x, y), mp); await ev.mouse.click(p.x, p.y); await ev.waitForTimeout(80); await ev.waitForFunction(() => !window.MinerDiary.hero().moving, null, { timeout: 30000 }); await ev.waitForTimeout(60);
      hits.push(await ev.evaluate(() => window.MinerDiary.events().find(o => o.k === 'meteor').hp));
      if (hits[hits.length - 1] === 0) break;
    }
    ok(hits.join() === '14,13,12,11,10,9,8,7,6,5,4,3,2,1,0' && await ev.evaluate(([x, y]) => S.carry.meteor === 8 && !S.forest.t.includes('M') && window.MinerDiary.events().find(o => o.k === 'meteor').dug, mp), `큰 운석은 열다섯 번 쳐서 깸, 조각은 모두 여덟 (${hits.join()})`);
    const db = await ev.evaluate(() => { const k = Object.keys(S.forest.it).find(k2 => S.forest.it[k2] === 'debris'); const [x, y] = k.split(',').map(Number); const n0 = carryN(); gather(x, y); return carryN() === n0 + 1 && !S.forest.it[k]; });
    ok(db, '운석 잔해를 주우면 광석 하나');
    ok(await ev.evaluate(() => { const g = genForest(S.day + 1); return (S.fmem.main.craters || []).length === 1 && Object.values(g.it).some(v => v === 'debris'); }), '구덩이와 남은 잔해는 다음 날에도 그대로');
    const bo = await ev.evaluate(() => { leaveForest(); S.restored.push('market'); S.ev.list = []; window.MinerDiary.quietEvents(); window.MinerDiary.evAdd('boom'); return window.MinerDiary.events().find(o => o.k === 'boom'); });
    ok(bo && bo.from === bo.warn + 1 && bo.to === bo.from + 2 && await ev.evaluate(o => boomK(o) === 1, bo.ore), '시세 폭등은 알린 다음 날부터 사흘');
    await ev.evaluate(() => { closeSheet(); sleep(false); closeSheet(); if (!S.market) rollMarket(true); S.market.sold = {}; });
    ok(await ev.evaluate(o => boomK(o) === 2 && unitPrice(o) === Math.round(ORES[o].price * S.market.mult[o] * 2), bo.ore), '다음 날 시장에서 그 광석 값이 두 배');
    await ev.evaluate(o => { S.carry[o] = 1; showMarket(); }, bo.ore);
    ok((await ev.textContent('#sheet')).includes('값 두 배'), '시장 창에 「값 두 배」 소식');
    // 몬스터 습격: 모레 저녁이라고 알리고, 그날 저녁 성벽 문에서 두 무리를 막으면 보상. 못 막으면 건물 하나가 부서지고 고쳐야 씀
    const evening = () => ev.evaluate(() => { S.minE = S.dayStart - S.max * .62; renderHud(); });
    await ev.evaluate(() => { closeSheet(); OBJ.forEach(o => { if (['gate', 'smithy', 'market', 'kitchen'].includes(o.id)) { o.done = true; o.grow = 1; if (!S.restored.includes(o.id)) S.restored.push(o.id); } }); S.huntClear = { home: { 0: 1 } }; S.ev.list = []; window.MinerDiary.evAdd('raid'); });
    let rd = await ev.evaluate(() => window.MinerDiary.events().find(o => o.k === 'raid'));
    ok(rd && rd.from === rd.warn + 2, '습격은 이틀 뒤 저녁 (미리 알림)');
    await ev.evaluate(() => { sleep(false); }); await ev.evaluate(() => { closeSheet(); sleep(false); });
    ok((await ev.textContent('#sheet')).includes('오늘 저녁에 몬스터'), '습격 날 아침에 촌장이 다시 알림');
    await ev.evaluate(() => closeSheet()); await evening();
    await ev.evaluate(() => showCard(OBJ.find(o => o.id === 'gate')));
    await ev.click('#sheet [data-a="raid"]');
    ok(await ev.evaluate(() => S.hunt && S.hunt.raid && S.hunt.mons.length === 3), '저녁에 성벽 문 「막기」로 습격 싸움 (첫 무리 셋)');
    await ev.evaluate(() => { S.hunt.mons.forEach(m => { m.hp = 0; }); });
    await ev.waitForFunction(() => S.hunt && S.hunt.wave === 1 && S.hunt.mons.some(m => m.hp > 0), null, { timeout: 5000 });
    await ev.evaluate(() => { S.hunt.mons.forEach(m => { m.hp = 0; }); });
    await ev.waitForSelector('#sheet [data-a="leaveHunt"]', { timeout: 5000 });
    ok((await ev.textContent('#sheet')).includes('습격을 막음') && await ev.evaluate(() => window.MinerDiary.events().find(o => o.k === 'raid').won), '둘째 무리까지 잡으면 「습격을 막음」');
    await ev.click('#sheet [data-a="leaveHunt"]');
    await ev.evaluate(() => { S.ev.list = []; window.MinerDiary.evAdd('raid'); sleep(false); closeSheet(); sleep(false); closeSheet(); sleep(false); });
    ok((await ev.textContent('#sheet')).includes('부서진 곳') && await ev.evaluate(() => Object.keys(S.damaged || {}).length === 1), '못 막고 날이 지나면 건물 하나가 부서짐');
    const dmg = await ev.evaluate(() => { closeSheet(); const id = Object.keys(S.damaged)[0]; S.gold += 300; S.carry.wood = 10; showCard(OBJ.find(o => o.id === id)); return id; });
    ok((await ev.textContent('#sheet')).includes('부서진'), '부서진 건물을 누르면 고치기 창');
    await ev.click('#sheet [data-a="fix"]');
    ok(await ev.evaluate(id => !S.damaged[id], dmg), '🪙200과 나뭇가지 10으로 고침');
    await ev.close();
  }

  /* ===== 숲 몬스터: 초입엔 없고, 깊은 숲은 밤에만, 오래된 숲부터는 늘 나옴. 눌러서 잡음 ===== */
  {
    const fp = await open(390, 844);
    const r1 = await fp.evaluate(() => { closeSheet(); S.introSeen = true; S.pick = 2; window.MinerDiary.speed(10); S.forestOpen = { 1: 1 }; enterForest(); const day = S.forest.mons.length; leaveForest(); S.forestOpen = { 1: 1, 2: 1 }; enterForest(); const f = S.forest; return { day, n: f.mons.length, deep: f.mons.every(m => m.x < F_ZONES[1].x) }; });
    ok(r1.day === 0 && r1.n >= 3 && r1.deep, '숲 초입과 낮의 깊은 숲엔 몬스터가 없고, 오래된 숲엔 늑대가 있음');
    const wp = await fp.evaluate(() => { const f = S.forest, m = f.mons[0]; f.mons.forEach(o => { if (o !== m) o.hp = 0; }); const hx = Math.round(hero.x), hy = Math.round(hero.y); for (let i = 0; i < f.seen.length; i++) f.seen[i] = 1; for (let y = hy - 3; y <= hy; y++) for (let x = hx - 3; x <= hx; x++) if (fIn(x, y) && f.t[fI(x, y)] !== 'x') f.t[fI(x, y)] = 'g'; m.x = m.wx = hx - 2; m.y = m.wy = hy - 2; m.cd2 = 99; return [m.x, m.y, m.id]; });
    { const p = await fp.evaluate(([x, y]) => window.MinerDiary.forestSpot(x, y), wp); await fp.mouse.click(p.x, p.y); }
    await fp.waitForFunction(id => S.forest.mons.find(o => o.id === id).hp <= 0, wp[2], { timeout: 15000 });
    ok(await fp.evaluate(() => (S.killN || 0) >= 1 && window.MinerDiary.scene() === 'forest'), '숲 몬스터를 누르면 다가가 휘둘러 잡음');
    await fp.close();
  }

  /* ===== 집으로 바로 가기: 땅속(두 층)과 숲에서, 가장 짧은 길로 마을 들머리까지 걸을 때 드는 기력만큼 쓰고 집 앞으로 ===== */
  {
    const hp = await open(390, 844);
    await hp.evaluate(() => { closeSheet(); S.introSeen = true; S.restored.push('mine'); applyRestored(); window.MinerDiary.speed(10); enterMine(); });
    await hp.waitForFunction(() => window.MinerDiary.scene() === 'mine', null, { timeout: 15000 });
    const c1 = await hp.evaluate(() => {   // 깊이 1에서 오른쪽으로 긴 굴을 판 뒤 깊이 2로 내려가 그 아래로 더 감
      for (let x = 0; x <= 30; x++) { S.deep.dug[dKey(1, x, 1)] = 'f'; seenSet(x, 1); }
      S.deep.dug[dKey(1, 30, 1)] = 'd'; hero.x = 30; hero.y = 1; descendAt(30, 1);
      for (let y = 2; y <= 12; y++) { S.deep.dug[dKey(2, 30, y)] = 'f'; seenSet(30, y); }
      hero.x = 30; hero.y = 12; hero.path = []; S.deep.steps = 0; renderDock();
      return homeCost();
    });
    ok(c1 === Math.floor((11 + 30 + 1) / 8), `땅속 두 층에서 집까지 바로 가기 기력은 길 걸음 기력 (${c1})`);
    ok(await hp.evaluate(() => { const L = S.deep.L, x0 = hero.x, y0 = hero.y; for (let y = 12; y <= 130; y++) { S.deep.dug[dKey(2, 30, y)] = 'f'; seenSet(30, y); } hero.x = 30; hero.y = 130; const c = homeCost(); hero.x = x0; hero.y = y0; return c === Math.floor((129 + 31) / 8); }), '입구에서 100칸 넘게 떨어져도 지나온 길이면 길을 앎');
    await hp.click('#minebar [data-a="homeFastAsk"]');
    const e0 = await hp.evaluate(() => S.energy);
    await hp.click('#sheet [data-a="homeFast"]');
    ok(await hp.locator('#skip').isVisible(), '바로 가기는 이동 장면');
    await hp.click('#skip');
    ok(await hp.evaluate(([e0, c]) => window.MinerDiary.scene() === 'village' && Math.round(hero.x) === HOME[0] && Math.round(hero.y) === HOME[1] && S.energy === e0 - c, [e0, c1]), '건너뛰면 집 앞, 기력은 그만큼만 듦');
    const c2 = await hp.evaluate(() => { enterForest(); const f = S.forest; hero.x = f.ex - 12; hero.y = f.ey; f.t[fI(hero.x, hero.y)] = 'g'; for (let x = f.ex - 12; x <= f.ex; x++) f.t[fI(x, f.ey)] = f.t[fI(x, f.ey)] === 'x' ? 'x' : 'g'; f.steps = 0; renderDock(); return homeCost(); });
    ok(c2 === Math.floor(12 / 5), `숲에서도 바로 가기 기력은 숲 걸음 기력 (${c2})`);
    await hp.click('#minebar [data-a="homeFastAsk"]'); await hp.click('#sheet [data-a="homeFast"]'); await hp.click('#skip');
    ok(await hp.evaluate(() => window.MinerDiary.scene() === 'village' && Math.round(hero.x) === HOME[0]), '숲에서도 집 앞으로');
    await hp.close();
  }

  /* ===== 숲 모양은 그대로, 채집물만 날마다. 굴 모양과 층은 그대로, 광석만 사흘마다 조금씩 ===== */
  {
    const gp = await open(390, 844);
    const r = await gp.evaluate(() => {
      closeSheet(); S.introSeen = true; S.sickle = 1;
      const a = genForest(S.day), at = a.t.slice(), base = Object.keys(a.it).length;
      Object.keys(a.it).forEach(k => delete a.it[k]);   // 다 주웠다고 치고 다음 날
      const b = genForest(S.day + 1), same = at.every((t, i) => t === b.t[i]), n1 = Object.keys(b.it).length;
      const c10 = genForest(S.day + 30), n10 = Object.keys(c10.it).length;
      const itDiff = n1 >= base * .4 && n1 <= base * .6 && n10 <= base * 2.2 && n10 > n1;   // 날마다 하루치 수가 조금씩 달라 넉넉히 봄
      enterForest(); const f = S.forest; f.seen[fI(40, 3)] = 1; cutThorn(40, 3); f.seen[fI(10, 10)] = 1;
      const c = genForest(S.day + 33);
      return { same, itDiff, cut: c.t[fI(40, 3)] === 'g', seen: c.seen[fI(10, 10)] === 1 };
    });
    ok(r.same && r.itDiff, '숲 모양은 날이 바뀌어도 같고, 채집물은 날마다 하루치의 절반씩 쌓여 두 배까지만');
    ok(r.cut && r.seen, '쳐 낸 가시덤불과 본 곳은 다음 날에도 그대로');
    const cv = await gp.evaluate(() => {
      leaveForest(); enterForest(); enterCave(); const D = S.deep;
      for (let x = 1; x <= 8; x++) { D.dug[dKey(0, x, 0)] = 'f'; for (let y = -1; y <= 1; y++) seenSet(x, y); }
      for (let x = 1; x <= 8; x++) for (const y of [-1, 1]) { D.dug[dKey(0, x, y)] = 'r'; D.ore = D.ore || {}; D.ore[dKey(0, x, y)] = ''; }
      for (let y = -16; y <= 16; y++) for (let x = -16; x <= 16; x++) if (Math.abs(y) > 1 || x > 8 || x < 1) D.ore[dKey(0, x, y)] = '';   // 다 캐 간 숲 동굴
      const before = Object.keys(D.ore).filter(k => D.ore[k]).length;
      leaveCave(); leaveForest(); S.day = 2; sleep(false); closeSheet();
      const after = Object.keys(D.ore).filter(k => D.ore[k]).length;
      const grew = after - before; for (let k = 0; k < 40; k++) regrowOre(D); const capped = Object.keys(D.ore).filter(k => D.ore[k]).length;
      let first = 0; S.deep = D; D.L = 0; for (let y = -16; y <= 16; y++) for (let x = -16; x <= 16; x++) if (dBase(0, x, y) === 'r' && dOre(0, x, y)) first++;
      return { kept: D.dug[dKey(0, 5, 0)] === 'f', grew, capped, first };
    });
    ok(cv.kept && cv.grew === 6, `사흘째 아침: 숲 동굴에 판 굴은 그대로, 굴 둘레 벽에 광석 여섯 (${cv.grew})`);
    ok(cv.capped <= cv.first, `숲 동굴 광석은 오래 둬도 처음 수까지만 (${cv.capped}/${cv.first})`);
    await gp.close();
  }

  /* ===== 숲길은 나무 사이로 트임, 건물은 그려진 곳만 눌림 ===== */
  {
    const wp = await open(390, 844);
    const fr = await wp.evaluate(() => { closeSheet(); S.introSeen = true; const f = genForest(S.day); const ed = f.edge.filter(i => f.t[i] === 'g').length / f.edge.length; let row = 0; for (let x = 4; x < 46; x++) if ('gB'.includes(f.t[fI(x, f.ey)]) || f.t[fI(x, f.ey)] === 'k') row++; return { ed, row, n: f.edge.length }; });
    ok(fr.n > 50 && fr.ed > .5, `숲길 옆은 대부분 트여 있음 (${Math.round(fr.ed * 100)}%)`);
    const hp2 = await wp.evaluate(() => { const o = OBJ.find(v => v.id === 'house'), z = hgt(o.gx, o.gy), up = ZU * 3.4, d = iso(o.gx, o.gy + o.d, z); follow = false; cam.fx = d[0] + 2; cam.fy = d[1] - up + 4; return { x: W / 2, y: H / 2 }; });
    await wp.mouse.click(hp2.x, hp2.y); await wp.waitForTimeout(150);
    ok(await wp.evaluate(() => !(selected && selected.id === 'house') && (window.MinerDiary.hero().moving || marks.some(m => m.col === '255,255,255' || m.col === '235,95,80'))), '집 지붕 옆 빈 곳(뒤로 땅이 보이는 곳)을 누르면 집이 아니라 땅이 눌림');
    const hp3 = await wp.evaluate(() => { closeSheet(); const o = OBJ.find(v => v.id === 'house'), m = iso(o.gx + o.w / 2, o.gy + o.d / 2, hgt(o.gx, o.gy)); cam.fx = m[0]; cam.fy = m[1] - ZU * 1.2; return { x: W / 2, y: H / 2 }; });
    await wp.mouse.click(hp3.x, hp3.y); await wp.waitForTimeout(150);
    ok(await wp.evaluate(() => selected && selected.id === 'house' || (hero.target && hero.target.id === 'house')), '집 그림 위를 누르면 집');
    await wp.close();
  }

  /* ===== 팔기 수량과 확정: 막대로 수량을 골라 팔고, 돈이나 물건이 빠지는 단추는 확정을 한 번 더 ===== */
  {
    const sp = await open(390, 844);
    await sp.evaluate(() => { window.MinerDiary.autoConfirm(false); closeSheet(); S.introSeen = true; S.carry = { copper: 6 }; showMerchant(); });
    await sp.click('#sheet [data-a="sell"][data-o="copper"]');
    ok(await sp.locator('#sheet input[data-sell]').count() === 1, '팔기를 누르면 수량 막대 창');
    await sp.evaluate(() => { const i = document.querySelector('#sheet input[data-sell]'); i.value = 2; i.dispatchEvent(new Event('input', { bubbles: true })); });
    ok((await sp.textContent('#sellv')) === String(await sp.evaluate(() => ORES.copper.price * 2)), '막대를 당기면 받을 돈이 바뀜');
    const g0 = await sp.evaluate(() => S.gold);
    await sp.click('#sheet [data-a="sellDo"]');
    ok(await sp.evaluate(g0 => S.carry.copper === 4 && S.gold === g0 + ORES.copper.price * 2, g0), '확정을 누르면 고른 수량(2개)만 팔림');
    await sp.evaluate(() => { S.gold = 1000; showMerchant('buy'); });
    const b0 = await sp.evaluate(() => S.gold);
    await sp.click('#sheet [data-a="buy"]:not([disabled])');
    ok(await sp.locator('#sheet [data-a="cfOk"]').count() === 1 && await sp.evaluate(b0 => S.gold === b0, b0), '사기를 누르면 확정 창이 먼저 뜨고 돈은 아직 그대로');
    await sp.click('#sheet [data-a="cfBack"]');
    ok(await sp.locator('#sheet [data-a="buy"]').count() > 0, '뒤로를 누르면 원래 창');
    await sp.click('#sheet [data-a="buy"]:not([disabled])'); await sp.click('#sheet [data-a="cfOk"]');
    ok(await sp.evaluate(b0 => S.gold < b0, b0), '확정을 누르면 삼');
    await sp.evaluate(() => showHouse());
    const d0 = await sp.evaluate(() => S.day);
    await sp.click('#sheet [data-a="sleep"]');
    ok(await sp.locator('#sheet [data-a="cfOk"]').count() === 1 && await sp.evaluate(d0 => S.day === d0, d0), '침대의 자기도 확정 창이 먼저 뜨고 바로 자지 않음');
    await sp.click('#sheet [data-a="cfBack"]');
    // 처음부터 해도 소리 크기와 화면 밖 무음 설정은 그대로
    await sp.evaluate(() => { closeSheet(); S.vol.bgm = .35; S.vol.master = .7; S.bgOff = false; showMenu(); });
    ok(await sp.locator('#sheet [data-a="bgOff"]').count() === 1, '설정에 화면 밖 무음 켜고 끄기');
    await sp.evaluate(() => { window.MinerDiary.autoConfirm(true); });
    await sp.evaluate(() => { const b = document.createElement('button'); b.dataset.a = 'reset'; act(b); });
    ok(await sp.evaluate(() => S.vol.bgm === .35 && S.vol.master === .7 && S.bgOff === false && S.day === 1), '처음부터 해도 음량과 화면 밖 무음 설정은 그대로');
    await sp.close();
  }

  /* ===== 좁은 길: 바닥을 가리는 바위는 반투명, 그 위쪽(비쳐 보이는 바닥)을 누르면 캐지 않고 걸어감 ===== */
  {
    const cp = await open(390, 844);
    await cp.evaluate(() => { closeSheet(); S.introSeen = true; window.MinerDiary.speed(10); enterForest(); enterCave();
      for (let y = -7; y <= 4; y++) for (let x = -2; x <= 8; x++) { S.deep.dug[dKey(0, x, y)] = 'r'; seenSet(x, y); }
      for (const [x, y] of [[3, 2], [3, 1], [3, 0], [3, -1], [3, -2], [3, -3]]) S.deep.dug[dKey(0, x, y)] = 'f';
      hero.x = 3; hero.y = 1; hero.path = []; });
    await cp.waitForTimeout(300);
    ok(await cp.evaluate(() => hidesFloor(4, -1) && !hidesFloor(8, 4)), '광부 둘레에서 본 바닥을 가리는 바위만 반투명');
    const pt = await cp.evaluate(() => { follow = false; return cellPoint(3, -2); });
    await cp.mouse.click(pt.x, pt.y); await cp.waitForTimeout(60);
    await cp.waitForFunction(() => !window.MinerDiary.hero().moving, null, { timeout: 15000 });
    ok(await cp.evaluate(() => Math.round(hero.x) === 3 && Math.round(hero.y) === -2 && mT(4, -1) === 'r' && mT(4, -2) === 'r'), '반투명 바위 너머 바닥을 누르면 캐지 않고 그곳으로 걸어감');
    await cp.close();
  }

  /* ===== 컴퓨터 크기: 누르는 위치가 맞는지 ===== */
  const desk = await open(1440, 900);
  const d = helpers(desk);
  await desk.evaluate(() => { const s = window.MinerDiary.state(); s.introSeen = true; s.restored.push('mine'); applyRestored(); window.MinerDiary.speed(10); });
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

  // 15. 폰 설치와 오프라인 (기획 77번): 아이콘과 설치 정보, 한 번 열면 인터넷이 끊겨도 열림
  {
    const fs = require('fs'), http = require('http'), root = path.join(__dirname, '..');
    const pngSize = f => { const b = fs.readFileSync(path.join(root, f)); return b.readUInt32BE(16) + 'x' + b.readUInt32BE(20); };
    const mf = JSON.parse(fs.readFileSync(path.join(root, 'manifest.webmanifest'), 'utf8'));
    ok(mf.name === '광부일기' && mf.display === 'standalone' && mf.icons.every(ic => pngSize(ic.src) === ic.sizes) && pngSize('icons/apple-touch-icon.png') === '180x180', '앱 아이콘(192, 512, 180)과 설치 정보');
    const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
    const srv = http.createServer((q, r) => { const f = path.join(root, decodeURIComponent(q.url.split('?')[0]) === '/' ? 'index.html' : decodeURIComponent(q.url.split('?')[0])); if (!f.startsWith(root) || !fs.existsSync(f)) { r.writeHead(404); r.end(); return; } r.writeHead(200, { 'Content-Type': types[path.extname(f)] || 'application/octet-stream' }); r.end(fs.readFileSync(f)); });
    await new Promise(r => srv.listen(0, r));
    const ctx = await browser.newContext(), pg = await ctx.newPage();
    pg.on('pageerror', e => errors.push('오프라인: ' + e.message));
    await pg.goto(`http://localhost:${srv.address().port}/`);
    await pg.waitForFunction(() => window.MinerDiary && window.MinerDiary.ready, null, { timeout: 15000 });
    const sw = await pg.evaluate(() => navigator.serviceWorker.ready.then(() => true));
    await pg.waitForTimeout(500);
    await ctx.setOffline(true);
    await pg.reload();
    const off = await pg.waitForFunction(() => window.MinerDiary && window.MinerDiary.ready, null, { timeout: 15000 }).then(() => true).catch(() => false);
    ok(sw && off && await pg.evaluate(() => !!document.querySelector('link[rel="manifest"]')), '한 번 열면 인터넷이 끊겨도 게임이 열림');
    await ctx.close(); srv.close();
  }

  await browser.close();
  if (errors.length) { console.error('페이지 오류:\n' + errors.join('\n')); process.exit(1); }
  console.log('브라우저 테스트 통과 (페이지 오류 0건)');
})().catch(e => { console.error(e.message); process.exit(1); });
