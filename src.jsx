import React, { useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { createPortal } from 'react-dom'
import * as engine from './play.js'
import './style.css'

const params = new URLSearchParams(location.search)
const routeFromHash = () => /^#\/m\/([\w-]+)(\/watch)?$/.exec(location.hash)
const palette = ['#e49472','#e6b960','#93bac5','#c1a0d4','#a5c686','#ec9eb4']
const emblems = ['✷','☽','✦','♜','◇','✺']
const kinds = {source:'Заводила',quality:'Наворот',delivery:'Приход',wild:'Шальная магия'}
const slots = ['source','quality','delivery']
const modeLabels = {bot:'С ботами',pass:'За одним экраном',online:'По сети'}
const localKey = 'skull-local'
const networkEnabled = location.protocol !== 'file:'
const stored = key => { try { return localStorage.getItem(key) } catch { return null } }
const save = (key,value) => { try { value===null ? localStorage.removeItem(key) : localStorage.setItem(key,value) } catch {} }
const nick = (params.get('name') || stored('skull-name') || '').slice(0,40)
if (params.get('embed') === '1') document.documentElement.classList.add('embedded')

function MageMark({index}) {
  return <span className="mage-mark" style={{'--mage':palette[index % palette.length]}} aria-hidden="true">{emblems[index % emblems.length]}</span>
}

const PIPS = {1:[4],2:[0,8],3:[0,4,8],4:[0,2,6,8],5:[0,2,4,6,8],6:[0,2,3,5,6,8]}

function Die({value}) {
  return <span className="die" aria-label={String(value)}>{Array.from({length:9},(_,i)=><i key={i} className={PIPS[value]?.includes(i)?'on':''}/>)}</span>
}

function DiceOverlay({rolls,players}) {
  const [queue,setQueue] = useState([])
  const [current,setCurrent] = useState(null)
  const [phase,setPhase] = useState('tumble')
  const [faces,setFaces] = useState([])
  const seen = useRef(null)
  const initialized = useRef(false)
  useEffect(() => {
    const list = Array.isArray(rolls) ? rolls : []
    const max = list.reduce((top,roll) => Math.max(top,roll.id),0)
    if (!initialized.current) { initialized.current = true; seen.current = max; return }
    const fresh = list.filter(roll => roll.id > seen.current).sort((a,b) => a.id-b.id)
    if (!fresh.length) return
    seen.current = fresh.at(-1).id
    setQueue(previous => [...previous,...fresh])
  },[rolls])
  useEffect(() => {
    if (current || !queue.length) return
    const [next,...rest] = queue
    setQueue(rest); setCurrent(next)
  },[queue,current])
  useEffect(() => {
    if (!current) return
    const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
    const count = current.dice.length
    const roll = () => Array.from({length:count},() => 1 + Math.floor(Math.random()*6))
    setPhase(reduced ? 'result' : 'tumble')
    setFaces(reduced ? current.dice : roll())
    const spin = reduced ? null : setInterval(() => setFaces(roll()),90)
    const settle = setTimeout(() => { if (spin) clearInterval(spin); setFaces(current.dice); setPhase('result') },reduced ? 0 : 900)
    const close = setTimeout(() => setCurrent(null),reduced ? 1500 : 2400)
    return () => { if (spin) clearInterval(spin); clearTimeout(settle); clearTimeout(close) }
  },[current])
  if (!current) return null
  const roller = players.find(person => person.id === current.p)
  const label = current.label || null
  return <div className="dice-overlay" onClick={() => setCurrent(null)} role="status" aria-live="polite">
    <div className="dice-panel">
      <div className="dice-who"><b>{roller?.name || 'Маг'}</b> бросает кубики</div>
      {label && <div className="dice-label">«{label}»</div>}
      <div className={'dice-row'+(phase === 'tumble' ? ' tumbling' : '')}>{faces.map((value,index) => <Die key={index} value={value}/>)}</div>
      <div className="dice-total">{phase === 'result'
        ? <><span>{current.dice.join(' + ')}</span>{current.bonus ? <small>бонус {current.bonus > 0 ? '+' : ''}{current.bonus}</small> : null}<span>=</span> <b>{current.total}</b></>
        : <span>бросаем…</span>}</div>
    </div>
  </div>
}

function CardZoom({src,alt='',className=''}) {
  const [box,setBox] = useState(null)
  const hold = useRef()
  const held = useRef(false)
  useEffect(() => { setBox(null) },[src])
  useEffect(() => () => clearTimeout(hold.current),[])
  const show = element => {
    if (!src || !element) return
    const rect = element.getBoundingClientRect()
    const height = Math.min(Math.min(Math.max(rect.height*2,320),innerHeight*0.62),(innerWidth-16)/0.708)
    const width = height*0.708
    const left = Math.max(8,Math.min(rect.left+rect.width/2-width/2,innerWidth-width-8))
    const top = rect.top-height-12>=8 ? rect.top-height-12 : Math.min(rect.bottom+12,innerHeight-height-8)
    setBox({left,top,height,width})
  }
  const hide = () => { clearTimeout(hold.current); setBox(null) }
  const cancel = () => { held.current = false; hide() }
  return <>
    <img className={className} src={src} alt={alt} draggable={false}
      onPointerEnter={event => { if (event.pointerType !== 'touch') show(event.currentTarget) }}
      onPointerLeave={hide}
      onPointerDown={event => {
        held.current = false
        if (event.pointerType !== 'touch') return
        const element = event.currentTarget
        clearTimeout(hold.current)
        hold.current = setTimeout(() => { held.current = true; show(element) },350)
      }}
      onPointerUp={() => { clearTimeout(hold.current); setBox(null) }}
      onPointerCancel={cancel}
      onClickCapture={event => {
        if (!held.current) return
        event.preventDefault(); event.stopPropagation()
        held.current = false
      }}
      onTouchEnd={event => {
        if (held.current) event.preventDefault()
        clearTimeout(hold.current)
        setBox(null)
      }}
      onError={event => { event.currentTarget.hidden = true }} />
    {box && createPortal(<img className="card-preview" src={src} alt="" style={{left:box.left,top:box.top,height:box.height,width:box.width}}/>,document.body)}
  </>
}

async function request(path, {key,body,signal} = {}) {
  const response = await fetch(path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {...(body === undefined ? {} : {'Content-Type':'application/json'}),...(key ? {Authorization:'Bearer '+key} : {})},
    body: body === undefined ? undefined : JSON.stringify(body),
    signal
  })
  const data = await response.json().catch(() => null)
  if (!response.ok || !data) throw new Error(data?.error || data?.message || 'Связь с комнатой потеряна')
  return data
}

