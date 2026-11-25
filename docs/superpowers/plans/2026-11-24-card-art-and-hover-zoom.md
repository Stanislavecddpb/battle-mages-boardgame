# Карты-картинки, наведение и один экран — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Заменить текстовые карты сканами, показывать карту крупно при наведении и уложить весь стол в один экран без прокруток.

**Architecture:** Клиент остаётся одним React-компонентом в `src.jsx`, стили — в `style.css`. Карта — `<img>` скана, обёрнутый в новый компонент `CardZoom`, который рендерит увеличенную копию через портал в `body`. `play.js` дополняет `view()` путями к портретам магов и картам мёртвого колдуна. Недостающие сканы копируются в `public/assets`, автономная сборка расширяется на все каталоги картинок.

**Tech Stack:** React 19, vite 7, esbuild, чистый CSS, node:test.

**Spec:** `docs/superpowers/specs/2026-11-24-card-art-and-hover-zoom-design.md`

## Global Constraints

- Проект **не под git**. Шаги «закоммитить» заменены контрольной проверкой; ничего не удалять за пределами перечисленных файлов.
- Только базовая коробка: заклинания 0–63, сокровища 0–24 + 126, мёртвые 0–7, маги 0–7.
- Ассеты — из коммита `6857735d80ffc521e24b266b1c32fe0b81806067` репозитория `Etuir335/epic-spell-wars`.
- Движок (`base-rules.js`) и сервер (`server.js`, `worker.js`) не меняются.
- Никаких горизонтальных и вложенных прокруток в игровом столе; `html,body,#root` остаются `overflow:hidden`.
- Текст на столе: только названия трёх слотов, имена магов, числа, статус хода.
- Каждая картинка имеет текстовый `alt` (имя карты) или `alt=""` для декоративных миниатюр.
- Команды проверки: `npm test`, `npm run build`.

## Review Focus

- Рука из 9 карт на окне 1024×768: все карты видны целиком, скролла нет.
- Карта у правого или левого края: превью прижимается к вьюпорту и не обрезается.
- Карта в верхней половине экрана: превью раскрывается вниз и не уезжает за верхнюю границу.
- Маг с 6 сокровищами и 3 картами мёртвого колдуна: строка мага не растягивает панель и не ломает сетку.
- Тач-устройство: долгое нажатие показывает превью, короткий тап выбирает карту.
- Картинка не загрузилась: карта остаётся кликабельной и не оставляет пустой рамки.
- Автономный `Черепламень.html` без сервера: фон арены и все карты видны.

---

### Task 1: Недостающие ассеты и тест на их наличие

**Files:**
- Create: `public/assets/ui/arena-bg.webp`, `public/assets/ui/menu-bg.webp`, `public/assets/cards/treasures/126.webp`
- Test: `check.test.js`

**Interfaces:**
- Produces: файлы по путям `/assets/ui/arena-bg.webp`, `/assets/ui/menu-bg.webp`, `/assets/cards/treasures/126.webp`.

- [ ] **Step 1: Написать падающий тест на комплект картинок**

Добавить в `check.test.js` (импорты — в начале файла: `import {existsSync} from 'node:fs'`, `import {fileURLToPath} from 'node:url'`, `import path from 'node:path'`; каталог: `const assets = fileURLToPath(new URL('./public/assets/', import.meta.url))`):

```js
test('Все картинки базовой коробки на месте', () => {
  const files = [
    ...Array.from({length:64},(_,i) => `cards/spells/${i}.webp`),
    ...Array.from({length:25},(_,i) => `cards/treasures/${i}.webp`),
    'cards/treasures/126.webp',
    ...Array.from({length:8},(_,i) => `cards/dead/${i}.webp`),
    ...Array.from({length:8},(_,i) => `cards/wizards/${i}.webp`),
    'ui/arena-bg.webp',
    'ui/menu-bg.webp',
  ]
  const missing = files.filter(name => !existsSync(path.join(assets,name)))
  assert.deepEqual(missing, [])
})
```

