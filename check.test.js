import test from 'node:test'
import assert from 'node:assert/strict'
import {existsSync} from 'node:fs'
import {fileURLToPath} from 'node:url'
import path from 'node:path'
import {setup,view,apply,botAction,result} from './play.js'
import {spellOf} from './base-rules.js'
const names=['Аня','Борис','Вера','Гриша','Дина','Егор']
const assets=fileURLToPath(new URL('./public/assets/',import.meta.url))
test('Все картинки базовой коробки на месте',()=>{
 const files=[
  ...Array.from({length:64},(_,i)=>`cards/spells/${i}.webp`),
  'cards/spells/_back.webp',
  ...Array.from({length:25},(_,i)=>`cards/treasures/${i}.webp`),
  'cards/treasures/126.webp',
  ...Array.from({length:8},(_,i)=>`cards/dead/${i}.webp`),
  ...Array.from({length:8},(_,i)=>`cards/wizards/${i}.webp`),
  'ui/arena-bg.webp',
  'ui/menu-bg.webp',
 ]
 const missing=files.filter(name=>!existsSync(path.join(assets,name)))
 assert.deepEqual(missing,[])
})
test('Состав базовой коробки и начальные руки',()=>{
 const s=setup(names,1234)
 const all=[...s.deck,...s.players.flatMap(p=>p.hand)].map(spellOf)
 assert.equal(all.length,128)
 for(const k of ['source','quality','delivery']) assert.equal(all.filter(c=>c.type===k).length,40)
 assert.equal(all.filter(c=>c.type==='wild').length,8)
 assert.equal(s.treasureDeck.length,25)
 assert.equal(s.deadDeck.length,25)
 assert.ok(s.players.every(p=>p.life===20&&p.hand.length===8))
 assert.deepEqual(view(s,null).hand,[])
})
test('Вид отдаёт портреты и карты мёртвого колдуна',()=>{
 const s=setup(names,77)
 s.players[1].deadCards.push(0,34)
 const p=view(s,null).players
 assert.equal(p[0].portrait,'/assets/cards/wizards/0.webp')
 assert.equal(p[1].portrait,'/assets/cards/wizards/1.webp')
 assert.deepEqual(p[1].dead,['/assets/cards/dead/0.webp','/assets/cards/dead/3.webp'])
 assert.deepEqual(p[0].dead,[])
})
test('Одна карта опережает две, при равной длине первой идёт старшая инициатива',()=>{
 function first(a,b){
 let s=setup(names.slice(0,2),237)
 s.players[0].hand=a;s.players[1].hand=b
 for(const id of [0,1])s=apply(s,{type:'commit',cards:[a,b][id]},id)
 return s.turns[0].actor
 }
 const s=setup(names,123),cards=[...s.deck,...s.players.flatMap(p=>p.hand)]
 const deliveries=cards.filter(c=>spellOf(c).type==='delivery').sort((a,b)=>spellOf(a).initiative-spellOf(b).initiative)
 const normal=cards.find(c=>spellOf(c).type==='quality'&&Math.floor(c/10)!==25)
 assert.equal(first([normal,deliveries.at(-1)],[deliveries[0]]),1)
 assert.equal(first([deliveries[0]],[deliveries.at(-1)]),1)
})
for(const count of [2,3,4,5,6])test('Матч до двух медалей для '+count,()=>{
 let s=setup(names.slice(0,count),'box-'+count)
 for(let i=0;i<2500&&!result(s);i++){
 const id=s.pending?.player??s.players.find(p=>p.alive&&!p.spell)?.id??0
 const a=botAction(s,id)
 assert.ok(a)
 s=apply(s,a,id)
 }
 assert.equal(result(s)?.winners.length,1)
 assert.equal(Math.max(...Object.values(result(s).scores)),2)
})
