import { build } from 'esbuild'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
const root=path.resolve('../reference')
await build({
 stdin:{contents:`export {create, reduce, waitingFor} from './src/game/engine.ts'
 export {legalActions} from './src/game/legal.ts'
 export {T,spellOf} from './src/game/core.ts'
 export {SPELLS,TREASURES,DEAD,SCHOOL_NAMES} from './src/data/cards.ts'`,resolveDir:root},
 outfile:'base-rules.js',format:'esm',bundle:true,
 plugins:[{name:'boxed-edition',setup(build){
 build.onLoad({filter:/[\\/]game[\\/]engine\.ts$/},async({path})=>{
 let source=await readFile(path,'utf8')
 source=source.replace('inSets(sets, c, c.type', '!c.promo && inSets(sets, c, c.type')
 source=source.replace('t => inSets(sets, t)', 't => !t.promo && t.index < 25 && inSets(sets, t)')
 // Only the tied leaders reroll to decide who goes first.
 source=source.replace('const top = cand.filter','let top = cand.filter')
 source=source.replace('for (const p of best) p.tieRoll = undefined','top = best; for (const p of best) p.tieRoll = undefined')
 return {contents:source,loader:'ts'}
 })
 }}]
})


// Пошаговый розыгрыш: движок встаёт на паузу после раскрытия заклинания и перед каждой картой,
// пока клиент не пришлёт {type:'resume'}. Иначе весь раунд разрешается одним вызовом reduce.
const stepPatch = [
 '  if (s.turn.stage === "reveal") reveal(ctx, p);\n  else if (s.turn.stage === "cards") resolveNext(ctx, p);\n  else if (s.turn.stage === "end") endTurn(ctx, p);\n  return true;',
 '  if (s.turn.stage === "reveal") {\n    reveal(ctx, p);\n    if (s.turn && s.turn.stage === "cards" && p.spell && p.spell.length && !s.pause) {\n      s.pause = true;\n      return false;\n    }\n  } else if (s.turn.stage === "cards") {\n    resolveNext(ctx, p);\n    if (s.pause) return false;\n  } else if (s.turn.stage === "end") endTurn(ctx, p);\n  return true;',
]
const pickPatch = [
 '  log(s, `\\u2726 ${p.name}: ${cardName(c.id)}.`);\n}',
 '  log(s, `\\u2726 ${p.name}: ${cardName(c.id)}.`);\n  s.pause = true;\n}',
]
const resumePatch = [
 '  if (a.type === "seat" || a.type === "skip") return seatAction(s, a);',
 '  if (a.type === "resume") {\n    if (!s.pause) throw new Error("Сейчас нечего продолжать");\n    if (!s.turn || s.turn.actor !== a.player) throw new Error("Продолжает разыгрывающий маг");\n    delete s.pause;\n    return advance(s, []);\n  }\n  if (a.type === "seat" || a.type === "skip") return seatAction(s, a);',
]
let code = await readFile('base-rules.js', 'utf8')
for (const [from, to] of [stepPatch, pickPatch, resumePatch]) {
 if (!code.includes(from)) throw new Error('Патч пошагового розыгрыша не применился: ' + from.slice(0, 80))
 code = code.replace(from, to)
}
await writeFile('base-rules.js', code)
