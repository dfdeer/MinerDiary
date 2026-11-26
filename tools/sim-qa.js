// 자동 플레이 QA 봇: 게임을 여러 판 아무렇게나(하지만 진행 쪽으로 기울여) 플레이하며 문제를 찾음
// 사용: node tools/sim-qa.js [판 수=3] [판마다 행동 수=1500] [씨앗=1]
//   예: node tools/sim-qa.js            기본 3판
//       node tools/sim-qa.js 5 3000 7  5판, 판마다 3000번, 봇 선택 씨앗 7
// 하는 일: 열린 창이 있으면 그 창의 단추를 하나 누르고(진행 단추를 더 자주), 없으면 화면(건물, 사람, 바위, 구멍, 땅)을 누름.
//   이동 장면은 건너뛰고, 「처음부터」 단추는 누르지 않음.
// 찾는 것: 페이지 오류, 이상한 상태(NaN, 음수 돈, 음수 물건, 기력 넘침, 가방 넘침), 멈춤(오래 아무것도 안 바뀜), 창이 갇힘(누를 단추도 닫기도 없음).
//   홀수 판은 처음부터(퀘스트 막대를 자주 눌러 퀘스트를 따라감), 짝수 판은 후반 상태(마을 다 고침, 돈과 물건 넉넉히)에서 시작.
// 결과: 판마다 몇 줄 요약(날짜, 돈 흐름, 깊이, 퀘스트, 장면별 행동 수)과 문제 목록만 출력. 문제가 있으면 종료 코드 1.
const { chromium } = require('playwright');
const path = require('path');
const url = 'file://' + path.join(__dirname, '..', 'index.html');
const RUNS = +process.argv[2] || 3, STEPS = +process.argv[3] || 1500, SEED = +process.argv[4] || 1;

// 봇 선택용 씨앗 난수 (게임 쪽 무작위는 그대로)
function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const NEVER = new Set(['resetAsk', 'reset', 'mute', 'bgOff', 'endingAgain', 'introPrev']);   // 기록 삭제와 소리 설정, 되감기는 누르지 않음
const STUCK = 80;   // 이만큼 행동해도 상태가 그대로면 멈춤으로 봄