function Help({close}) {
  return <Dialog title="Правила · коротко" close={close}>
    <p>Побеждает маг, первым собравший два жетона «Недобитый колдун». Жетон получает последний выживший в битве.</p>
    <ol>
      <li><b>Соберите заклинание.</b> Выберите до трёх карт. В заклинании может быть по одному заводиле, навороту и приходу. Дикая карта занимает выбранное свободное место.</li>
      <li><b>Раскройте заклинания.</b> Заклинания из меньшего числа карт разыгрываются раньше. При равном числе карт первым идёт большее значение инициативы.</li>
      <li><b>Примените эффекты.</b> Карты действуют слева направо. Заклинания могут наносить урон, лечить, давать сокровища или требовать броска кубиков. Тип магии карты может влиять на число кубиков.</li>
      <li><b>Вернитесь в бой.</b> Выбывшие маги получают карты мёртвого колдуна и возвращаются в следующей битве. Сокровища действуют до конца текущей битвы.</li>
    </ol>
    <a target="_blank" rel="noreferrer" href="https://hobbygames.ru/download/rules/epichnie-shvatki-boevih-magov-bitva-na-gore-chereplameni-rules.pdf">Официальные правила · PDF ↗</a>
  </Dialog>
}

function Dialog({title,close,children}) {
  const ref = useRef()
  useEffect(() => {
    ref.current.showModal()
  },[])
  return <dialog ref={ref} onCancel={event => {event.preventDefault(); close()}} onClick={event => {if(event.target === ref.current) close()}}>
    <div className="dialog-inner"><header><h2>{title}</h2><button className="icon-btn" onClick={close} aria-label="Закрыть">×</button></header>{children}</div>
  </dialog>
}

