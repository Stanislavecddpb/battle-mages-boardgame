import {create,reduce,spellOf,T,TREASURES,SCHOOL_NAMES,legalActions} from './base-rules.js'
const slots=['source','quality','delivery']
const art=path=>globalThis.SKULL_ART?.[path]??path
function card(uid){
 const c=uid===-1?{index:0,type:'wild',name:'Протонная ловушка',text:'Сбросьте сокровище, чтобы заменить компонент шальной магией.'}:spellOf(uid)
 return {uid,id:c.index,name:c.name,type:c.type,school:c.school,schoolName:SCHOOL_NAMES[c.school],initiative:c.initiative,image:art('/assets/cards/spells/'+c.index+'.webp'),text:[c.text,c.victim,...(c.mighty||[]).map(r=>r.from+(r.to?'–'+r.to:'+')+' • '+r.text)].filter(Boolean).join(' ')}
}
export function setup(names,seed){
 if(!Array.isArray(names)||names.length<2||names.length>6) throw Error('Нужно от двух до шести магов')
 let hash=2166136261
 for(const c of String(seed)) hash=Math.imul(hash^c.charCodeAt(0),16777619)
 return create(names.map((name,portrait)=>({name,portrait})),hash||1,2)
}
export function apply(s,a,id){
 if(!Number.isInteger(id)||!s.players[id]) throw Error('Сначала займите место')
 if(a?.type==='choose') return reduce(s,{type:'choose',player:id,value:a.value})
 if(a?.type==='resume') return reduce(s,{type:'resume',player:s.turn?.actor??id})
 if(a?.type==='next') return reduce(s,{type:'nextGame'})
 if(a?.type!=='commit'||!Array.isArray(a.cards)||a.cards.length>3) throw Error('Выберите от одной до трёх карт')
 const cards=a.cards.map(uid=>{
 if(!Number.isInteger(uid)||!(s.players[id].hand.includes(uid)||uid===-1&&s.players[id].treasures.includes(T.trap))) throw Error('Карты нет в руке')
 const type=card(uid).type
 const slot=type==='wild'?a.slots?.[uid]:type
 if(!slots.includes(slot)) throw Error('Укажите место шальной магии')
 return {id:uid,slot}
 })
 return reduce(s,{type:'submit',player:id,cards,goLast:a.goLast===true})
}
export function view(s,id){
 const p=s.players[id]
 const pd=s.pending
 const last=s.turns.at(-1)
 const turn=s.turn
 const caster=turn?s.players[turn.actor]:null
 const spell=caster?.spell||[]
 const current=spell.find(c=>c.on&&!c.done)
 const open=s.phase==='resolve'||s.phase==='gameover'||s.phase==='tournament'
 const roundTurns=s.turns.filter(t=>t.game===s.game&&t.round===s.round)
 const spellFor=q=>{
  if(q.spell&&q.spell.length)return q.spell.map(c=>({...card(c.id),slot:c.slot,done:!!c.done,on:!!c.on}))
  const rec=roundTurns.filter(t=>t.actor===q.id).at(-1)
  return rec?rec.cards.map(id=>({...card(id),slot:null,done:true,on:false})):[]
 }
 return {phase:pd?'reveal':({build:'plan',gameover:'roundEnd',tournament:'over'})[s.phase]||'reveal',
 battle:s.game,turn:s.round,me:p?.id??null,active:pd?.player??s.turn?.actor??null,winner:s.lastWinner,paused:!!s.pause,back:art('/assets/cards/spells/_back.webp'),
 hand:p?[...p.hand,...(p.treasures.includes(T.trap)?[-1]:[])].map(card):[],canGoLast:!!p?.treasures.includes(T.jetpack),
 players:s.players.map(q=>({id:q.id,name:q.name,hp:q.life,medals:q.medals,handCount:q.hand.length,ready:!!q.spell,treasures:q.treasures.map(i=>({name:TREASURES[i].name,text:TREASURES[i].text,image:art('/assets/cards/treasures/'+i+'.webp')})),deadCount:q.deadCards.length,
 portrait:art('/assets/cards/wizards/'+q.portrait+'.webp'),
 dead:q.deadCards.map(c=>art('/assets/cards/dead/'+Math.floor(c/10)+'.webp'))})),
 pending:pd?{player:pd.player,prompt:pd.player===id?pd.prompt:'Маг выбирает эффект карты',options:pd.player===id?pd.options.map(({v,label,card:meta})=>({v,label,card:meta??null})):[],optional:pd.player===id&&!!pd.optional,byCard:pd.options.every(o=>!!o.card),on:current?.id??null}:null,
 resolving:turn&&spell.length?{player:turn.actor,stage:turn.stage,cards:spell.map(c=>({...card(c.id),slot:c.slot,done:!!c.done,on:!!c.on}))}:null,
 spells:s.players.map(q=>({player:q.id,count:q.spell?q.spell.length:(open?spellFor(q).length:0),ready:!!q.spell,cards:open?spellFor(q):null})),
 rolls:s.ev.map((e,i)=>e.k==='roll'?{...e,id:s.evBase+i}:null).filter(Boolean).slice(-8),
 lastSpell:last?{name:s.players[last.actor].name,cards:last.cards.map(card)}:null,
 log:s.log.slice(-100).reverse().map(line=>line.replace(/(берёт карту дохлого колдуна) «[^»]+»/g,'$1'))}
}
export function botAction(s,id){
 if(s.pause)return {type:'resume'}
 if(s.phase==='gameover'&&!s.pending)return {type:'next'}
 const options=legalActions(s,id)
 if(!options.length)return null
 const pd=s.pending
 if(pd){
 const valid=pd.options.filter(o=>o.player!=null&&(pd.friendly?o.player===id:o.player!==id)).sort((a,b)=>s.players[a.player].life-s.players[b.player].life)
 return {type:'choose',value:pd.hint!==undefined?pd.hint:valid[0]?.v??options[0].value}
 }
 const score=a=>a.cards.length*6+(a.cards.some(c=>c.slot==='delivery')?3:0)+new Set(a.cards.map(c=>card(c.id).school)).size*-1
 const a=options.reduce((best,next)=>score(next)>score(best)?next:best)
 return {type:'commit',cards:a.cards.map(c=>c.id),slots:Object.fromEntries(a.cards.map(c=>[c.id,c.slot])),goLast:a.goLast}
}
export function result(s){return s.phase==='tournament'?{winners:[String(s.lastWinner)],scores:Object.fromEntries(s.players.map(p=>[p.id,p.medals]))}:null}

