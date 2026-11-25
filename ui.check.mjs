// Проверка интерфейса стола в настоящем Chromium.
// Запуск: node ui.check.mjs  (сам поднимает vite на 5199)
import {spawn} from 'node:child_process'
import {chromium} from 'playwright-core'
import {T} from './base-rules.js'
import {setup, apply, view} from './play.js'

const PORT = 5100 + (process.pid % 400)
const BASE = 'http://127.0.0.1:' + PORT + '/'
const CHROME = process.env.CHROME || 'C:/Users/kosmy/AppData/Local/ms-playwright/chromium-1248/chrome-win64/chrome.exe'
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'], {stdio:'ignore'})
const results = []
const check = (name, ok, details='') => results.push({name, ok:Boolean(ok), details})

async function waitServer() {
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(BASE); if (r.ok) return } catch {}
    await new Promise(r => setTimeout(r, 500))
  }
  throw new Error('dev server did not start')
}

// Игра на N магов; в состояние подкладываем сокровища, мёртвые карты и ловушку (9-я карта в руке).
async function startGame(browser, {count = 3, spoils = false, viewport = {width:1024,height:768}} = {}) {
  const context = await browser.newContext({viewport})
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', e => errors.push(String(e)))
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })
  await page.goto(BASE)
  if (count !== 3) await page.getByRole('button', {name:String(count), exact:true}).click()
  await page.getByRole('button', {name:/Начать битву/}).click()
  await page.waitForSelector('.table')
  if (spoils) {
    const data = await page.evaluate(() => JSON.parse(localStorage.getItem('skull-local')))
    data.state.players[1].treasures = [0,1,2,3,4,5]
    data.state.players[1].deadCards = [0,31,72]
    data.state.players[0].treasures = [T_TRAP]
    await page.evaluate(saved => localStorage.setItem('skull-local', JSON.stringify(saved)), data)
    await page.reload()
    await page.waitForSelector('.table')
  }
  return {page, context, errors}
}
const T_TRAP = T.trap

