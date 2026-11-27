// 사람처럼 플레이하는 봇: 밸런스(돈, 기력, 진행 속도)와 불편한 점(걷는 기력, 누르는 횟수, 작은 단추)을 숫자로 봄
// 사용: node tools/sim-play.js [날 수=20] [최대 행동 수=4000] [판 수=1]
// 하는 일: 퀘스트 막대를 따라가고, 고칠 수 있으면 고치고, 광산에서 광석이 있는 바위를 먼저 캐고 구멍으로 내려감.
//   가방이 거의 차면 마을로 돌아가 시장(없으면 떠돌이 상인)에 팔고, 기력이 떨어지면 집에 가서 잠.
//   창이 뜨면 할 일에 맞는 단추를 고르고(확정은 자동), 같은 창에서 맴돌면 닫음. 「처음부터」와 소리 설정은 안 누름.
// 재는 것: 날마다 돈과 깊이와 퀘스트, 기력을 쓴 곳(광산 걷기, 캐기, 숲, 토벌, 이동 등), 퀘스트마다 걸린 날과 누른 횟수,
//   쓰러짐, 가방 가득, 한 번 팔 때 누른 횟수, 너무 작은 단추(36px 미만)와 너무 작은 글자(11px 미만), 페이지 오류.
const { chromium } = require('playwright');
const path = require('path');
const url = 'file://' + path.join(__dirname, '..', 'index.html');
const DAYS = +process.argv[2] || 20, MAXA = +process.argv[3] || 4000, RUNS = +process.argv[4] || 1;
const NEVER = new Set(['resetAsk', 'reset', 'mute', 'bgOff', 'endingAgain', 'introPrev', 'dropDo', 'dropSel', 'dropPick', 'unequip', 'news', 'menu', 'codex', 'stats']);
// 할 일마다 먼저 누를 단추 (앞에 있을수록 먼저)
const PRI = {
  sleep: ['cfOk', 'homeFast', 'sleep'],
  sell: ['cfOk', 'homeFast', 'sellDo', 'sellAll', 'trade', 'sell', 'mTab'],
  go: ['cfOk', 'intro', 'introDone', 'restore', 'fix', 'enter', 'smelt', 'forge', 'forgeGo', 'fslot', 'fsel', 'strike', 'spHammer', 'harvest', 'water', 'plant', 'cast', 'pull', 'kcook', 'kcookSel', 'kpick', 'kreq', 'board', 'cut', 'donate', 'stage', 'hunt', 'upgrade', 'endingDone', 'ending', 'calmHeart'],
};