(async () => {
  const browser = await chromium.launch();
  let bad = 0;
  for (let run = 1; run <= RUNS; run++) {
    const R = rng(SEED * 1000 + run), pick = a => a[Math.floor(R() * a.length)];
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const errors = new Map(), probs = new Map();
    const note = (m, k) => m.set(k, (m.get(k) || 0) + 1);
    page.on('pageerror', e => note(errors, 'pageerror: ' + e.message.split('\n')[0]));
    page.on('console', m => { if (m.type() === 'error') note(errors, 'console: ' + m.text().split('\n')[0]); });
    await page.goto(url);
    await page.evaluate(() => localStorage.clear());
    await page.reload(); await page.waitForFunction(() => window.MinerDiary && window.MinerDiary.ready, null, { timeout: 15000 });
    const late = run % 2 === 0;
    await page.evaluate(late => { const M = window.MinerDiary; M.autoConfirm(true); M.speed(6); closeSheet();
      if (late) {   // 후반 상태: 모든 곳을 고치고 돈, 광석, 소모품, 곡괭이, 깊이를 넉넉히
        S.introSeen = true; S.gold = 20000; OBJ.forEach(o => { o.done = true; o.grow = 1; if (!S.restored.includes(o.id)) S.restored.push(o.id); });
        ORE_ORDER.forEach(k => { S.inv[k] = 8; }); Object.keys(ITEMS).forEach(k => { S.items[k] = 2; }); S.pick = 3; S.deepest = 12; S.rod = 1; S.sickle = 1; S.cart = 1; S.acc.slots = 2; save(); }
    }, late);

    const sceneN = {}, acts = {}, gold = [], days = {};
    let last = '', same = 0, stuckN = 0;
    for (let step = 0; step < STEPS; step++) {
      // 1. 지금 상태 보기 + 이상한 상태 검사
      const info = await page.evaluate(() => {
        const M = window.MinerDiary, S = M.state(), bad = [];
        const walk = (o, p, d) => { if (d > 6 || o == null) return; if (typeof o === 'number') { if (!Number.isFinite(o)) bad.push('수가 아님 ' + p); return; } if (typeof o === 'object') for (const k in o) walk(o[k], p + '.' + k, d + 1); };
        walk(S, 'S', 0);
        if (S.gold < 0) bad.push('돈 음수 ' + S.gold);
        if (S.energy < 0) bad.push('기력 음수 ' + S.energy);
        if (S.energy > S.max + 40) bad.push('기력 넘침 ' + S.energy + '/' + S.max);
        for (const box of ['inv', 'carry', 'items']) for (const k in S[box] || {}) if (S[box][k] < 0 || !Number.isInteger(S[box][k])) bad.push(`${box}.${k} = ${S[box][k]}`);
        try { if (M.carryN() > bagCap()) bad.push(`가방 넘침 ${M.carryN()}/${bagCap()}`); } catch (e) { bad.push('가방 검사 실패 ' + e.message); }
        const sh = document.getElementById('sheet'), open = !sh.hidden;
        const btns = open ? [...sh.querySelectorAll('[data-a]')].filter(b => !b.disabled && b.offsetParent !== null).map((b, i) => ({ a: b.dataset.a, i, p: b.classList.contains('primary') })) : [];
        const skip = !document.getElementById('skip').hidden;
        return { bad, open, btns, skip, scene: M.scene(), day: S.day, gold: S.gold, energy: S.energy, depth: S.deepest, quest: S.quest, moving: M.hero().moving, h: M.hero(),
          key: JSON.stringify([S.day, S.gold, S.energy, M.scene(), M.hero().x | 0, M.hero().y | 0, S.quest, M.carryN(), open && sh.textContent.length]) };
      });
      info.bad.forEach(b => note(probs, `[상태] ${b}`));
      sceneN[info.scene] = (sceneN[info.scene] || 0) + 1;
      if (!(info.day in days)) { days[info.day] = info.gold; gold.push(info.gold); }
      if (info.key === last) { if (++same === STUCK) { stuckN++; note(probs, `[멈춤] ${info.scene}에서 ${STUCK}번 넘게 그대로 (창 ${info.open ? '열림' : '닫힘'}, 단추 ${info.btns.map(b => b.a).join(',') || '없음'})`); } } else { same = 0; last = info.key; }
      if (same >= STUCK) {   // 멈추면 창을 닫고 집으로 돌려 보냄
        await page.evaluate(() => { try { closeSheet(); } catch (e) {} });
        same = 0;
      }

      // 2. 행동 고르기
      try {
        if (info.skip) { await page.click('#skip', { timeout: 2000 }); acts.skiptrip = (acts.skiptrip || 0) + 1; continue; }
        if (info.open) {
          const ok = info.btns.filter(b => !NEVER.has(b.a));
          if (!ok.length) {
            const closable = await page.evaluate(() => sheetClosable);
            if (!closable) { note(probs, `[갇힘] ${info.scene}에서 누를 단추도 닫기도 없는 창`); await page.evaluate(() => { try { closeSheet(); } catch (e) {} }); }
            else await page.evaluate(() => closeSheet());
            continue;
          }
          // 진행 단추(primary)를 더 자주, 가끔은 닫기
          const pool = ok.flatMap(b => (b.p ? [b, b, b] : [b]));
          const b = R() < .08 ? (ok.find(x => x.a === 'close') || pick(pool)) : pick(pool);
          acts[b.a] = (acts[b.a] || 0) + 1;
          await page.evaluate(i => { const el = [...document.querySelectorAll('#sheet [data-a]')].filter(b => !b.disabled && b.offsetParent !== null)[i]; if (el) el.click(); }, b.i);
          if (b.a === 'strike') await page.waitForTimeout(80);
        } else {
          // 화면 누르기: 장면마다 누를 곳 후보
          const spot = await page.evaluate(([sc, r1, r2]) => {
            const M = window.MinerDiary, h = M.hero();
            if (sc === 'village') { const objs = M.objects().filter(o => o.id); if (r1 < .75 && objs.length) { const o = objs[Math.floor(r2 * objs.length)]; return { p: M.spotPoint(o.id), w: 'obj:' + o.id }; } return { p: M.tileSpot(Math.round(h.x + (r1 - .5) * 16), Math.round(h.y + (r2 - .5) * 16)), w: 'tile' }; }
            if (sc === 'mine') { if (r1 < .15) { const hole = M.nearestHole(); if (hole) return { p: M.cellSpot(hole[0], hole[1]), w: 'hole' }; } if (r1 < .85) { const r = M.nearRock(); if (r) return { p: M.cellSpot(r[0], r[1]), w: 'rock' }; } return { p: M.cellSpot(Math.round(h.x + (r2 - .5) * 10), Math.round(h.y + (r1 - .5) * 10)), w: 'cell' }; }
            const dx = Math.round(h.x + (r1 - .5) * 10), dy = Math.round(h.y + (r2 - .5) * 10);
            if (sc === 'forest') return { p: M.forestSpot(dx, dy), w: 'fcell' };
            if (sc === 'hunt') { const ms = M.mons(); if (ms.length && r1 < .6) { const m = ms[Math.floor(r2 * ms.length)]; return { p: M.huntSpot(Math.round(m.x), Math.round(m.y)), w: 'mon' }; } return { p: M.huntSpot(dx, dy), w: 'hcell' }; }
            if (sc === 'town') { const objs = M.objects().filter(o => o.id); if (r1 < .5 && objs.length) { const o = objs[Math.floor(r2 * objs.length)]; return { p: M.spotPoint(o.id), w: 'tobj' }; } return { p: M.townSpot(dx, dy), w: 'tcell' }; }
            return null;
          }, [info.scene, R(), R()]).catch(e => { note(probs, `[봇] 누를 곳 찾기 실패 ${info.scene}: ${e.message.split('\n')[0]}`); return null; });
          // 퀘스트를 따라가기 (퀘스트 막대를 누르면 할 일 쪽으로 걸어감)
          if (R() < (late ? .12 : .35)) { const qb = await page.$('[data-a="quest"]:visible'); if (qb) { await qb.click({ timeout: 2000 }).catch(() => {}); acts.quest = (acts.quest || 0) + 1; await page.waitForFunction(() => !window.MinerDiary.hero().moving, null, { timeout: 6000 }).catch(() => {}); continue; } }
          // 가끔 아래 막대 단추(집으로 바로 가기, 가방)도 씀
          if (R() < .06) { const ab = await page.$('#minebar [data-a="homeFastAsk"]:visible, #dock [data-a="bag"]:visible'); if (ab) { await ab.click({ timeout: 2000 }).catch(() => {}); acts.dock = (acts.dock || 0) + 1; continue; } }
          if (spot && spot.p) { await page.mouse.click(spot.p.x, spot.p.y); acts['tap:' + spot.w.split(':')[0]] = (acts['tap:' + spot.w.split(':')[0]] || 0) + 1; }
          // 걷는 동안 기다림 (너무 오래 걸으면 멈춤 검사가 잡음)
          await page.waitForFunction(() => !window.MinerDiary.hero().moving, null, { timeout: 4000 }).catch(() => {});
        }
      } catch (e) { note(probs, `[봇] 행동 실패: ${e.message.split('\n')[0]}`); }
      await page.waitForTimeout(15);
    }
    const end = await page.evaluate(() => { const S = window.MinerDiary.state(); return { day: S.day, gold: S.gold, depth: S.deepest, quest: S.quest, restored: (S.restored || []).length, pick: S.pick }; });
    // 3. 판 요약
    const top = Object.entries(acts).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => `${k} ${v}`).join(', ');
    console.log(`판 ${run}(${late ? '후반' : '처음부터'}): ${STEPS}번 행동, ${end.day}일째, 돈 ${end.gold} (날마다 시작 돈 ${gold.slice(0, 12).join(' > ')}${gold.length > 12 ? ' ...' : ''}), 깊이 ${end.depth}, 퀘스트 ${end.quest}, 고친 곳 ${end.restored}, 곡괭이 ${end.pick}`);
    console.log(`  장면: ${Object.entries(sceneN).map(([k, v]) => `${k} ${v}`).join(', ')} / 많이 한 행동: ${top}`);
    const all = [...errors.entries()].map(([k, v]) => `[오류] ${k}${v > 1 ? ` (${v}번)` : ''}`).concat([...probs.entries()].map(([k, v]) => `${k}${v > 1 ? ` (${v}번)` : ''}`));
    if (all.length) { bad++; console.log(`  문제 ${all.length}가지:`); all.slice(0, 15).forEach(s => console.log('    ' + s)); if (all.length > 15) console.log(`    그 밖에 ${all.length - 15}가지`); }
    else console.log('  문제 없음');
    await page.close();
  }
  await browser.close();
  console.log(bad ? `문제가 있는 판 ${bad}/${RUNS}` : `모든 판 문제 없음 (${RUNS}판)`);
  process.exit(bad ? 1 : 0);
})();
