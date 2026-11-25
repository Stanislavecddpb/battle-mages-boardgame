import {readFile,writeFile,readdir} from 'node:fs/promises'
import path from 'node:path'
const dir=path.resolve('dist/client'),assetDir=path.join(dir,'assets')
const file=process.argv[2]
if(!file)throw Error('Укажите путь к HTML')
let html=await readFile(path.join(dir,'index.html'),'utf8')
const images={}
const inline=async (folder,prefix,names)=>{
 for(const name of names){
  const key=prefix+name
  images[key]='data:image/webp;base64,'+(await readFile(path.join(folder,name))).toString('base64')
 }
}
for(const deck of ['spells','treasures','wizards','dead']){
 const folder=path.join(assetDir,'cards',deck)
 await inline(folder,'/assets/cards/'+deck+'/',await readdir(folder))
}
await inline(path.join(assetDir,'ui'),'/assets/ui/',await readdir(path.join(assetDir,'ui')))
const js=html.match(/<script[^>]+src="([^"]+)"[^>]*><\/script>/)
const css=html.match(/<link[^>]+href="([^"]+\.css)"[^>]*>/)
const readAsset=url=>readFile(path.join(dir,url.replace(/^\//,'')),'utf8')
let style=await readAsset(css[1])
for(const match of [...style.matchAll(/url\((["']?)(\/[^)'"\s]+)\1\)/g)]){
 const bytes=await readFile(path.join(dir,match[2].slice(1)))
 const type=match[2].endsWith('.woff2')?'font/woff2':'image/webp'
 style=style.replace(match[0],()=>'url(data:'+type+';base64,'+bytes.toString('base64')+')')
}
html=html.replace(css[0],()=>'<style>'+style+'</style>')
const code=(await readAsset(js[1])).replaceAll('</script','<\\/script')
html=html.replace(js[0],()=>'<script>globalThis.SKULL_ART='+JSON.stringify(images)+'</script><script type="module">'+code+'</script>')
await writeFile(file,html)