function Home({launch,create,showRules,busy,error}) {
  const [mode,setMode] = useState('bot')
  const [count,setCount] = useState(3)
  const [names,setNames] = useState([nick || 'Первый маг','','','','',''])
  const [room,setRoom] = useState('')
  function submit(event) {
    event.preventDefault()
    if (mode === 'online') create(count)
    else launch(names.slice(0,count).map((name,i) => mode === 'bot' && i ? ['','Ведьма Иней','Фокусник Прах','Маг Трутовик','Колдун Клёкот','Провидица Зола'][i] : name.trim() || 'Маг '+(i+1)),mode)
  }
  return <main className="home">
    <section className="hero">
      <header className="hero-top"><b>✷ &nbsp; ZARYA BOARDGAMES</b><button className="subtle" onClick={showRules}>Правила</button></header>
      <div className="hero-copy"><div className="eyebrow">ЭПИЧНЫЕ СХВАТКИ БОЕВЫХ МАГОВ</div><h1>Битва на горе<br/>Черепламени</h1><p>Соберите заклинание. Переживите его последствия.</p></div>
      <footer className="hero-foot"><span>2–6 МАГОВ</span><span>✦</span><span>КАРТОЧНАЯ ДУЭЛЬ</span></footer>
    </section>
    <section className="home-panel">
      <div className="panel-content">
        <h2>К бою</h2>
        <form onSubmit={submit}>
          <div className="mode-tabs" aria-label="Режим игры">{Object.entries(modeLabels).filter(([id])=>networkEnabled||id!=='online').map(([id,label]) => <button key={id} type="button" aria-pressed={id===mode} onClick={() => setMode(id)}>{label}</button>)}</div>
          <div className="field-label">Число магов</div>
          <div className="count-options">{[2,3,4,5,6].map(number => <button key={number} type="button" aria-pressed={number===count} onClick={() => setCount(number)}>{number}</button>)}</div>
          {mode !== 'online' && <div className="name-fields">{names.slice(0,mode === 'bot' ? 1 : count).map((name,i) => <label key={i}><MageMark index={i}/><input aria-label={mode === 'bot' ? 'Ваше имя' : 'Имя мага '+(i+1)} placeholder={'Маг '+(i+1)} value={name} maxLength={40} onChange={event => setNames(previous => previous.map((item,k) => k===i ? event.target.value : item))}/></label>)}</div>}
          <button className="primary full" disabled={busy}>{mode === 'online' ? 'Создать комнату' : 'Начать битву'} <span>→</span></button>
        </form>
        {networkEnabled && <form className="join" onSubmit={event => {event.preventDefault(); location.hash='/m/'+room.trim()}}>
          <label htmlFor="room-code">Уже есть комната?</label>
          <div><input id="room-code" value={room} onChange={event => setRoom(event.target.value)} placeholder="Код комнаты" pattern="[A-Za-z0-9_-]+" required/><button className="subtle" type="submit">Войти</button></div>
        </form>}
        {error && <p className="error" role="alert">{error}</p>}
      </div>
    </section>
  </main>
}

function Lobby({data,code,watch,call,showRules,error,busy}) {
  const [name,setName] = useState(() => (params.get('name') || stored('skull-name') || '').slice(0,40))
  const [copied,setCopied] = useState('')
  const invite = hash => location.origin+location.pathname+'#/m/'+code+hash
  async function copy(hash) {
    try { await navigator.clipboard.writeText(invite(hash)); setCopied(hash || 'play') }
    catch { setCopied('Полный адрес можно скопировать из поля ниже.') }
  }
  return <main className="lobby"><div className="lobby-inner">
    <header className="lobby-top"><a className="subtle chrome" href="#">← На главную</a><button className="subtle" onClick={showRules}>Правила</button></header>
    <div className="eyebrow">КОМНАТА {code}</div><h1>Совет магов</h1>
    <p>{watch ? 'Вы смотрите за подготовкой к битве' : 'Выберите свободное место. Битву начинает маг с первого места.'}</p>
    {!watch && data?.seat == null && <label className="seat-name">Имя мага <input value={name} onChange={event => setName(event.target.value)} maxLength={40} autoComplete="nickname"/></label>}
    <div className="lobby-seats">{data?.players.map((person,i) => <div key={person.id} className="lobby-seat"><MageMark index={i}/><span><b>{person.name || 'Свободное место'}</b><small>{person.id===data.seat ? 'Ваше место' : i===0 ? 'Хозяин комнаты' : 'Место '+(i+1)}</small></span>{!watch && data.seat == null && !person.name && <button className="subtle" disabled={busy || !name.trim()} onClick={() => {save('skull-name',name.trim());call('/seat',{seat:person.id,name:name.trim()})}}>Занять место</button>}</div>)}</div>
    {!data?.game && data?.seat === 0 && !watch && <button className="primary" disabled={busy || data.players.some(person => !person.name)} onClick={() => call('/start',{})}>Начать битву →</button>}
    {data && !watch && <div className="invites chrome"><button className="subtle" onClick={() => copy('')}>{copied==='play' ? 'Ссылка скопирована' : 'Ссылка для игроков'}</button><button className="subtle" onClick={() => copy('/watch')}>{copied==='/watch' ? 'Ссылка скопирована' : 'Ссылка для зрителя'}</button>{copied.startsWith('Полный') && <input readOnly value={invite('/watch')} onFocus={event => event.target.select()} aria-label="Ссылка для зрителя"/>}</div>}
    {!data && !error && <p role="status">Подключаемся к комнате…</p>}
    {error && <p className="error" role="alert">{error}</p>}
  </div></main>
}