- [ ] **Step 2: Убедиться, что тест падает**

Run: `node --test check.test.js`
Expected: FAIL, в списке `missing` три файла: `cards/treasures/126.webp`, `ui/arena-bg.webp`, `ui/menu-bg.webp`.

- [ ] **Step 3: Скачать три файла**

```powershell
$base='https://raw.githubusercontent.com/Etuir335/epic-spell-wars/6857735d80ffc521e24b266b1c32fe0b81806067/public/assets'
New-Item -ItemType Directory -Force public/assets/ui | Out-Null
Invoke-WebRequest "$base/ui/arena-bg.webp" -OutFile public/assets/ui/arena-bg.webp
Invoke-WebRequest "$base/ui/menu-bg.webp" -OutFile public/assets/ui/menu-bg.webp
Invoke-WebRequest "$base/cards/treasures/126.webp" -OutFile public/assets/cards/treasures/126.webp
Get-ChildItem public/assets/ui,public/assets/cards/treasures/126.webp | Select-Object Name,Length
```

Ожидаемые размеры: `arena-bg.webp` и `menu-bg.webp` — больше 200 КБ, `126.webp` — больше 30 КБ.

- [ ] **Step 4: Проверить тест и сборку**

Run: `node --test check.test.js`, затем `npm run build`
Expected: тест PASS; после сборки существуют `dist/client/assets/ui/arena-bg.webp` и `dist/client/assets/cards/treasures/126.webp`.

---

### Task 2: Портрет мага и карты мёртвого колдуна в `view()`

**Files:**
- Modify: `play.js:35` (строка `players:s.players.map(q=>({...}))`)
- Test: `check.test.js`

**Interfaces:**
- Produces: `view(s,id).players[i]` дополнительно содержит `portrait: string` (путь вида `/assets/cards/wizards/0.webp`) и `dead: string[]` (пути `/assets/cards/dead/N.webp`, по одному на карту в `q.deadCards`). Остальные поля не меняются.

- [ ] **Step 1: Написать падающий тест**

```js
test('Вид отдаёт портреты и карты мёртвого колдуна', () => {
  const s = setup(names,77)
  s.players[1].deadCards.push(0,34)
  const p = view(s,null).players
  assert.equal(p[0].portrait,'/assets/cards/wizards/0.webp')
  assert.equal(p[1].portrait,'/assets/cards/wizards/1.webp')
  assert.deepEqual(p[1].dead,['/assets/cards/dead/0.webp','/assets/cards/dead/3.webp'])
  assert.deepEqual(p[0].dead,[])
})
```

- [ ] **Step 2: Убедиться, что тест падает**

Run: `node --test check.test.js`
Expected: FAIL — `portrait` равен `undefined`.

- [ ] **Step 3: Дополнить `view()` в `play.js`**

В объекте игрока (внутри `players:s.players.map(q=>({...}))`) добавить два поля рядом с `deadCount`:

```js
portrait:art('/assets/cards/wizards/'+q.portrait+'.webp'),
dead:q.deadCards.map(c=>art('/assets/cards/dead/'+Math.floor(c/10)+'.webp')),
```

- [ ] **Step 4: Проверить тесты**

Run: `npm test`
Expected: все тесты PASS, включая прежние проверки состава колоды.

---

### Task 3: `CardZoom` — превью карты при наведении

**Files:**
- Modify: `src.jsx` (новый компонент рядом с `MageMark`, импорт `createPortal` из `react-dom`)
- Modify: `style.css` (конец файла)

**Interfaces:**
- Produces: `CardZoom({src, alt, className})` — рендерит `<img className={className} src={src} alt={alt} tabIndex={0}>`; при наведении, фокусе или долгом нажатии (350 мс, `pointerType === 'touch'`) показывает через `createPortal` в `document.body` копию `<img className="card-preview" style={{left, top, height, width:'auto'}}>`; превью исчезает на `pointerleave`, `blur`, `pointerup`, `pointercancel`.
- Produces: CSS-класс `.card-preview` — `position:fixed; z-index:60; pointer-events:none; border-radius:10px; box-shadow:0 18px 60px #000a;`.
- Consumes: ничего из предыдущих задач.

