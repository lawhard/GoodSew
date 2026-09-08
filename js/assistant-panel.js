import {DESIGN_TOOLS} from './design-commands.js';
export function mountAssistantPanel(execute){
 const open=document.createElement('button');open.className='btn';open.textContent='Assistant control';open.id='assistant-open';document.querySelector('header').append(open);
 const dialog=document.createElement('dialog');dialog.id='assistant-dialog';dialog.className='assistant-dialog';
 dialog.innerHTML=`<h2>Assistant control</h2><p>Precise design edits with normal Undo. Browser commands and local MCP use the same engine.</p><div class="assistant-actions"><button id="assistant-pair" class="btn">Enable local MCP</button><button id="assistant-disconnect" class="btn" disabled>Disconnect</button><button id="assistant-close" class="btn">Close</button></div><p id="assistant-connection" role="status">Local MCP is off. Browser commands work below.</p><label>Command<select id="assistant-command" class="select"></select></label><p id="assistant-description"></p><label>Command arguments<textarea id="assistant-args" rows="7" spellcheck="false">{}</textarea></label><button id="assistant-run" class="btn primary">Run command</button><pre id="assistant-result" aria-label="Command result" tabindex="0"></pre><details><summary>MCP setup</summary><p>Run this app with npm run dev. Register mcp/server.mjs as a stdio server in your MCP client. Enable the connection only in the tab you want edited. Disconnect immediately revokes access. No API key is required.</p></details>`;
 document.body.append(dialog);const el=id=>dialog.querySelector('#'+id),select=el('assistant-command'),output=el('assistant-result');
 for(const tool of DESIGN_TOOLS){const o=document.createElement('option');o.value=tool.name;o.textContent=tool.name;select.append(o);}
 select.onchange=()=>{el('assistant-description').textContent=DESIGN_TOOLS.find(t=>t.name===select.value).description;};select.onchange();
 open.onclick=()=>dialog.showModal();el('assistant-close').onclick=()=>dialog.close();
 const run=async(name,args)=>{
  output.textContent='Running '+name+'…';
  try{const r=await execute(name,args);const {image,base64,...visible}=r;output.textContent=JSON.stringify({...visible,...(image?{image:'PNG returned to connector'}:{}),...(base64?{base64:'PES bytes returned to connector'}:{})},null,2);return r;}
  catch(err){output.textContent='Error: '+err.message;throw err;}
 };
 el('assistant-run').onclick=async()=>{el('assistant-run').disabled=true;try{
  const args=JSON.parse(el('assistant-args').value||'{}');if(['apply_edit','undo_edit'].includes(select.value)){
   if(!args.expectedRevision)args.expectedRevision=(await execute('get_design')).revision;
   if(!args.requestId)args.requestId=crypto.randomUUID();
  }
  if(select.value==='preview_3d')dialog.close();await run(select.value,args);
 }catch(err){output.textContent='Error: '+err.message;}finally{el('assistant-run').disabled=false;}};
 let token=null,timer=null;
 const request=async(path,method='GET',body)=>fetch('/api/'+path,{method,headers:{...(token?{Authorization:'Bearer '+token}:{}),...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});
 window.addEventListener('pagehide',()=>{if(token)fetch('/api/disconnect',{method:'POST',headers:{Authorization:'Bearer '+token},keepalive:true}).catch(()=>{});});
 const off=()=>{token=null;clearTimeout(timer);el('assistant-pair').disabled=false;el('assistant-disconnect').disabled=true;el('assistant-connection').textContent='Local MCP disconnected.';};
 const poll=async()=>{
  try{
   const response=await request('poll');if(!response.ok)throw Error('Connection ended.');
   if(response.status!==204){const command=await response.json();let result,error;
    try{if(command.name==='preview_3d')dialog.close();result=await run(command.name,command.args);}catch(err){error=err.message;}
    const sent=await request('result','POST',{id:command.id,result,error});if(!sent.ok)throw Error('Result could not be delivered.');
   }
   if(token)timer=setTimeout(poll,500);
  }catch(err){off();el('assistant-connection').textContent=err.message;}
 };
 el('assistant-pair').onclick=async()=>{
  try{const r=await request('connect','POST',{});if(!r.ok){let error;try{error=(await r.json()).error;}catch{}throw Error(error||'Start the local connector server with npm run dev.');}token=(await r.json()).token;el('assistant-pair').disabled=true;el('assistant-disconnect').disabled=false;el('assistant-connection').textContent='Connected · MCP can read and edit this tab. Undo remains available.';poll();}
  catch(err){el('assistant-connection').textContent=err.message;}
 };
 el('assistant-disconnect').onclick=async()=>{try{await request('disconnect','POST',{});}finally{off();}};
}
