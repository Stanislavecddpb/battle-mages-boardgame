import test from 'node:test'
import assert from 'node:assert/strict'
import {DatabaseSync} from 'node:sqlite'
import {readFileSync} from 'node:fs'
import worker from './worker.js'
test('Комната облачной версии, приватность, повтор хода и отмена',async()=>{
 const sqlite=new DatabaseSync(':memory:')
 sqlite.exec(readFileSync(new URL('./drizzle/0000_rooms.sql',import.meta.url),'utf8'))
 const env={DB:{prepare(sql){const s=sqlite.prepare(sql);return {bind(...args){return {first:()=>s.get(...args),run:()=>({meta:s.run(...args)})}}}}},ASSETS:{fetch:()=>new Response('asset')}}
 async function call(path,body,key){
 const res=await worker.fetch(new Request('https://table.example'+path,{method:body?'POST':'GET',headers:{...(key?{authorization:'Bearer '+key}:{}),'content-type':'application/json'},body:body?JSON.stringify(body):undefined}),env)
 return [res.status,await res.json()]
 }
 const [,room]=await call('/games/skullzfyre/create',{numPlayers:2})
 const path='/api/'+room.matchID
 const [,host]=await call(path+'/seat',{seat:0,name:'Аня'})
 const [,guest]=await call(path+'/seat',{seat:1,name:'Борис'})
 assert.equal((await call(path+'/start',{},guest.key))[0],403)
 assert.equal((await call(path+'/start',{},host.key))[0],200)
 const [,mine]=await call(path+'/view',null,host.key)
 const [,watch]=await call(path+'/view')
 assert.equal(mine.game.hand.length,8);assert.deepEqual(watch.game.hand,[])
 const c=mine.game.hand.find(c=>c.type!=='wild')
 const move={revision:mine.revision,action:{type:'commit',cards:[c.uid]}}
 assert.equal((await call(path+'/action',move,host.key))[0],200)
 assert.equal((await call(path+'/action',move,host.key))[0],409)
 const [,update]=await call(path+'/view',null,guest.key)
 assert.equal(update.canUndo,true)
 assert.equal((await call(path+'/undo',{revision:update.revision},guest.key))[0],200)
 assert.equal((await call(path+'/view',null,host.key))[1].game.hand.length,8)
 assert.equal((await call(path+'/leave',{},guest.key))[0],200)
 assert.equal((await call(path+'/view',null,guest.key))[1].seat,null)
 sqlite.close()
})
