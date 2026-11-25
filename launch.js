import {createGameServer} from './server.js'
import {spawn} from 'node:child_process'
const port=Number(process.env.PORT||3001)
const server=createGameServer()
server.on('error',e=>{console.error(e.code==='EADDRINUSE'?'Порт занят. Закройте прежний сервер или укажите другой PORT.':e.message);process.exitCode=1})
server.listen(port,'0.0.0.0',()=>{
 const url='http://localhost:'+port
 console.log('Игра открыта на '+url+' . Оставьте это окно открытым на время партии.')
 if(process.platform==='win32')spawn('rundll32.exe',['url.dll,FileProtocolHandler',url],{detached:true,stdio:'ignore'}).unref()
})
