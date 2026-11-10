// Dependency-free MCP stdio adapter. The browser remains the design authority.
import {createInterface} from 'node:readline';
import {readFile} from 'node:fs/promises';
import {DESIGN_TOOLS,validateArgs} from '../js/design-commands.js';
const output=value=>process.stdout.write(JSON.stringify(value)+'\n');
const input=createInterface({input:process.stdin,crlfDelay:Infinity});
let initialized=false;
input.on('line',async line=>{
 let message;
 try{
  if(line.length>2*1024*1024)throw Error('Message too large.');message=JSON.parse(line);
  if(message.id===undefined)return;
  if(message.jsonrpc!=='2.0'||typeof message.method!=='string')return output({jsonrpc:'2.0',id:message.id,error:{code:-32600,message:'Invalid request'}});
  let result;
  if(message.method==='initialize'){
   initialized=true;result={protocolVersion:['2024-11-05','2025-03-26','2025-06-18','2025-11-25'].includes(message.params?.protocolVersion)?message.params.protocolVersion:'2025-11-25',capabilities:{tools:{}},serverInfo:{name:'good-sew',version:'0.17.0'},instructions:'Enable local MCP in the intended Good Sew browser tab. Read the design revision before edits. Use requestId for idempotency. Inspect numerical results and preview; physical sew-out is still needed.'};
  }else if(message.method==='ping')result={};
  else if(!initialized)throw Error('Initialize the connection first.');
  else if(message.method==='tools/list')result={tools:DESIGN_TOOLS};
  else if(message.method==='tools/call'){
   try{
    const {name,arguments:args={}}=message.params||{},spec=DESIGN_TOOLS.find(t=>t.name===name);if(!spec)throw Error('Unknown tool.');validateArgs(args,spec.inputSchema);
    const config=JSON.parse(await readFile(new URL('../.local/connector.json',import.meta.url),'utf8'));
    const url=new URL(config.url);if(url.protocol!=='http:'||url.hostname!=='127.0.0.1')throw Error('Connector must be local.');
    const response=await fetch(new URL('/api/call',url),{method:'POST',headers:{Authorization:'Bearer '+config.token,'Content-Type':'application/json'},body:JSON.stringify({name,args}),signal:AbortSignal.timeout(28000)});
    const data=await response.json();if(!response.ok||data.error)throw Error(data.error||'Connector failed.');
    const value=data.result,content=[];
    if(value.image){content.push({type:'image',data:value.image,mimeType:'image/png'});delete value.image;}
    content.push({type:'text',text:JSON.stringify(value)});result={content};
   }catch(err){result={isError:true,content:[{type:'text',text:err.code==='ENOENT'?'Start Good Sew with npm run dev, then enable local MCP in the browser.':err.message}]};}
  }else return output({jsonrpc:'2.0',id:message.id,error:{code:-32601,message:'Method not found'}});
  output({jsonrpc:'2.0',id:message.id,result});
 }catch(err){output({jsonrpc:'2.0',id:message?.id??null,error:{code:message?-32602:-32700,message:err.message}});}
});
