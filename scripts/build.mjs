import {mkdir,rm,cp,readFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
const root=new URL('../',import.meta.url),dist=new URL('dist/',root);
// Syntax-check modules before producing a public-only static artifact.
import {readdirSync} from 'node:fs';
for(const path of readdirSync(new URL('js/',root),{recursive:true}).filter(p=>p.endsWith('.js'))) execFileSync(process.execPath,['--check',new URL('js/'+path,root).pathname]);
for(const path of ['mcp/bridge.mjs','mcp/server.mjs']) execFileSync(process.execPath,['--check',new URL(path,root).pathname]);
await rm(dist,{recursive:true,force:true});await mkdir(dist,{recursive:true});
for(const path of ['index.html','favicon.svg','og.png','css','js','vendor','fonts']) await cp(new URL(path,root),new URL(path,dist),{recursive:true});
const html=await readFile(new URL('index.html',dist),'utf8');
for(const [,path] of html.matchAll(/(?:src|href)="((?:js|css|vendor)\/[^"?]+)(?:\?[^" ]*)?"/g)) await readFile(new URL(path,dist));
console.log('Static build ready in dist/ (source, tests, and credentials excluded).');
