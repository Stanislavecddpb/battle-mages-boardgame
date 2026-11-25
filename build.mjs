import {build} from 'esbuild'
import {build as viteBuild} from 'vite'
import {mkdir,copyFile} from 'node:fs/promises'
await viteBuild({build:{outDir:'dist/client',emptyOutDir:true}})
await build({entryPoints:['worker.js'],outfile:'dist/server/index.js',bundle:true,format:'esm',target:'es2022'})
await mkdir('dist/.openai',{recursive:true})
await copyFile('.openai/hosting.json','dist/.openai/hosting.json')