- [ ] **Step 1: Написать компонент в `src.jsx` после `MageMark`**

```jsx
function CardZoom({src,alt='',className=''}) {
  const [box,setBox] = useState(null)
  const hold = useRef()
  const show = element => {
    if (!src) return
    const r = element.getBoundingClientRect()
    const height = Math.min(r.height * 2, innerHeight * 0.62)
    const width = height * 0.708
    const left = Math.max(8, Math.min(r.left + r.width/2 - width/2, innerWidth - width - 8))
    const top = r.top - height - 12 >= 8 ? r.top - height - 12 : Math.min(r.bottom + 12, innerHeight - height - 8)
    setBox({left, top, height, width})
  }
  const hide = () => { clearTimeout(hold.current); setBox(null) }
  useEffect(() => hide, [src])
  return <>
    <img className={className} src={src} alt={alt} tabIndex={0} draggable={false}
      onPointerEnter={event => { if (event.pointerType !== 'touch') show(event.currentTarget) }}
      onPointerLeave={hide} onFocus={event => show(event.currentTarget)} onBlur={hide}
      onPointerDown={event => { if (event.pointerType === 'touch') hold.current = setTimeout(() => show(event.currentTarget),350) }}
      onPointerUp={hide} onPointerCancel={hide}
      onError={event => { event.currentTarget.hidden = true }} />
    {box && createPortal(<img className="card-preview" src={src} alt="" style={{left:box.left, top:box.top, height:box.height, width:box.width}} />, document.body)}
  </>
}
```

Импорт: `import {createPortal} from 'react-dom'`.

- [ ] **Step 2: Добавить стили превью в конец `style.css`**

```css
.card-preview{position:fixed;z-index:60;pointer-events:none;border-radius:10px;box-shadow:0 18px 60px #000a}
```

- [ ] **Step 3: Проверить в браузере на временной картинке**

Временно вставить `CardZoom` в разметку главного экрана (например, `<CardZoom src="/assets/cards/spells/0.webp" className="card-art" />` внутри `.panel-content`) и открыть `http://127.0.0.1:5173/`.

Expected: при наведении появляется увеличенная копия над картой; при уходе курсора исчезает; в консоли нет ошибок. Убрать временную вставку.

- [ ] **Step 4: Проверить прижатие к краям**

Сузить окно до ~700 px и навести на карту у правого края: превью целиком в пределах вьюпорта, левый край ≥ 8 px.

---

### Task 4: Стол — карты-сканы, один экран, панель магов

**Files:**
- Modify: `src.jsx:142-255` (компонент `Table`)
- Modify: `style.css:86-176` (разметка стола, рука, слоты, панель, хроника) и медиазапросы `style.css:177-232`

**Interfaces:**
- Consumes: `CardZoom` из Task 3; поля `portrait` и `dead` из Task 2; `card.image`, `treasure.image` из `play.js`.
- Produces: классы `.hand-card`, `.slot-card`, `.mage-avatar`, `.mini`, `.journal` в новой разметке.

- [ ] **Step 1: Рука — только картинки**

Заменить блок `<div className="hand">` на:

```jsx
<div className="hand" aria-label="Ваша рука">{hand.length ? hand.map(card =>
  <button key={card.uid} className={'hand-card'+(selected.includes(card.uid)?' selected':'')}
    aria-pressed={planning ? selected.includes(card.uid) : undefined}
    aria-label={card.name} onClick={planning ? () => choose(card) : undefined}>
    <CardZoom src={card.image} className="card-art" alt={card.name}/>
  </button>) : <div className="empty-hand">{watch ? 'Руки видят только их владельцы' : me?.hp<=0 ? 'Вы вернётесь в следующей битве' : 'Рука пуста'}</div>}</div>
```