(async () => {
  const browser = await chromium.launch();
  for (let run = 1; run <= RUNS; run++) {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const errors = new Map(); const note = (m, k) => m.set(k, (m.get(k) || 0) + 1);
    page.on('pageerror', e => note(errors, e.message.split('\n')[0]));
    page.on('console', m => { if (m.type() === 'error') note(errors, m.text().split('\n')[0]); });
    await page.goto(url); await page.evaluate(() => localStorage.clear()); await page.reload();
    await page.waitForFunction(() => window.MinerDiary && window.MinerDiary.ready, null, { timeout: 15000 });
    // 계측: 기력을 쓴 곳(부른 함수 이름), 쓰러짐, 가방 가득
    await page.evaluate(() => {
      const M = window.MinerDiary; M.autoConfirm(true); M.speed(6); closeSheet();
      window.__m = { spend: {}, faint: 0, full: 0 };
      const sp = spend; spend = function (n) { const st = (new Error().stack || '').split('\n')[2] || '', f = (st.match(/at (\w+)/) || [])[1] || '?'; const r = sp(n); if (r) window.__m.spend[f] = (window.__m.spend[f] || 0) + n; return r; };   // eslint-disable-line no-global-assign
      const fa = faint; faint = function () { window.__m.faint++; return fa.apply(this, arguments); };   // eslint-disable-line no-global-assign
      const bf = bagFullMsg; bagFullMsg = function () { window.__m.full++; return bf.apply(this, arguments); };   // eslint-disable-line no-global-assign
    });
    const heap0 = await page.evaluate(() => performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : -1);
    const st = () => page.evaluate(() => { const M = window.MinerDiary, S = M.state(), sh = document.getElementById('sheet');
      return { day: S.day, gold: S.gold, e: S.energy, max: S.max, ph: phaseIndex(), scene: M.scene(), q: S.quest, depth: S.deepest, L: S.deep ? S.deep.L : 0, carry: M.carryN(), cap: bagCap(), open: !sh.hidden, skip: !document.getElementById('skip').hidden, restored: S.restored.length, pick: S.pick, qt: (QUESTS[S.quest] || {}).target || '', qid: (QUESTS[S.quest] || {}).id || '',
        btns: sh.hidden ? [] : [...sh.querySelectorAll('[data-a]')].filter(b => !b.disabled && b.offsetParent !== null).map((b, i) => ({ a: b.dataset.a, i, p: b.classList.contains('primary') })), title: sh.hidden ? '' : (sh.querySelector('.sheet-title,h2,header') || sh).textContent.slice(0, 12) }; });
    const clickBtn = i => page.evaluate(i => { const el = [...document.querySelectorAll('#sheet [data-a]')].filter(b => !b.disabled && b.offsetParent !== null)[i]; if (el) el.click(); }, i);
    const tapAt = async p => { if (p) await page.mouse.click(p.x, p.y); await page.waitForTimeout(40); await page.waitForFunction(() => !window.MinerDiary.hero().moving, null, { timeout: 8000 }).catch(() => {}); };
    const tapObj = id => page.evaluate(id => window.MinerDiary.spotPoint(id), id).then(tapAt);
    const dock = async sel => { const b = await page.$(sel); if (b && await b.isVisible()) { await b.click({ timeout: 2000 }).catch(() => {}); await page.waitForTimeout(60); return true; } return false; };

    const days = [], quests = [], small = new Map(), tiny = new Map(), sells = [];
    let idle = 0, lastE = -1;
    let intent = 'go', sheetSeen = new Map(), lastKey = '', same = 0, stuck = 0, taps = 0, qStart = { day: 1, taps: 0 }, sellTaps = null, prev = await st();
    days.push({ day: 1, gold: prev.gold, depth: prev.depth, q: prev.q, restored: prev.restored, pick: prev.pick });
    for (let a = 0; a < MAXA; a++) {
      const s = await st();
      if (s.day > DAYS) break;
      if (s.day !== prev.day) days.push({ day: s.day, gold: s.gold, depth: s.depth, q: s.q, restored: s.restored, pick: s.pick });
      if (s.q !== prev.q) { quests.push({ q: prev.q, days: s.day - qStart.day, taps: taps - qStart.taps }); qStart = { day: s.day, taps }; }
      if (intent === 'sell' && s.carry <= 2 && sellTaps !== null) { sells.push(taps - sellTaps); sellTaps = null; intent = 'go'; }
      if (intent === 'sleep' && s.day !== prev.day) intent = 'go';
      prev = s;
      if (process.env.TRACE) console.log(a, intent, s.scene, 'L' + s.L, 'q' + s.q, 'e' + s.e, s.open ? '[' + s.title.trim() + '] ' + s.btns.map(b => b.a).join(',') : '');
      const key = JSON.stringify([s.day, s.gold, s.e, s.scene, s.q, s.carry, s.L, s.open && s.title, s.btns.length]);
      if (key === lastKey) { if (++same > 25) { stuck++; same = 0; await page.evaluate(() => { try { closeSheet(); } catch (e) {} }); intent = 'go'; } } else { same = 0; lastKey = key; }
      try {
        if (s.skip) { await page.click('#skip', { timeout: 2000 }); taps++; continue; }
        // 기력이 바닥이거나 새벽이면 자러 감, 가방이 거의 차면 팔러 감
        if (intent !== 'sleep' && (s.e <= 6 || s.ph >= 3 || (s.qid === 'sleep' && s.scene === 'village'))) intent = 'sleep';
        else if (intent === 'go' && s.carry >= s.cap - 1) { intent = 'sell'; sellTaps = taps; }
        if (s.open) {
          // 작은 단추와 글자 모으기 (창마다 한 번)
          const k = s.title; if (!sheetSeen.has(k)) {
            const u = await page.evaluate(() => { const sm = [], tn = []; document.querySelectorAll('#sheet [data-a]').forEach(b => { const r = b.getBoundingClientRect(); if (r.width && (r.width < 36 || r.height < 36)) sm.push(b.dataset.a + ' ' + Math.round(r.width) + 'x' + Math.round(r.height)); }); document.querySelectorAll('#sheet *').forEach(e => { if (e.children.length || !e.textContent.trim()) return; const fs = parseFloat(getComputedStyle(e).fontSize); if (fs < 11) tn.push(e.textContent.trim().slice(0, 10) + ' ' + fs + 'px'); }); return { sm, tn }; });
            u.sm.forEach(x => small.set(x, k)); u.tn.forEach(x => tiny.set(x, k));
          }
          const n = (sheetSeen.get(k) || 0) + 1; sheetSeen.set(k, n);
          const ok = s.btns.filter(b => !NEVER.has(b.a));
          const pri = PRI[intent] || PRI.go;
          let pick = null; for (const a2 of pri) { pick = ok.find(b => b.a === a2); if (pick) break; }
          if (!pick && intent === 'go') pick = ok.find(b => b.p && b.a !== 'close');
          if (!pick || same > 6) { await page.evaluate(() => { try { closeSheet(); } catch (e) {} }); taps++; if (intent === 'sell') intent = 'go'; continue; }
          await clickBtn(pick.i); taps++; await page.waitForTimeout(pick.a === 'strike' ? 120 : 30);
          continue;
        }
        // 창이 없을 때: 할 일에 맞게 움직임
        if (intent === 'sleep') {
          if (s.scene !== 'village') { if (await dock('#minebar [data-a="homeFastAsk"]')) { taps++; continue; } }
          await tapObj('house'); taps++; continue;
        }
        if (intent === 'sell') {
          if (s.scene !== 'village') { if (await dock('#minebar [data-a="homeFastAsk"]')) { taps++; continue; } }
          const market = await page.evaluate(() => S.restored.includes('market'));
          await tapObj(market ? 'market' : 'merchant'); taps++; continue;
        }
        // 퀘스트를 따라가기 (가끔), 아니면 광산에서 캐기
        if (s.scene === 'village' && (a % 3 === 0 || s.q < 7)) { if (await dock('[data-a="quest"]')) { taps++; await page.waitForFunction(() => !window.MinerDiary.hero().moving, null, { timeout: 8000 }).catch(() => {}); continue; } }
        if (s.scene === 'village') { const open = await page.evaluate(() => S.restored.includes('mine') || S.mineOpen || S.quest > 5); await tapObj(open ? 'mine' : 'forest'); taps++; continue; }
        // 캐는 곳에서 기력이 안 줄면(캘 게 없음) 또는 퀘스트가 다른 곳이면 마을로
        if (s.scene === 'mine' || s.scene === 'forest') {
          idle = s.e === lastE ? idle + 1 : 0; lastE = s.e;
          const away = s.qt && !['mine', 'forest'].includes(s.qt) && s.carry >= 3;
          if (idle >= 15 || away) { idle = 0; if (away && s.qt === 'merchant') { intent = 'sell'; sellTaps = taps; } if (await dock('#minebar [data-a="homeFastAsk"]')) { taps++; continue; } }
        }
        if (s.scene === 'mine') {
          const p = await page.evaluate(() => { const M = window.MinerDiary, h = M.hero(), hx = Math.round(h.x), hy = Math.round(h.y);
            // 본 바닥에 닿은 바위 가운데 광석 있는 것을 먼저, 가까운 것부터 (시험용 nearRock은 바위를 새로 만들어서 안 씀)
            let best = null, bd = 1e9, ore = null, od = 1e9;
            for (let y = hy - 12; y <= hy + 12; y++) for (let x = hx - 12; x <= hx + 12; x++) { const c = M.cell(x, y); if (!c.seen || (c.t !== 'r' && c.t !== 'b')) continue;
              if (![[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => { const n = M.cell(x + dx, y + dy); return n.seen && 'fud'.includes(n.t); })) continue;
              const d = Math.abs(x - h.x) + Math.abs(y - h.y); if (c.ore && d < od) { od = d; ore = [x, y]; } if (d < bd) { bd = d; best = [x, y]; } }
            let hole = null, hd = 1e9; for (let y = hy - 20; y <= hy + 20; y++) for (let x = hx - 20; x <= hx + 20; x++) { const c = M.cell(x, y); if (c.seen && c.t === 'd') { const d = Math.abs(x - h.x) + Math.abs(y - h.y); if (d < hd) { hd = d; hole = [x, y]; } } }   // 본 구멍만
            const tgt = ore || (hole && Math.random() < .5 ? hole : best) || hole; return tgt ? M.cellSpot(tgt[0], tgt[1]) : null; });
          await tapAt(p); taps++; continue;
        }
        // 숲: 숲 동굴 퀘스트면 동굴 입구('v')로 (마을 밖에선 퀘스트 막대가 길을 안내하지 않아서)
        if (s.scene === 'forest' && s.q <= 2) { const p = await page.evaluate(() => { const t = S.forest.t, i = t.indexOf('v'); return i < 0 ? null : window.MinerDiary.forestSpot(i % FW, (i / FW) | 0); }); if (p) { await tapAt(p); taps++; continue; } }
        if (s.scene === 'forest') { const p = await page.evaluate(() => { const h = window.MinerDiary.hero(); return window.MinerDiary.forestSpot(Math.round(h.x + (Math.random() - .5) * 8), Math.round(h.y + (Math.random() - .5) * 8)); }); await tapAt(p); taps++; if (Math.random() < .08) { await dock('#minebar [data-a="homeFastAsk"]'); } continue; }
        // 그 밖의 장면(토벌, 다른 마을)은 집으로
        if (!(await dock('#minebar [data-a="homeFastAsk"]'))) { await page.evaluate(() => { try { closeSheet(); } catch (e) {} }); }
        taps++;
      } catch (e) { note(errors, '[봇] ' + e.message.split('\n')[0]); }
    }
    const m = await page.evaluate(() => window.__m), end = await st(), heap = await page.evaluate(() => performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : -1);
    // 요약
    const sum = Object.values(m.spend).reduce((x, y) => x + y, 0) || 1;
    console.log(`판 ${run}: ${end.day}일째, 누른 횟수 ${taps}, 돈 ${end.gold}, 깊이 ${end.depth}, 퀘스트 ${end.q}, 고친 곳 ${end.restored}, 곡괭이 ${end.pick}, 쓰러짐 ${m.faint}, 가방 가득 ${m.full}, 멈춤 ${stuck}, 메모리 ${heap}MB (처음 ${heap0}MB)`);
    console.log('  날마다 (일: 돈/깊이/퀘스트): ' + days.map(d => `${d.day}:${d.gold}/${d.depth}/${d.q}`).join(' '));
    console.log('  기력 쓴 곳: ' + Object.entries(m.spend).sort((x, y) => y[1] - x[1]).map(([k, v]) => `${k} ${Math.round(v / sum * 100)}%`).join(', '));
    console.log('  퀘스트마다 (번호: 날/누름): ' + quests.map(q => `${q.q}:${q.days}/${q.taps}`).join(' '));
    if (sells.length) console.log(`  한 번 팔기까지 누른 횟수: 평균 ${Math.round(sells.reduce((x, y) => x + y, 0) / sells.length)}, 가장 많이 ${Math.max(...sells)} (${sells.length}번 팖)`);
    if (small.size) console.log('  36px보다 작은 단추: ' + [...small.entries()].slice(0, 12).map(([k, v]) => `${k} (${v.trim()})`).join(', '));
    if (tiny.size) console.log('  11px보다 작은 글자: ' + [...tiny.entries()].slice(0, 12).map(([k, v]) => `${k} (${v.trim()})`).join(', '));
    if (errors.size) console.log('  오류: ' + [...errors.entries()].map(([k, v]) => `${k}${v > 1 ? ` (${v}번)` : ''}`).join(' / '));
    await page.close();
  }
  await browser.close();
})();