function playLocal(state, action, actor) {
  const next = engine.apply(state,action,actor)
  if (next?.error) throw new Error(next.error)
  return next
}

function nextSeat(state, ids) {
  const g = engine.view(state,null)
  if (g.pending && ids.includes(g.pending.player)) return g.pending.player
  return g.players.find(person => ids.includes(person.id) && person.hp > 0 && !person.ready)?.id
}

function Table({g,mode,code,watch,onAction,showRules,showResults,error,busy,onReset,undo,leave}) {
  const [selected,setSelected] = useState([])
  const [wildSlots,setWildSlots] = useState({})
  const [recent,setRecent] = useState(false)
  const [stall,setStall] = useState(false)
  const [narrow,setNarrow] = useState(() => typeof innerWidth === 'number' && innerWidth < 700)
  const miniLimit = narrow ? 1 : 3
  useEffect(() => {
    const query = matchMedia('(max-width:700px)')
    const sync = () => setNarrow(query.matches)
    query.addEventListener('change',sync)
    return () => query.removeEventListener('change',sync)
  },[])
  const hand = g.hand || []
  const me = g.players.find(person => person.id === g.me)
  const planning = g.phase === 'plan' && me && me.hp > 0 && !me.ready
  const awaiting = g.players.filter(person => person.hp > 0 && !person.ready)
  const active = g.players.find(person => person.id === g.active)
  const winner = g.players.find(person => person.id === g.winner)
  const [goLast,setGoLast] = useState(false)
  const log = g.log || []
  const waitingKey = awaiting.map(person => person.id).join(',')
  useEffect(() => {
    setSelected([]);setWildSlots({});setGoLast(false)
  },[g.phase,g.battle,g.turn,g.me])
  useEffect(() => {
    setRecent(true)
    const timer = setTimeout(() => setRecent(false),2700)
    return () => clearTimeout(timer)
  },[log[0]])
  useEffect(() => {
    setStall(false)
    const timer = setTimeout(() => setStall(true),30000)
    return () => clearTimeout(timer)
  },[waitingKey,g.phase,g.turn])
  const cardKind = card => card.type === 'wild' ? wildSlots[card.uid] : card.type
  const chosen = hand.filter(card => selected.includes(card.uid))
  const free = slots.filter(slot => !chosen.some(card => cardKind(card)===slot))
  function choose(card) {
    if (!planning) return
    if (selected.includes(card.uid)) return setSelected(selected.filter(id => id!==card.uid))
    if (card.type === 'wild' && !free.length) return
    const kind = card.type === 'wild' ? free[0] : card.type
    if (card.type === 'wild') setWildSlots({...wildSlots,[card.uid]:kind})
    setSelected([...chosen.filter(item => cardKind(item)!==kind).map(item => item.uid),card.uid])
  }
  const action = g.phase === 'plan'
    ? {type:'commit',cards:slots.map(slot => chosen.find(card => cardKind(card)===slot)?.uid).filter(id => id!==undefined),slots:Object.fromEntries(chosen.filter(card=>card.type==='wild').map(card=>[card.uid,wildSlots[card.uid]])),goLast}
    : {type:'next'}
  const phaseLabel = g.phase === 'plan' ? 'Сбор заклинаний' : g.phase === 'reveal' ? 'Розыгрыш' : g.phase === 'roundEnd' ? 'Конец битвы' : 'Финал'
  const casterPerson = g.players.find(person => person.id === g.resolving?.player)
  const activeCard = g.resolving?.cards?.find(card => card.on && !card.done) || null
  const canResume = !!g.paused && g.active === g.me
  const status = g.phase === 'over' ? (winner ? 'Победитель — '+winner.name : 'Партия завершена')
    : g.phase === 'roundEnd' ? (watch ? 'Ожидаем следующую битву' : 'Начните следующую битву')
    : g.pending ? (g.pending.player===g.me ? 'Ваш выбор' : 'Ждём выбора · '+(active?.name || 'маг'))
    : canResume ? (activeCard ? 'Ваша карта: '+activeCard.name : 'Разыграйте заклинание')
    : g.paused ? 'Разыгрывает · '+(casterPerson?.name || 'маг')
    : g.phase === 'reveal' ? 'Заклинания разыгрываются'
    : planning ? 'Соберите заклинание из карт в руке'
    : (awaiting.length ? 'Ждём: '+awaiting.map(person => person.name).join(', ') : 'Все заклинания готовы')
  const canNext = !!me && g.phase==='roundEnd'
  const revealed = g.resolving?.cards?.length ? g.resolving.cards : (g.lastSpell?.cards || [])
  const pickable = uid => g.pending?.player === g.me && g.pending.options.some(option => option.v === uid)
  const others = g.players.filter(person => person.id !== g.me)
  const mySpell = g.me != null ? (g.spells?.find(item => item.player === g.me)?.cards || []) : revealed
  const placement = slots.map(() => null)
  mySpell.forEach(item => {
    const at = slots.findIndex((slot,i) => !placement[i] && (item.slot || item.type) === slot)
    const index = at >= 0 ? at : placement.indexOf(null)
    if (index >= 0) placement[index] = item
  })
  return <main className="table">
    <header className="table-top"><div className="table-brand"><span>✷</span><div><b>Гора Черепламени</b><small>{code ? 'Комната '+code : modeLabels[mode]}{watch ? ' · Зритель' : ''}</small></div></div><div className="table-meta">Битва {g.battle} <i/> Раунд {g.turn}</div><div className="table-tools"><button className="subtle" onClick={showRules}>Правила</button>{undo && <button className="subtle chrome" onClick={undo} disabled={busy} title="Отменить последнее действие">↶</button>}{leave && <button className="subtle chrome" onClick={leave} disabled={busy}>Встать</button>}<button className="subtle chrome" onClick={onReset}>В лобби</button></div></header>
    <section className="arena" aria-label="Поле битвы">
      <div className="phase-label"><i/>{phaseLabel}</div>
      {recent && log[0] && <div className="event-pill" role="status">{log[0]}</div>}
      <div className="board">
        <div className="opponents" role="group" aria-label="Заклинания противников">
          {others.map(person => {
            const info = g.spells?.find(item => item.player === person.id) || {count:0,cards:null}
            const acting = g.resolving?.player === person.id
            return <div className={'opponent'+(acting ? ' active' : '')} key={person.id}>
              <b title={person.name}>{person.name}</b>
              <div className="opponent-cards">
                {info.cards?.length
                  ? info.cards.map(card => <div key={card.uid} className={'mini-card'+(card.done ? ' done' : '')+(card.on && !card.done ? ' active' : '')}><CardZoom src={card.image} className="card-art" alt={card.name}/></div>)
                  : info.count
                    ? Array.from({length:info.count},(_,i) => <div key={i} className="mini-card back"><img src={g.back} alt="" draggable="false"/></div>)
                    : <span className="opponent-empty">—</span>}
              </div>
            </div>
          })}
        </div>
        {g.phase === 'plan' ? <div className="spell" role="group" aria-label="Заклинание">
          {slots.map((slot,i) => {
            const card = chosen.find(item => cardKind(item)===slot)
            return <div className={'spell-slot'+(card ? ' filled' : '')} key={slot}>
              <div className="slot-title"><span>{['✷','✧','✹'][i]}</span>{kinds[slot]}</div>
              {card ? <><button className="slot-card" onClick={() => choose(card)} title="Убрать карту"><CardZoom src={card.image} className="card-art" alt={card.name}/></button>{card.type === 'wild' && <select aria-label="Позиция дикой карты" value={slot} onChange={event => setWildSlots({...wildSlots,[card.uid]:event.target.value})}>{[slot,...free].map(option => <option key={option} value={option}>{kinds[option]}</option>)}</select>}</> : <div className="slot-empty">{planning ? 'Выберите карту' : '—'}</div>}
            </div>
          })}
        </div> : <div className="spell-area">
          <div className="spell" role="group" aria-label="Моё заклинание" key={mySpell.map(card=>card.uid+(card.done?'d':'')+(card.on?'o':'')).join(',')}>
            {slots.map((slot,i) => {
              const card = placement[i]
              const canPick = card && pickable(card.uid)
              const state = card ? ((card.done ? ' done' : '') + (card.on && !card.done ? ' active' : '') + (canPick ? ' pickable' : '')) : ''
              return <div className={'spell-slot'+(card ? ' filled' : '')+state} key={slot}>
                <div className="slot-title"><span>{['✷','✧','✹'][i]}</span>{kinds[slot]}</div>
                {card ? (canPick
                  ? <button className="slot-card" onClick={() => onAction({type:'choose',value:card.uid})} title="Выбрать эту карту: сработает первой"><CardZoom src={card.image} className="card-art" alt={card.name}/></button>
                  : canResume && card.on && !card.done
                    ? <button className="slot-card" onClick={() => onAction({type:'resume'})} title="Разыграть карту"><CardZoom src={card.image} className="card-art" alt={card.name}/></button>
                    : <div className="slot-card"><CardZoom src={card.image} className="card-art" alt={card.name}/></div>)
                  : <div className="slot-empty">—</div>}
              </div>
            })}
          </div>
          {g.pending && g.pending.player === g.me ? <div className="pending-bar" role="group" aria-label={g.pending.prompt}>
            {casterPerson && casterPerson.id !== g.me && <small>{casterPerson.name}{activeCard ? ' · '+activeCard.name : ''}</small>}
            <b>{g.pending.prompt}</b>
            <div>{g.pending.options.map(option => <button key={String(option.v)} className="subtle" disabled={busy} onClick={() => onAction({type:'choose',value:option.v})}>{option.label}</button>)}{g.pending.optional && <button className="subtle" disabled={busy} onClick={()=>onAction({type:'choose',value:null})}>Пропустить</button>}</div>
            {g.pending.byCard && <small>Или нажмите на карту на столе</small>}
          </div> : g.pending ? <div className="pending-wait">{'Выбирает · '+(g.players.find(person=>person.id===g.pending.player)?.name || 'маг')}</div> : null}
        </div>}
      </div>
      {g.phase !== 'plan' && casterPerson && <div className="resolved" aria-label="Разыгравший заклинание"><b>{casterPerson.name}</b></div>}
    </section>
    <aside className="sidebar"><section className="mages"><h2>Маги</h2><div className="mage-list">{g.players.map((person,i) => {
      const minis = [...person.treasures.map((item,k) => ({key:'t'+k,src:item.image,alt:item.name,dead:false})),...person.dead.map((src,k) => ({key:'d'+k,src,alt:'Карта мёртвого колдуна',dead:true}))]
      return <div key={person.id} className={'mage '+(person.hp<=0?'dead ':'')+(person.id===g.active?'active':'')} style={{'--mage':palette[i]}}>
      <img className="mage-avatar" src={person.portrait} alt="" onError={event=>{event.currentTarget.hidden=true}}/>
      <div className="mage-info"><b title={person.name}>{person.name}{person.id===g.me && <small> · Вы</small>}</b><meter min="0" max="25" value={Math.max(0,person.hp)} aria-label={'Здоровье '+person.name}/></div><strong title="Здоровье">{Math.max(0,person.hp)}</strong>
      <div className="mage-stats">{person.ready && g.phase==='plan' && <span className="ready" title="Заклинание готово">✓</span>}<span title="Жетоны недобитого колдуна">✦ {person.medals}</span><span title="Карт в руке">▣ {person.handCount}</span>{minis.slice(0,miniLimit).map(item => <CardZoom key={item.key} src={item.src} className={'mini'+(item.dead?' dead-mini':'')} alt={item.alt}/>)}{minis.length>miniLimit && <span className="more" title={minis.slice(miniLimit).map(item => item.alt).join(', ')}>+{minis.length-miniLimit}</span>}</div>
    </div>})}</div></section><section className="journal"><h2>Хроника</h2><ol aria-label="Журнал партии">{log.slice(0,3).map((entry,i) => <li key={i}>{entry}</li>)}</ol></section></aside>
    <section className="bottom"><div className="status-line"><span role="status">{status}{stall && g.phase==='plan' && !planning && awaiting.length>0 && <small> · Ждём более 30 секунд</small>}</span><div>
      {canResume && <button className="primary" disabled={busy} onClick={() => onAction({type:'resume'})}>{activeCard ? 'Разыграть · '+activeCard.name : 'Разыграть'}</button>}
      {planning && g.canGoLast && <label className="go-last"><input type="checkbox" checked={goLast} onChange={event=>setGoLast(event.target.checked)}/> Ходить последним</label>}
      {planning && <button className="primary" disabled={busy || !selected.length} onClick={() => onAction(action)}>{selected.length ? 'Готово · '+selected.length : 'Готово'}</button>}
      {canNext && <button className="primary" disabled={busy} onClick={() => onAction(action)}>Следующая битва</button>}
      {g.phase==='over' && <button className="primary" onClick={showResults}>Итоги</button>}
    </div></div>
    {error && <div className="table-error" role="alert">{error}</div>}
    </section>
    <div className="hand" role="group" aria-label="Ваша рука">{hand.length ? hand.map(card => <button key={card.uid} className={'hand-card'+(selected.includes(card.uid)?' selected':'')} aria-pressed={planning ? selected.includes(card.uid) : undefined} aria-label={card.name} onClick={planning ? () => choose(card) : undefined}>
      <CardZoom src={card.image} className="card-art" alt={card.name}/>
    </button>) : <div className="empty-hand">{watch ? 'Руки видят только их владельцы' : me?.hp<=0 ? 'Вы вернётесь в следующей битве' : 'Рука пуста'}</div>}</div>
    <DiceOverlay rolls={g.rolls} players={g.players}/>
  </main>
}

