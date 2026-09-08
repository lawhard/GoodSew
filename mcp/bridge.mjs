import http from 'node:http';
import {readFile,mkdir,writeFile,rm,realpath} from 'node:fs/promises';
import {randomBytes,randomUUID,timingSafeEqual} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {DESIGN_TOOLS,validateArgs} from '../js/design-commands.js';
export async function createBridge({root=fileURLToPath(new URL('../',import.meta.url)),port=8137,runtime=true}={}){
 const token=randomBytes(32).toString('hex');let browserToken=null,lastPoll=0,pending=null;
 const authorized=(a,b)=>typeof a==='string'&&typeof b==='string'&&a.length===b.length&&timingSafeEqual(Buffer.from(a),Buffer.from(b));
 const json=(res,status,value)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(value));};
 const body=async req=>{let text='';for await(const chunk of req){text+=chunk;if(text.length>16*1024*1024)throw Error('Request too large.');}return JSON.parse(text||'{}');};
 const cancel=message=>{if(pending){clearTimeout(pending.timer);json(pending.response,409,{error:message});pending=null;}};
 const server=http.createServer(async(req,res)=>{
  try{
   const host='127.0.0.1:'+server.address().port,origin='http://'+host;
   if(req.headers.host!==host)return json(res,403,{error:'Invalid host.'});
   if(req.headers.origin&&req.headers.origin!==origin)return json(res,403,{error:'Invalid origin.'});
   const pathname=new URL(req.url,origin).pathname;
   if(pathname.startsWith('/api/')){
    if(pathname==='/api/connect'&&req.method==='POST'){
     if(req.headers.origin!==origin)return json(res,403,{error:'Pair through the Good Sew browser.'});
     if(browserToken&&Date.now()-lastPoll<15000)return json(res,409,{error:'Another tab is connected. Disconnect it first.'});
     cancel('Browser session replaced.');browserToken=randomBytes(32).toString('hex');lastPoll=Date.now();return json(res,200,{token:browserToken});
    }
    const auth=(req.headers.authorization||'').replace(/^Bearer /,'');
    if(pathname==='/api/call'&&req.method==='POST'){
     if(!authorized(auth,token))return json(res,401,{error:'Invalid connector credential.'});
     if(!browserToken||Date.now()-lastPoll>15000)return json(res,409,{error:'Open Good Sew → Assistant control → Enable local MCP.'});
     if(pending)return json(res,409,{error:'A command is already pending.'});
     const command=await body(req),spec=DESIGN_TOOLS.find(t=>t.name===command.name);
     if(!spec)return json(res,400,{error:'Unknown command.'});validateArgs(command.args||{},spec.inputSchema);
     const p={id:randomUUID(),name:command.name,args:command.args||{},response:res,claimed:false};
     p.timer=setTimeout(()=>{if(pending===p){json(res,504,{error:'Browser command timed out. Read the current design before retrying; reuse the same requestId for edits.'});pending=null;}},25000);
     pending=p;return;
    }
    if(!authorized(auth,browserToken))return json(res,401,{error:'Browser not paired.'});
    if(pathname==='/api/poll'&&req.method==='GET'){
     lastPoll=Date.now();if(!pending||pending.claimed){res.writeHead(204,{'Cache-Control':'no-store'});res.end();return;}
     pending.claimed=true;return json(res,200,{id:pending.id,name:pending.name,args:pending.args});
    }
    if(pathname==='/api/result'&&req.method==='POST'){
     const result=await body(req);if(pending&&result.id===pending.id){clearTimeout(pending.timer);json(pending.response,200,result);pending=null;}return json(res,200,{ok:true});
    }
    if(pathname==='/api/disconnect'&&req.method==='POST'){browserToken=null;cancel('Browser disconnected.');return json(res,200,{ok:true});}
    return json(res,404,{error:'Unknown endpoint.'});
   }
   if(!['GET','HEAD'].includes(req.method))return json(res,405,{error:'Method not allowed.'});
   const relative=decodeURIComponent(pathname).replace(/^\//,'')||'index.html';
   if(!/^(index\.html|favicon\.svg|og\.png|(?:js|css|vendor|fonts)\/[^\\]+)$/.test(relative)||relative.split('/').some(p=>p==='..'||p.startsWith('.')))return json(res,404,{error:'Not found.'});
   const abs=await realpath(path.join(root,relative));if(!abs.startsWith(path.resolve(root)+path.sep))return json(res,403,{error:'Outside public files.'});
   const bytes=await readFile(abs),types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.ttf':'font/ttf','.png':'image/png'};
   res.writeHead(200,{'Content-Type':types[path.extname(abs)]||'application/octet-stream','Cache-Control':'no-cache','X-Content-Type-Options':'nosniff'});res.end(req.method==='HEAD'?undefined:bytes);
  }catch(err){if(!res.headersSent)json(res,400,{error:err.code==='ENOENT'?'Not found.':err.message});else res.end();}
 });
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});
 const actualPort=server.address().port,runtimeFile=path.join(root,'.local/connector.json');
 if(runtime){await mkdir(path.dirname(runtimeFile),{recursive:true,mode:0o700});await writeFile(runtimeFile,JSON.stringify({url:`http://127.0.0.1:${actualPort}`,token}),{mode:0o600});}
 return {server,token,port:actualPort,close:async()=>{cancel('Server stopped.');await new Promise(r=>server.close(r));if(runtime)await rm(runtimeFile,{force:true});}};
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
 const bridge=await createBridge({port:Number(process.env.GOOD_SEW_PORT||8137)});
 console.log(`Good Sew with local MCP: http://127.0.0.1:${bridge.port}/`);
 for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>bridge.close().then(()=>process.exit(0)));
}