Удалить состояние `inspect`, кнопку `.card-zoom` и диалог `<Dialog title={inspect.name}>` с `.card-detail`.

- [ ] **Step 2: Слоты заклинания — картинки карт**

В `.spell` заменить содержимое заполненного слота на `<button className="slot-card" onClick={() => choose(card)} title="Убрать карту"><CardZoom src={card.image} className="card-art" alt={card.name}/></button>`; пустой слот оставляет `<div className="slot-empty">{planning ? 'Выберите карту' : '—'}</div>`. Название слота (`<div className="slot-title">`) остаётся над картой.

- [ ] **Step 3: Розыгрыш — картинки карт**

В `.reveal-cards` заменить текст на `<CardZoom src={card.image} className="card-art" alt={card.name}/>` внутри прежних кнопок; оставить `aria-label="Последнее заклинание"`. В `.resolved` оставить только имя разыгравшего мага.

- [ ] **Step 4: Панель магов и хроника**

Строку мага заменить на аватар + имя + полосу HP + число + значки:

```jsx
<div key={person.id} className={'mage '+(person.hp<=0?'dead ':'')+(person.id===g.active?'active':'')}>
  <img className="mage-avatar" src={person.portrait} alt="" onError={event=>{event.currentTarget.hidden=true}}/>
  <div className="mage-info"><b title={person.name}>{person.name}{person.id===g.me && <small> · Вы</small>}</b>
    <meter min="0" max="25" value={Math.max(0,person.hp)} aria-label={'Здоровье '+person.name}/></div>
  <strong title="Здоровье">{Math.max(0,person.hp)}</strong>
  <div className="mage-stats">
    <span title="Жетоны недобитого колдуна">✦ {person.medals}</span>
    <span title="Карт в руке">▣ {person.handCount}</span>
    {person.treasures.map((item,i) => <CardZoom key={i} src={item.image} className="mini" alt={item.name}/>)}
    {person.dead.map((src,i) => <CardZoom key={'d'+i} src={src} className="mini dead-mini" alt="Карта мёртвого колдуна"/>)}
    {person.ready && g.phase==='plan' && <span className="ready" title="Заклинание готово">✓</span>}
  </div>
</div>
```

Хронику сократить до трёх записей: `{log.slice(0,3).map((entry,i) => <li key={i}>{entry}</li>)}`, без прокрутки.

- [ ] **Step 5: Сетка стола в `style.css`**

Заменить блок `.table` … `.hand` (строки 86–157) на сетку с четырьмя рядами и рукой на всю ширину:

```css
.table{position:fixed;inset:0;display:grid;grid-template-columns:minmax(0,1fr) clamp(200px,22vw,300px);grid-template-rows:auto minmax(0,1fr) auto minmax(120px,22vh);grid-template-areas:'top top' 'arena side' 'bottom side' 'hand hand';background:#160f14;gap:1px;overflow:hidden}
.arena{grid-area:arena;position:relative;overflow:hidden;display:grid;place-items:center;isolation:isolate;user-select:none;touch-action:none;background:radial-gradient(ellipse at 50% 45%,#2b1424cc,#120a12f2),url('/assets/ui/arena-bg.webp') center/cover no-repeat}
.hand{grid-area:hand;display:flex;align-items:stretch;gap:6px;padding:8px;min-height:0;overflow:hidden;background:#20151b}
.hand-card{flex:1 1 0;min-width:0;padding:0;border:1px solid #6d4a3e;border-radius:8px;background:#1a1217;display:grid;place-items:center;transition:transform .12s,border-color .12s,box-shadow .12s}
.hand-card:hover{transform:translateY(-6px);border-color:#ffc88e;z-index:2}
.hand-card.selected{border-color:#ffe0a6;box-shadow:inset 0 0 0 2px #ffca7e,0 0 14px #ffc47c66}
.card-art{max-width:100%;max-height:100%;width:auto;height:auto;display:block;border-radius:6px;object-fit:contain}
.slot-card{padding:0;border:0;background:none;max-height:100%;display:grid;place-items:center}
.spell-slot{min-width:0;max-height:100%;display:flex;flex-direction:column;align-items:center;gap:4px;border:1px dashed #ffd4b655;background:#1c1118a8;border-radius:10px;padding:6px}
.spell-slot .card-art{max-height:34vh}
.mage{display:grid;grid-template-columns:auto minmax(0,1fr) auto;align-items:center;gap:2px 8px;padding:4px 6px;border-radius:8px;border:1px solid #b8796b37;background:#21171c;font-size:12px}
.mage-avatar{grid-row:span 2;width:34px;height:48px;object-fit:cover;object-position:top;border-radius:6px;border:1px solid #0006}
.mage-stats{grid-column:1/4;display:flex;align-items:center;gap:5px;overflow:hidden;white-space:nowrap;font-size:11px;color:#e0bbab}
.mini{height:26px;width:auto;border-radius:3px;border:1px solid #0007}
.dead-mini{height:22px;filter:grayscale(.5)}
.journal ol{list-style:none;padding:0;margin:0;overflow:hidden;-webkit-mask-image:linear-gradient(#000 70%,transparent);mask-image:linear-gradient(#000 70%,transparent);color:#c5ab9d;font-size:12px}
```

`.spell` оставить трёхколоночной, шириной `min(86%,820px)`, `max-height:100%`.

Удалить ставшие мёртвыми правила `.card-thumb`, `.card-detail`, `.card-zoom`, `.card-main`, `.card-type`, `.card-text`, `.card`, `.dark,.darkness`.

- [ ] **Step 6: Обновить медиазапросы**

В `@media(max-width:600px)` заменить правила руки и сетки на: `.table{grid-template-columns:minmax(0,1fr) minmax(120px,32vw);grid-template-rows:auto minmax(0,1fr) auto minmax(104px,24vh)}`, `.hand{gap:3px;padding:4px}`, `.mage-avatar{width:26px;height:36px}`, `.mini{height:20px}`, `.spell-slot .card-art{max-height:26vh}`.

- [ ] **Step 7: Проверить в браузере**

Открыть `http://127.0.0.1:5173/`, нажать «Начать битву» при 3 магах.
Expected: рука из 8 сканов целиком в один ряд; наведение показывает крупную карту; в трёх слотах после выбора видны сканы; панель магов показывает аватар, HP, значки; прокрутки нет.

- [ ] **Step 8: Проверить крайние случаи**

Окно 1024×768 и 390×844: рука без горизонтального скролла; наведение на первую и последнюю карту не обрезает превью; выбор трёх карт заполняет слоты без переполнения.

---

### Task 5: Главный экран, лобби и шторка на фоне меню

**Files:**
- Modify: `src.jsx` (компоненты `Mountain`, `Home`, `Lobby`, `App` — блок `curtain`)
- Modify: `style.css:26-42` (`.landscape`), `.home`, `.lobby`, `.curtain`

**Interfaces:**
- Consumes: `/assets/ui/menu-bg.webp` из Task 1, `/assets/ui/arena-bg.webp`.
- Produces: класс `.hero` с фоновой картинкой; компонент `Mountain` удалён.

- [ ] **Step 1: Убрать `Mountain` и заменить использования**

Удалить функцию `Mountain` целиком. В `Home` убрать `<Mountain/>` внутри `.hero`; в `Lobby` — `<Mountain/>`; в `.curtain` — `<Mountain/>`; в `Table` — `<div className="arena-map">…<Mountain/></div>`, поскольку фон арены теперь в CSS.

- [ ] **Step 2: Фоны в `style.css`**

Удалить правила `.landscape` … `.s3` (строки 26–41). Добавить:

```css
.hero{background:linear-gradient(100deg,#1a0f18e6 18%,#1a0f1899 52%,#1a0f18e6),url('/assets/ui/menu-bg.webp') center/cover no-repeat}
.lobby{background:linear-gradient(#150c13cc,#150c13f2),url('/assets/ui/menu-bg.webp') center/cover no-repeat}
.curtain{background:linear-gradient(#120a1088,#120a10e6),url('/assets/ui/arena-bg.webp') center/cover no-repeat}
```

Из `.hero` убрать `isolation` и `position` только если они не нужны остальным правилам; `.landscape` больше нигде не используется.

- [ ] **Step 3: Проверить визуально**

Открыть главную, лобби (`#/m/<код>` после «По сети») и шторку режима «За одним экраном».
Expected: на всех трёх экранах виден арт, текст читается, ошибок в консоли нет.

---

### Task 6: Автономный HTML, сборка, финальная проверка

**Files:**
- Modify: `standalone.mjs`
- Modify: `README.md` (строка про пересборку — упомянуть, что вшиваются все картинки)
- Rebuild: `dist/`, `Черепламень.html`

**Interfaces:**
- Consumes: все пути картинок из Task 1–3.
- Produces: HTML, в котором есть карты, портреты, мёртвые карты и фоны без сервера.

- [ ] **Step 1: Расширить `standalone.mjs` на все каталоги**

Заменить цикл `for(const deck of ['spells','treasures'])` на:

```js
for(const deck of ['spells','treasures','wizards','dead']){
  const folder=path.join(assetDir,'cards',deck)
  for(const name of await readdir(folder)){
    const key='/assets/cards/'+deck+'/'+name
    images[key]='data:image/webp;base64,'+(await readFile(path.join(folder,name))).toString('base64')
  }
}
const ui=path.join(assetDir,'ui')
for(const name of await readdir(ui)){
  const key='/assets/ui/'+name
  images[key]='data:image/webp;base64,'+(await readFile(path.join(ui,name))).toString('base64')
}
```

и расширить вставку CSS-картинок: вместо регулярки только для `.woff2` использовать

```js
for(const match of [...style.matchAll(/url\((["']?)(\/[^)'"\s]+)\1\)/g)]){
  const bytes=await readFile(path.join(dir,match[2].slice(1)))
  const type=match[2].endsWith('.woff2')?'font/woff2':'image/webp'
  style=style.replace(match[0],'url(data:'+type+';base64,'+bytes.toString('base64')+')')
}
```

- [ ] **Step 2: Собрать и пересобрать автономный файл**

```powershell
npm run build
node standalone.mjs "Черепламень.html"
Get-ChildItem "Черепламень.html" | Select-Object Name,Length
```

Expected: файл больше 9 МБ, сборка без ошибок.

- [ ] **Step 3: Проверить автономный файл в браузере**

Открыть `Черепламень.html` через `tools.browser.tabs.open({path})` (не `file://`), начать битву.
Expected: фон арены и сканы карт на месте, превью работает, консоль без ошибок.

- [ ] **Step 4: Прогнать тесты и сборку**

Run: `npm test`, затем `npm run build`
Expected: все тесты PASS, сборка успешна.

- [ ] **Step 5: Финальные скриншоты**

Сохранить скриншоты 1440×900, 1024×768, 390×844 и автономного файла в `docs/superpowers/specs/` рядом с дизайном (имена `2026-11-24-table-1440.png` и т.д.) и показать пользователю.

---

## Проверка соответствия спецификации

- Ассеты: Task 1 (три файла + тест), Task 5 (фоны), Task 6 (вшивание).
- Наведение ×2 без клика: Task 3, проверки в Task 4 Step 8.
- Один экран без прокрутки: Task 4 Steps 5–6.
- Минимум текста: Task 4 Steps 1–4.
- Портреты и карты мёртвого колдуна: Task 2 и Task 4 Step 4.
- Автономный HTML: Task 6.