function Results({g,close}) {
  const winner = g.players.find(person => person.id===g.winner)
  return <Dialog title="Итоги партии" close={close}><div className="victory"><span>✦</span><strong>{winner?.name || 'Партия завершена'}</strong></div><ol className="score-list">{[...g.players].sort((a,b)=>b.medals-a.medals).map(person=><li key={person.id}><MageMark index={person.id}/><b>{person.name}</b><span title="Жетоны недобитого колдуна">✦ {person.medals}</span></li>)}</ol></Dialog>
}

function restoreLocal() {
  if (location.hash !== '#/local') return null
  try {
    const data=JSON.parse(stored(localKey))
    if (data?.state?.players && ['bot','pass'].includes(data.mode)) return data
  } catch {}
  return null
}

function App() {
  const [route,setRoute] = useState(routeFromHash)
  const [network,setNetwork] = useState(null)
  const [local,setLocal] = useState(restoreLocal)
  const [help,setHelp] = useState(false)
  const [results,setResults] = useState(false)
  const [error,setError] = useState('')
  const [busy,setBusy] = useState(false)
  const [curtain,setCurtain] = useState(()=>restoreLocal()?.mode==='pass')
  const code = route?.[1]
  const watch = Boolean(route?.[2])
  const keyName = 'skull-seat:'+(code || '')
  const storedKey = () => watch ? '' : stored(keyName)
  const match = route ? (watch || network?.seat!=null ? network?.game : null) : local?.state ? engine.view(local.state,local.actor) : null

  useEffect(() => {
    const changed = () => {
      const restored=restoreLocal()
      setError('');setBusy(false);setNetwork(null);setLocal(restored);setCurtain(restored?.mode==='pass');setResults(false);setRoute(routeFromHash())
    }
    window.addEventListener('hashchange',changed)
    return () => window.removeEventListener('hashchange',changed)
  },[])
  useEffect(() => {
    if (local) save(localKey,JSON.stringify(local))
  },[local])
  useEffect(() => {
    if (!code) return
    const controller = new AbortController()
    let last = 0
    async function refresh() {
      const current = ++last
      const key = storedKey()
      try {
        const data = await request('/api/'+code+'/view',{key,signal:controller.signal})
        if (controller.signal.aborted || current!==last || key!==storedKey()) return
        setNetwork(previous => !previous || data.revision >= previous.revision ? data : previous)
        setError(previous => previous === 'Связь с комнатой потеряна' ? '' : previous)
      } catch (issue) {
        if (!controller.signal.aborted && current===last) setError(issue.message)
      }
    }
    const source = new EventSource('/api/'+code+'/events')
    source.onmessage=refresh
    source.addEventListener('revision',refresh)
    source.onopen=refresh
    // Polling also recovers disconnected sessions and proxies that buffer SSE.
    const timer=setInterval(refresh,3500)
    refresh()
    return () => {controller.abort();source.close();clearInterval(timer)}
  },[code,watch])
  useEffect(() => {
    if (match?.phase==='over') setResults(true)
  },[match?.phase])

  async function networkCall(endpoint,body) {
    setError('');setBusy(true)
    try {
      const data = await request('/api/'+code+endpoint,{key:storedKey(),body})
      if (data.key) save(keyName,data.key)
      if (endpoint==='/leave') save(keyName,null)
      const update = await request('/api/'+code+'/view',{key:storedKey()})
      if (routeFromHash()?.[1]===code && !routeFromHash()?.[2]) setNetwork(previous => !previous || update.revision >= previous.revision ? update : previous)
    } catch (issue) {if (routeFromHash()?.[1]===code) setError(issue.message)}
    finally {if (routeFromHash()?.[1]===code) setBusy(false)}
  }
  async function create(numPlayers) {
    setError('');setBusy(true)
    try {
      const data = await request('/games/skullzfyre/create',{body:{numPlayers}})
      location.hash='/m/'+data.matchID
    } catch (issue) {setError(issue.message)}
    finally {setBusy(false)}
  }
  function launch(names,mode) {
    setError('');setResults(false)
    try {
      let state = engine.setup(names,crypto.getRandomValues(new Uint32Array(1))[0] || 1)
      if (import.meta.env.DEV && params.has('autoplay')) {
        const round = Math.max(1,Number(params.get('autoplay')) || 1)
        for(let i=0;i<2000;i++){
          const g=engine.view(state,null)
          if (g.phase==='over'||g.turn>=round) break
          const actor=g.pending?.player??(g.phase==='plan'?nextSeat(state,g.players.map(p=>p.id)):g.active??g.players[0].id)
          const move=g.phase==='plan'||g.pending?engine.botAction(state,actor):{type:'next'}
          if (!move) break
          state=playLocal(state,move,actor)
        }
      }
      const g = engine.view(state,null)
      const actor = mode==='bot' ? g.players[0].id : nextSeat(state,g.players.map(person=>person.id)) ?? g.players[0].id
      history.pushState(null,'','#/local')
      setLocal({state,mode,actor})
      setCurtain(mode==='pass' && !(import.meta.env.DEV && params.has('nocurtain')))
    } catch (issue) {setError(issue.message)}
  }
  function doLocal(action) {
    setError('')
    try {
      const {state,actor,mode}=local
      const nextState=playLocal(state,action,actor)
      const current=engine.view(nextState,null)
      let nextActor=actor
      if (mode==='pass' && (current.phase==='plan'||current.pending||current.paused)) {
        nextActor=current.paused
          ? (current.active??actor)
          : (nextSeat(nextState,current.players.map(person=>person.id))??actor)
        if(nextActor!==actor && !(import.meta.env.DEV && params.has('nocurtain'))) setCurtain(true)
      }
      setLocal({mode,actor:nextActor,state:nextState,undo:{actor,state}})
    } catch (issue) {setError(issue.message)}
  }
  useEffect(() => {
    if (!local || local.mode!=='bot' || !(match?.phase==='plan'||match?.pending||match?.paused)) return
    const bot=match.paused
      ? match.players.find(person=>person.id===match.active && person.id!==local.actor)
      : match.pending
        ? match.players.find(person=>person.id===match.pending.player && person.id!==local.actor)
        : match.players.find(person=>person.id!==local.actor && person.hp>0 && !person.ready)
    if(!bot) return
    const timer=setTimeout(() => {
      try {
        const move=engine.botAction(local.state,bot.id)
        if(move) setLocal(previous => previous===local ? {...local,state:playLocal(local.state,move,bot.id)} : previous)
      } catch(issue) {setError(issue.message)}
    },390)
    return () => clearTimeout(timer)
  },[local,match?.phase])

  function reset() {
    if(local) save(localKey,null)
    setLocal(null);setResults(false);setError('');setCurtain(false)
    if(code || location.hash==='#/local') location.hash=''
  }
  function undoLocal() {
    const {actor,state}=local.undo
    state.log=[...state.log,'Отменено последнее действие.']
    if (local.mode==='pass' && actor!==local.actor) setCurtain(true)
    if (state.pending?.base) {
      const base=JSON.parse(state.pending.base)
      base.log.push('Отменено последнее действие.')
      state.pending.base=JSON.stringify(base)
    }
    setLocal({actor,state,mode:local.mode})
  }
  const showRules=() => setHelp(true)
  const shown=curtain && local ? engine.view(local.state,null) : match
  return <>
    {shown ? <Table g={shown} mode={code ? 'online' : local?.mode} code={code} watch={watch} onAction={code ? action => networkCall('/action',{action,revision:network.revision}) : doLocal} showRules={showRules} showResults={() =>setResults(true)} error={error} busy={busy} onReset={reset} undo={code ? (network.canUndo ? () => networkCall('/undo',{revision:network.revision}) : null) : (local.undo && match.phase!=='over' ? undoLocal : null)} leave={code && !watch && network.seat!=null ? () => networkCall('/leave',{}) : null}/>
    : code ? <Lobby data={network} code={code} watch={watch} call={networkCall} error={error} busy={busy} showRules={showRules}/>
    : <Home launch={launch} create={create} showRules={showRules} busy={busy} error={error}/>}
    {curtain && local && match && <div className="curtain"><div><div className="eyebrow">СЛЕДУЮЩИЙ МАГ</div><h2>{match.players.find(person=>person.id===local.actor)?.name}</h2><p>Передайте устройство этому игроку.</p><button className="primary" onClick={()=>setCurtain(false)}>Показать мою руку →</button></div></div>}
    {help && <Help close={()=>setHelp(false)}/>}
    {results && match && !help && <Results g={match} close={()=>setResults(false)}/>}
  </>
}

createRoot(document.getElementById('root')).render(<App/>)

