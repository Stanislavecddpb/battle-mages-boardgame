import {setup,view,apply,result} from './play.js'
const json=(data,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store'}})
const fail=(message,status=400)=>{throw Object.assign(Error(message),{status})}
const members=r=>r.seats.map((s,id)=>s?{id,name:s.name}:{id})
const digest=async key=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(key))),x=>x.toString(16).padStart(2,'0')).join('')
const uid=()=>crypto.randomUUID()
async function body(request){
 if(!request.body)return {}
 if(Number(request.headers.get('content-length'))>8192)fail('Запрос слишком большой',413)
 const reader=request.body.getReader(),decoder=new TextDecoder()
 let bytes=0,raw=''
 while(true){
 const {value,done}=await reader.read();if(done)break
 bytes+=value.length;if(bytes>8192){await reader.cancel();fail('Запрос слишком большой',413)}
 raw+=decoder.decode(value,{stream:true})
 }
 try{return JSON.parse(raw+decoder.decode()||'{}')}catch{fail('Некорректный JSON')}
}
async function handle(req,env){
 const url=new URL(req.url),path=url.pathname,method=req.method
 if(path==='/health')return json({ok:true})
 if(!/^\/(?:api|games|platform)\//.test(path))return env.ASSETS.fetch(req)
 if(method!=='GET'&&req.headers.has('origin')&&req.headers.get('origin')!==url.origin)fail('Другой источник запроса',403)
 const db=env.DB
 if(path==='/games/skullzfyre/create'&&method==='POST'){
 const {numPlayers:n}=await body(req)
 if(!Number.isInteger(n)||n<2||n>6)fail('Выберите от 2 до 6 игроков')
 const id=uid().replaceAll('-','').slice(0,14)
 await db.prepare('INSERT INTO rooms VALUES (?,0,?)').bind(id,JSON.stringify({seats:Array(n).fill(null),game:null})).run()
 return json({matchID:id})
 }
 const match=/^\/(api|games\/skullzfyre|platform\/matches)\/([a-z0-9-]{1,40})(?:\/(view|events|action|start|seat|leave|undo))?$/.exec(path)
 if(!match)fail('Маршрут не найден',404)
 const [,kind,id,op]=match
 if(kind==='platform/matches'&&(!env.PLATFORM_SECRET||req.headers.get('x-platform-secret')!==env.PLATFORM_SECRET))fail('Доступ запрещён',403)
 const row=await db.prepare('SELECT revision,payload FROM rooms WHERE id=?').bind(id).first()
 if(!row)fail('Комната не найдена',404)
 const r=JSON.parse(row.payload),key=(req.headers.get('authorization')||'').replace(/^Bearer /,'')
 const tokenHash=key?await digest(key):null, pos=r.seats.findIndex(s=>s&&tokenHash&&s.keyHash===tokenHash),seat=pos<0?null:pos
 if(kind==='games/skullzfyre'&&!op&&method==='GET')return json({matchID:id,players:members(r),gameover:r.game?result(r.game):null})
 if(kind==='api'&&method==='GET'){
 if(op==='view')return json({players:members(r),revision:row.revision,seat,canUndo:seat!==null&&!!r.previous&&!result(r.game),game:r.game?view(r.game,seat):null})
 if(op==='events')return new Response('retry: 2000\ndata: '+row.revision+'\n\n',{headers:{'content-type':'text/event-stream','cache-control':'no-store'}})
 }
 let response={ok:true}
 if(kind==='platform/matches'&&method==='DELETE'&&!op){await db.prepare('DELETE FROM rooms WHERE id=?').bind(id).run();return json(response)}
 if(method!=='POST')fail('Маршрут не найден',404)
 const data=await body(req)
 if(kind==='platform/matches'&&op==='leave'){
 let left=0
 r.seats=r.seats.map(s=>{if(s&&s.name.toLowerCase()===String(data.playerName).toLowerCase()){left++;return null}return s})
 response={left}
 }else if(kind==='api'&&op==='seat'){
 const name=typeof data.name==='string'?data.name.trim().slice(0,40):''
 if(!name||!Number.isInteger(data.seat)||data.seat<0||data.seat>=r.seats.length||r.seats[data.seat])fail('Место недоступно',409)
 if(r.seats.some(s=>s?.name.toLowerCase()===name.toLowerCase()))fail('Это имя уже занято',409)
 const token=uid();r.seats[data.seat]={name,keyHash:await digest(token)}
 for(const game of [r.game,r.previous].filter(Boolean)){game.players[data.seat].name=name;if(game.pending){const base=JSON.parse(game.pending.base);base.players[data.seat].name=name;game.pending.base=JSON.stringify(base)}}
 response={key:token}
 }else if(kind==='api'&&op==='start'){
 if(seat!==0)fail('Начинает хозяин комнаты',403)
 if(r.seats.some(s=>!s)||r.game)fail('Проверьте места в комнате',409)
 r.game=setup(r.seats.map(s=>s.name),uid())
 }else if(kind==='api'&&op==='leave'){
 if(seat===null)fail('Займите место',403)
 r.seats[seat]=null
 }else if(kind==='api'&&op==='undo'){
 if(seat===null)fail('Займите место',403)
 if(!r.previous||result(r.game)||data.revision!==row.revision)fail('Отмена сейчас недоступна',409)
 r.game=r.previous;delete r.previous
 const line=r.seats[seat].name+' отменяет последнее действие.'
 r.game.log.push(line)
 if(r.game.pending){const base=JSON.parse(r.game.pending.base);base.log.push(line);r.game.pending.base=JSON.stringify(base)}
 }else if(kind==='api'&&op==='action'){
 if(seat===null)fail('Займите место',403)
 if(!r.game||data.revision!==row.revision)fail('Обновите состояние партии',409)
 r.previous=r.game;r.game=apply(r.game,data.action,seat)
 }else fail('Маршрут не найден',404)
 const write=await db.prepare('UPDATE rooms SET payload=?,revision=revision+1 WHERE id=? AND revision=?').bind(JSON.stringify(r),id,row.revision).run()
 if(!write.meta.changes)fail('Стол изменился. Повторите действие',409)
 return json(response)
}
export default {async fetch(req,env){try{return await handle(req,env)}catch(e){return json({error:e.message},e.status||400)}}}

