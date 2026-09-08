// Bounded PES/PEC reader. Stitch coordinates are decoded from PEC in 0.1 mm.
// Format reference: EmbroidePy/pyembroidery PecReader.py and PesReader.py.
// This reads machine stitches, not editable vector digitizing objects.
import { BROTHER_PALETTE, rgbToHex, nearestBrother } from '../threads.js';
import { bbox } from '../geometry.js';
const LIMIT = 200000;
export function parsePES(input, filename='Embroidery.pes') {
  const bytes=input instanceof Uint8Array?input:new Uint8Array(input);
  if(bytes.length<32||bytes.length>16*1024*1024)throw new Error('Choose a valid PES/PEC file smaller than 16 MB.');
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  const ascii=(p,n)=>new TextDecoder('windows-1252').decode(bytes.subarray(p,p+n)).replace(/\0/g,'').trim();
  const magic=ascii(0,8),raw=magic==='#PEC0001';
  if(!raw&&!/^#PES\d{4}$/.test(magic))throw new Error('This is not a PES or PEC embroidery file.');
  const start=raw?8:view.getUint32(8,true);
  if(start<8||start+528>=bytes.length||ascii(start,3)!=='LA:')throw new Error('The file has a missing or invalid PEC stitch block.');
  const block=start+512,blockLength=bytes[block+2]|bytes[block+3]<<8|bytes[block+4]<<16;
  const end=block+blockLength;
  if(blockLength<17||end>bytes.length||bytes[block+5]!==0x31||bytes[block+6]!==0xff||bytes[block+7]!==0xf0)throw new Error('The PEC stitch block is truncated or invalid.');
  const count=bytes[start+48]+1;
  const warnings=[],custom=readThreadChart(bytes,magic,start,warnings);
  if (magic === '#PES0001' && start === 22) warnings.push('This file omits PES layout records. The centered stitch preview cannot confirm machine placement; re-export from Good Sew before sewing if your Brother preview is clipped.');
  const palette=Array.from(bytes.subarray(start+49,start+49+count));
  let chartIndex=0;const mapped=new Map();
  const colors=palette.map((index,i)=>{
    let thread;
    if(custom.length>=count)thread=custom[i];
    else if(custom.length) {if(!mapped.has(index))mapped.set(index,custom[chartIndex++]);thread=mapped.get(index);}
    const brother=BROTHER_PALETTE.find(t=>t.i===index)||{i:index,name:'Unspecified thread',rgb:[112,112,112]};
    const color=thread?.color||rgbToHex(brother.rgb);
    return {color,brother:thread?nearestBrother([parseInt(color.slice(1,3),16),parseInt(color.slice(3,5),16),parseInt(color.slice(5,7),16)]):brother,name:thread?.name||brother.name,brand:thread?.brand||'Brother PEC palette',code:thread?.code||String(index),source:thread?'PES thread table':'PEC palette',stop:i>0&&palette[i-1]===index};
  });
  let p=block+16,x=0,y=0,ci=0,stitches=0,finished=false;const plan=[];
  const read=()=>{if(p>=end)throw new Error('The file ends in the middle of a stitch.');return bytes[p++];};
  const value=(first)=>{
    if(!(first&0x80))return {delta:first>63?first-128:first,jump:false,trim:false};
    if(first&0x40)throw new Error('Unsupported PEC command in stitch data.');
    let n=((first&15)<<8)|read();if(n&0x800)n-=4096;
    return {delta:n,jump:!!(first&0x10),trim:!!(first&0x20)};
  };
  while(p<end) {
    const first=read();
    if(first===0xff){finished=true;plan.push({x:x/10,y:y/10,cmd:'end',color:ci});break;}
    if(first===0xfe) {
      if(read()!==0xb0)throw new Error('Unsupported color-change command.');read();ci++;
      if(ci>=colors.length)throw new Error('The file changes to a thread missing from its palette.');
      plan.push({x:x/10,y:y/10,cmd:colors[ci].stop?'stop':'color',color:ci});continue;
    }
    const dx=value(first),dy=value(read());
    if(dx.trim||dy.trim)plan.push({x:x/10,y:y/10,cmd:'trim',color:ci});
    x+=dx.delta;y+=dy.delta;
    if(Math.abs(x)>1000000||Math.abs(y)>1000000)throw new Error('Stitch coordinates exceed the viewer range.');
    const cmd=dx.jump||dy.jump||dx.trim||dy.trim?'jump':'stitch';
    plan.push({x:x/10,y:y/10,cmd,color:ci});
    if(cmd==='stitch'&&++stitches>LIMIT)throw new Error('This viewer supports up to 200,000 stitches per file.');
    if(plan.length>600000)throw new Error('The file contains too many machine commands.');
  }
  if(!finished)throw new Error('The file is missing its end-of-pattern command.');
  if(!stitches)throw new Error('This file contains no stitches to preview.');
  // Current Brother/Pystitch PEC framing carries an origin record followed
  // by the real initial jump. Older Good Sew/pyembroidery files lack it.
  // Decode both for compatibility, but do not present the origin record as
  // an extra machine travel move. Its translated extents must match PEC.
  let stitchPoints=plan.filter(s=>s.cmd==='stitch'),bounds=bbox(stitchPoints);
  const hasOriginRecord=plan[0]?.cmd==='jump' && plan[1]?.cmd==='jump'
    && (bytes[block+16]&0xf0)===0x90 && (bytes[block+18]&0xf0)===0x90
    && Math.abs(bounds.minX)<.001 && Math.abs(bounds.minY)<.001
    && Math.abs(bounds.w-view.getUint16(block+8,true)/10)<.101
    && Math.abs(bounds.h-view.getUint16(block+10,true)/10)<.101;
  if(hasOriginRecord) {
    const origin=plan.shift();
    for(const s of plan){s.x-=origin.x;s.y-=origin.y;}
    stitchPoints=plan.filter(s=>s.cmd==='stitch');bounds=bbox(stitchPoints);
  } else if(bounds.minX<-.1 || bounds.minY<-.1) {
    warnings.push('PEC origin record is missing or could not be verified. The viewer centers stitches automatically; re-export before sewing if the machine shows a clipped or shifted design.');
  }
  if(bounds.w>2000||bounds.h>2000)throw new Error('The design is too large for this embroidery viewer (2,000 mm maximum).');
  // Center the decoded design in the displayed SE700 field without resizing it.
  const ox=50-(bounds.minX+bounds.maxX)/2,oy=50-(bounds.minY+bounds.maxY)/2;
  for(const s of plan){s.x+=ox;s.y+=oy;}
  const centered={...bounds,minX:bounds.minX+ox,maxX:bounds.maxX+ox,minY:bounds.minY+oy,maxY:bounds.maxY+oy};
  if(bounds.w>100||bounds.h>100||stitches>100000)warnings.push('Preview only: this pattern exceeds the SE700 size or stitch-count limit.');
  const used=colors.slice(0,ci+1);
  if(used.some(c=>c.source==='PEC palette'))warnings.push('Some colors use the limited PEC palette. Change the preview spool colors if they differ from your thread.');
  return {plan,colors:used,bounds:centered,initialPosition:{x:ox,y:oy},metadata:{filename,name:ascii(start+3,16)||filename,format:magic.slice(1),stitches,colorBlocks:used.length,pecOriginRecord:hasOriginRecord,colorSource:custom.length?'PES thread table when available':'Brother PEC palette',warnings}};
}

function readThreadChart(bytes,magic,limit,warnings) {
  const version=Number(magic.slice(4));if(version<50)return [];
  const v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);let p=16;
  const need=n=>{if(p+n>limit)throw new Error('header');};
  const skip=n=>{need(n);p+=n;};
  const str=()=>{need(1);const n=bytes[p++];need(n);const s=new TextDecoder('windows-1252').decode(bytes.subarray(p,p+n));p+=n;return s;};
  const u16=()=>{need(2);const n=v.getUint16(p,true);p+=2;return n;};
  try {
    for(let i=0;i<5;i++)str();
    if([50,55,56,60,70,80].includes(version)) {skip(version<60?24:version===80?38:36);str();skip(version===80?26:24);}
    else if(version===90||version===100){skip(14);str();skip(version===90?30:38);str();skip(34);}
    else {warnings.push('Unknown PES header version; using its embedded PEC palette.');return [];}
    if(u16()||u16()||u16()){warnings.push('Complex PES header: preview colors use the PEC palette.');return [];}
    const count=u16();if(count>256)throw new Error('threads');const threads=[];
    for(let i=0;i<count;i++) {
      const code=str();need(3);const rgb=[bytes[p++],bytes[p++],bytes[p++]];skip(5);
      const name=str(),brand=str();str();threads.push({code,color:rgbToHex(rgb),name,brand});
    }
    return threads;
  } catch {warnings.push('PES thread metadata could not be read; using the PEC palette.');return [];}
}
