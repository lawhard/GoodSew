import {createBridge} from '../mcp/bridge.mjs';import assert from 'node:assert/strict';
const b=await createBridge({port:0,runtime:false}),url=`http://127.0.0.1:${b.port}`;
const call=(p,{method='POST',token,origin=url,value={}}={})=>fetch(url+p,{method,headers:{...(origin?{Origin:origin}:{}),...(token?{Authorization:'Bearer '+token}:{}),'Content-Type':'application/json'},body:method==='GET'?undefined:JSON.stringify(value)});
try{
 assert.equal((await call('/api/connect',{origin:'https://example.org'})).status,403);
 assert.equal((await call('/api/connect',{origin:null})).status,403);
 assert.equal((await fetch(url+'/.local/connector.json')).status,404);
 assert.equal((await call('/api/call',{token:'wrong',value:{name:'get_design'}})).status,401);
 const paired=await (await call('/api/connect')).json();assert.ok(paired.token);
 assert.equal((await call('/api/connect')).status,409);
 const waiting=call('/api/call',{token:b.token,origin:null,value:{name:'get_design'}});
 // Fetch dispatch is asynchronous; allow request delivery before polling.
 await new Promise(r=>setTimeout(r,30));
 const cmd=await (await call('/api/poll',{method:'GET',token:paired.token})).json();assert.equal(cmd.name,'get_design');
 await call('/api/result',{token:paired.token,value:{id:cmd.id,result:{revision:'test:1',objects:[]}}});
 assert.equal((await (await waiting).json()).result.revision,'test:1');
 await call('/api/disconnect',{token:paired.token});
 assert.equal((await call('/api/call',{token:b.token,value:{name:'get_design'}})).status,409);
 console.log('PASS connector authentication, origin/host boundaries, private file exclusion, tab pairing, command delivery, result and revocation');
}finally{await b.close();}