await waitServer()
const browser = await chromium.launch({executablePath: CHROME})
const out = {}
try {
  // 1. Девять карт в руке на 1024×768.
  {
    const {page, errors} = await startGame(browser, {spoils:true})
    out.hand1024 = await page.evaluate(() => {
      const hand = document.querySelector('.hand')
      const cards = [...document.querySelectorAll('.hand-card')]
      const box = hand.getBoundingClientRect()
      return {count:cards.length, clipped:cards.filter(c => c.getBoundingClientRect().bottom > box.bottom + 1 || c.getBoundingClientRect().right > box.right + 1).length, scroll:[hand.scrollWidth-hand.clientWidth, hand.scrollHeight-hand.clientHeight]}
    })
    check('9 карт на 1024×768 видны целиком', out.hand1024.count === 9 && out.hand1024.clipped === 0 && out.hand1024.scroll.every(v => v === 0), JSON.stringify(out.hand1024))
    check('консоль чистая (1024)', errors.length === 0, errors.join(' | '))
    await page.context().close()
  }
  // 2. Девять карт в руке на телефоне.
  {
    const {page} = await startGame(browser, {spoils:true, viewport:{width:390,height:844}})
    out.hand390 = await page.evaluate(() => {
      const hand = document.querySelector('.hand')
      const cards = [...document.querySelectorAll('.hand-card')]
      const box = hand.getBoundingClientRect()
      return {count:cards.length, clipped:cards.filter(c => c.getBoundingClientRect().bottom > box.bottom + 1).length, scroll:hand.scrollHeight-hand.clientHeight}
    })
    check('9 карт на 390×844 видны целиком', out.hand390.count === 9 && out.hand390.clipped === 0 && out.hand390.scroll === 0, JSON.stringify(out.hand390))
    await page.context().close()
  }
  // 3. Битая картинка не оставляет рамки.
  {
    const {page} = await startGame(browser)
    out.broken = await page.evaluate(async () => {
      const img = document.querySelector('.hand-card img')
      img.src = '/assets/cards/spells/missing.webp'
      await new Promise(r => setTimeout(r, 400))
      const box = img.getBoundingClientRect()
      return {hidden:img.hidden, display:getComputedStyle(img).display, size:[Math.round(box.width),Math.round(box.height)]}
    })
    check('битая картинка скрыта', out.broken.hidden && out.broken.display === 'none' && out.broken.size[0] === 0 && out.broken.size[1] === 0, JSON.stringify(out.broken))
    await page.context().close()
  }
  // 4. Сокровища, мёртвые карты и «✓» в строке мага.
  {
    const {page} = await startGame(browser, {spoils:true})
    out.mage = await page.evaluate(() => {
      const stats = document.querySelectorAll('.mage-stats')[1]
      const box = stats.getBoundingClientRect()
      const ready = stats.querySelector('.ready') || document.querySelectorAll('.mage-stats')[1].parentElement.querySelector('.ready')
      const items = [...stats.querySelectorAll('.mini')].map(e => Math.round(e.getBoundingClientRect().right))
      return {visibleMinis:items.filter(r => r <= box.right + 1).length, totalMinis:items.length, right:Math.round(box.right), last:items.at(-1), plus:stats.querySelector('.more')?.textContent || null}
    })
    check('в строке мага видны миниатюры и остаток', out.mage.visibleMinis >= 1 && (out.mage.totalMinis <= 3 || Boolean(out.mage.plus)), JSON.stringify(out.mage))
    await page.context().close()
  }
  // 5. Хроника при шести магах на 1280×720.
  {
    const {page} = await startGame(browser, {count:6, viewport:{width:1280,height:720}})
    out.journal = await page.evaluate(() => {
      const ol = document.querySelector('.journal ol')
      const box = ol.getBoundingClientRect()
      return {height:Math.round(box.height), rows:ol.querySelectorAll('li').length, visibleRows:[...ol.querySelectorAll('li')].filter(li => li.getBoundingClientRect().bottom <= ol.getBoundingClientRect().bottom + 1).length, mageOverflow:(()=>{const box=document.querySelector('.mages').getBoundingClientRect(); const last=[...document.querySelectorAll('.mage')].at(-1).getBoundingClientRect(); return Math.round(last.bottom - box.bottom)})()}
    })
    check('хроника видна при 6 магах на 1280×720', out.journal.height >= 40 && out.journal.visibleRows >= 1, JSON.stringify(out.journal))
    check('панель магов при 6 магах не переполнена', out.journal.mageOverflow <= 0, JSON.stringify(out.journal))
    await page.context().close()
  }
  // 5b. Шесть магов на телефоне.
  {
    const {page} = await startGame(browser, {count:6, viewport:{width:390,height:844}})
    out.mobileSix = await page.evaluate(() => {
      const box = document.querySelector('.mages').getBoundingClientRect()
      const last = [...document.querySelectorAll('.mage')].at(-1).getBoundingClientRect()
      const journal = document.querySelector('.journal ol').getBoundingClientRect()
      return {lastBottom:Math.round(last.bottom), boxBottom:Math.round(box.bottom), overflow:Math.round(last.bottom - box.bottom), journalHeight:Math.round(journal.height)}
    })
    out.mobileStats = await page.evaluate(() => [...document.querySelectorAll('.mage-stats')].map(e => { const box = e.getBoundingClientRect(); return [...e.children].every(c => c.getBoundingClientRect().right <= box.right + 1) }))
    check('шесть магов на 390×844 без обрезки', out.mobileSix.overflow <= 0 && out.mobileSix.journalHeight >= 30, JSON.stringify(out.mobileSix))
    check('строка мага на 390×844 не обрезает значки', out.mobileStats.every(Boolean), JSON.stringify(out.mobileStats))
    await page.context().close()
  }
  // 5c. Розыгрыш: чужие заклинания сверху, моё снизу, выбор при активной карте.
  {
    const state = setup(['Я','Бот','Третий'],5)
    state.players[0].hand = [330]
    state.players[1].hand = [611,330,170]
    state.players[2].hand = [611,330,170]
    const a = apply(state, {type:'commit',cards:[330],slots:{}},0)
    const b = apply(a, {type:'commit',cards:[611,330,170],slots:{}},1)
    let pending = apply(b, {type:'commit',cards:[611,330,170],slots:{}},2)
    for (let step = 0; step < 20 && !pending.pending; step++) pending = apply(pending, {type:'resume'}, pending.turn?.actor ?? 0)
    const context = await browser.newContext({viewport:{width:1440,height:900}})
    await context.addInitScript(payload => localStorage.setItem('skull-local', JSON.stringify(payload)), {state:pending, mode:'bot', actor:0})
    const page = await context.newPage()
    await page.goto(BASE + '#/local')
    await page.waitForSelector('.table')
    await page.waitForTimeout(400)
    out.reveal = await page.evaluate(() => ({
      opponents:document.querySelectorAll('.opponent').length,
      opponentCards:document.querySelectorAll('.opponent-cards .mini-card').length,
      backs:document.querySelectorAll('.mini-card.back').length,
      filled:document.querySelectorAll('.spell-slot.filled').length,
      images:document.querySelectorAll('.spell-slot.filled img').length,
      active:document.querySelectorAll('.spell-slot.active').length,
      bar:document.querySelector('.pending-bar b')?.textContent || null,
      options:document.querySelectorAll('.pending-bar button').length,
      caster:document.querySelector('.resolved b')?.textContent || null,
    }))
    check('во время выбора карты заклинания лежат на столе', out.reveal.filled === 1 && out.reveal.images === 1, JSON.stringify(out.reveal))
    check('выбор привязан к активной карте', out.reveal.active === 1 && out.reveal.bar === 'Выбери врага' && out.reveal.options === 2, JSON.stringify(out.reveal))
    check('заклинания противников раскрыты сверху', out.reveal.opponents === 2 && out.reveal.opponentCards === 6 && out.reveal.backs === 0, JSON.stringify(out.reveal))
    await page.locator('.pending-bar button').first().click()
    await page.waitForTimeout(600)
    out.revealAfter = await page.evaluate(() => ({bar:document.querySelector('.pending-bar b')?.textContent || null}))
    check('после ответа подсказка исчезает', out.revealAfter.bar === null, JSON.stringify(out.revealAfter))
    await context.close()
  }
  // 5d. Сбор: у противников рубашки, карты не раскрыты.
  {
    const state = setup(['Я','Бот','Третий'],9)
    state.players[1].hand = [611,330,170]
    state.players[2].hand = [611,330,170]
    const a = apply(state, {type:'commit',cards:[611,330,170],slots:{}},1)
    const build = apply(a, {type:'commit',cards:[611,330,170],slots:{}},2)
    const context = await browser.newContext({viewport:{width:1440,height:900}})
    await context.addInitScript(payload => localStorage.setItem('skull-local', JSON.stringify(payload)), {state:build, mode:'bot', actor:0})
    const page = await context.newPage()
    await page.goto(BASE + '#/local')
    await page.waitForSelector('.table')
    await page.waitForTimeout(400)
    out.build = await page.evaluate(() => ({
      opponents:document.querySelectorAll('.opponent').length,
      backs:document.querySelectorAll('.mini-card.back').length,
      revealed:document.querySelectorAll('.opponent-cards img.card-art').length,
      phase:document.querySelector('.phase-label')?.textContent,
    }))
    check('в сборе у противников видны рубашки', out.build.opponents === 2 && out.build.backs === 6 && out.build.revealed === 0, JSON.stringify(out.build))
    await context.close()
  }
  // 5e. Раунд не пролетает одним шагом: движок встаёт на паузу после раскрытия.
  {
    const state = setup(['Я','Бот','Третий'],2)
    state.players[0].hand = [330]
    state.players[1].hand = [611,330,170]
    state.players[2].hand = [611,330,170]
    const a = apply(state, {type:'commit',cards:[330],slots:{}},0)
    const b = apply(a, {type:'commit',cards:[611,330,170],slots:{}},1)
    const st = apply(b, {type:'commit',cards:[611,330,170],slots:{}},2)
    out.pause = {phase:st.phase, paused:!!st.pause, actor:st.turn?.actor, cards:st.players.map(p=>p.spell?.length??0)}
    check('раунд не разыгрывается целиком одним шагом', st.phase === 'resolve' && st.pause === true && st.turn?.actor === 0, JSON.stringify(out.pause))
    const context = await browser.newContext({viewport:{width:1440,height:900}})
    await context.addInitScript(payload => localStorage.setItem('skull-local', JSON.stringify(payload)), {state:st, mode:'bot', actor:0})
    const page = await context.newPage()
    await page.goto(BASE + '#/local')
    await page.waitForSelector('.table')
    await page.waitForTimeout(500)
    const before = await page.evaluate(() => ({phase:document.querySelector('.phase-label')?.textContent, filled:document.querySelectorAll('.spell-slot.filled').length, play:[...document.querySelectorAll('.status-line button')].map(b=>b.textContent)}))
    await page.locator('.status-line .primary').first().click()
    await page.waitForTimeout(400)
    const after = await page.evaluate(() => ({active:document.querySelectorAll('.spell-slot.active').length, done:document.querySelectorAll('.spell-slot.done').length, phase:document.querySelector('.phase-label')?.textContent}))
    out.pauseUi = {before, after}
    check('в розыгрыше есть кнопка «Разыграть» и карты на столе', before.phase === 'Розыгрыш' && before.filled >= 1 && before.play.some(x=>x.startsWith('Разыграть')), JSON.stringify(before))
    check('одно нажатие делает ровно один шаг', after.phase === 'Розыгрыш' && (after.active === 1 || after.done >= 1), JSON.stringify(after))
    await context.close()
  }
  // 5f. Бросок кубиков показывается оверлеем с анимацией.
  {
    const state = setup(['Я','Бот'],7)
    state.players[0].hand = [420]
    state.players[1].hand = []
    const st = apply(state, {type:'commit',cards:[420],slots:{}},0)
    const context = await browser.newContext({viewport:{width:1440,height:900}})
    await context.addInitScript(payload => localStorage.setItem('skull-local', JSON.stringify(payload)), {state:st, mode:'bot', actor:0})
    const page = await context.newPage()
    await page.goto(BASE + '#/local')
    await page.waitForSelector('.table')
    await page.waitForTimeout(500)
    await page.locator('.status-line .primary').first().click()
    await page.waitForTimeout(350)
    await page.locator('.status-line .primary').first().click()
    await page.waitForTimeout(250)
    out.dice = await page.evaluate(() => {
      const overlay = document.querySelector('.dice-overlay')
      return {overlay:!!overlay, position:overlay?getComputedStyle(overlay).position:null, dice:document.querySelectorAll('.die').length, who:document.querySelector('.dice-who')?.textContent||null, total:document.querySelector('.dice-total')?.textContent||null}
    })
    check('бросок кубиков показывается оверлеем', out.dice.overlay && out.dice.position === 'fixed' && out.dice.dice === 2, JSON.stringify(out.dice))
    await page.waitForTimeout(800)
    out.diceResult = await page.evaluate(() => ({total:document.querySelector('.dice-total')?.textContent||null, faces:[...document.querySelectorAll('.die')].map(die => die.getAttribute('aria-label'))}))
    check('после анимации видны значения и сумма', /\d\s*=\s*\d+/.test(out.diceResult.total||'') && out.diceResult.faces.length === 2, JSON.stringify(out.diceResult))
    await context.close()
  }
  // 6. Один tab-стоп на карту, превью по правому краю.
  {
    const {page} = await startGame(browser, {viewport:{width:1024,height:768}})
    out.tabs = await page.evaluate(() => document.querySelectorAll('.hand button, .hand [tabindex="0"]').length)
    check('в руке один tab-стоп на карту', out.tabs === 8, String(out.tabs))
    const last = page.locator('.hand-card').last()
    await last.hover()
    await page.waitForTimeout(300)
    out.clamp = await page.evaluate(() => {
      const p = document.querySelector('.card-preview')
      if (!p) return null
      const b = p.getBoundingClientRect()
      return {left:Math.round(b.left), right:Math.round(b.right), top:Math.round(b.top), bottom:Math.round(b.bottom), w:innerWidth, h:innerHeight}
    })
    check('превью прижато к экрану', out.clamp && out.clamp.left >= 0 && out.clamp.right <= out.clamp.w && out.clamp.top >= 0 && out.clamp.bottom <= out.clamp.h, JSON.stringify(out.clamp))
    await page.context().close()
  }
} finally {
  await browser.close()
  server.kill()
}
const failed = results.filter(r => !r.ok)
for (const r of results) console.log((r.ok ? 'PASS ' : 'FAIL ') + r.name + (r.ok ? '' : ' → ' + r.details))
console.log('\n' + JSON.stringify(out, null, 1))
console.log(results.length - failed.length + '/' + results.length + ' проверок пройдено')
process.exit(failed.length ? 1 : 0)
