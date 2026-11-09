import {SHAPES} from './shapes.js';
import {FONTS} from './fonts.js';
import {validateProject,defaultParams} from './state.js';
import {railObject,bakeRails,validateRails,smoothRails,smoothPath,railsFromSpineWidths} from './satin.js';
import {satinLettering,SATIN_REPERTOIRE} from './satin-font.js';
import {DIGITIZING_GUIDE} from './digitizing-guide.js';
import {reviewDigitizing} from './digitizing-review.js';
const obj=(properties={},required=[])=>({type:'object',properties,required,additionalProperties:false});
const str={type:'string'},num={type:'number'},id={type:'integer'};
const point=obj({x:num,y:num},['x','y']);
const rails={type:'array',minItems:2,maxItems:2,items:{type:'array',minItems:2,maxItems:2000,items:point}};
const edit={type:'object',properties:{op:{enum:['add_satin','add_region','add_lettering','add_shape','add_running','add_text','update','remove','reorder']},id,ids:{type:'array',items:id},rails,points:{type:'array',minItems:2,maxItems:10000,items:point},kind:str,font:str,name:str,color:str,params:{type:'object'},box:obj({x:num,y:num,w:num,h:num},['x','y','w','h']),rotation:num,visible:{type:'boolean'},text:str,height:num,x:num,y:num,strokeWidth:num,letterSpacing:num,smooth:{type:'boolean'},spine:{type:'array',minItems:2,maxItems:2000,items:point},width:{anyOf:[num,{type:'array',minItems:2,maxItems:2000,items:num}]},holes:{type:'array',maxItems:20,items:{type:'array',minItems:3,maxItems:2000,items:point}}},required:['op'],additionalProperties:false};
export const DESIGN_TOOLS=[
 {name:'get_design',description:'Read this first: paired project, stable IDs, revision, geometry, digitizingGuidance from physical sew-outs, object-specific digitizingReview and satin capabilities. Use the guidance when designing.',inputSchema:obj()},
 {name:'apply_edit',description:'Apply a bounded atomic batch at an expected revision. One undo entry. Coordinates are millimeters. Follow get_design digitizingGuidance. add_satin takes rails with matching direction nodes, or spine plus width (one number or one per node); smooth:true rounds sparse control nodes. Stitches run rail to rail, so place the rails across the direction the thread should lie. params.split (mm, e.g. 7) makes split satin for areas wider than 10 mm, featherA/featherB (mm) give rail 0/rail 1 an irregular fur edge. add_region fills a freeform closed outline (points, optional holes, smooth) with params.angle and params.spacing. Objects of one color whose end and next start are within 1 mm stay connected without a trim. add_lettering uses Satin Round; read repertoire first. update supports params, rails, points (freehand lines), box, rotation, color, name and visible. Running params include returnPass and curveTolerance; text params use existing outline fonts.',inputSchema:obj({expectedRevision:str,requestId:str,operations:{type:'array',minItems:1,maxItems:100,items:edit}},['expectedRevision','requestId','operations'])},
 {name:'generate_stitches',description:'Compile the actual browser design and return machine limits, measurements and warnings.',inputSchema:obj()},
 {name:'preview_2d',description:'Compile and return a fast top-down PNG of the actual stitches with directional thread lighting (no WebGL needed). Optional focus rectangle in millimeters, width in pixels, and fabric (#rrggbb ground colour, saved with the project). Use it after every edit to judge coverage, direction and sheen.',inputSchema:obj({focus:obj({x:num,y:num,w:num,h:num},['x','y','w','h']),width:num,fabric:str})},
 {name:'preview_3d',description:'Compile and open the real Thread Lab preview. Returns a PNG from a consistent initial camera and material preset, plus measurements.',inputSchema:obj({focus:obj({x:num,y:num,w:num,h:num},['x','y','w','h']),view:{enum:['top','angled']},fabric:str})},
 {name:'preview_pes',description:'Load supplied PES/PEC bytes into the 3D viewer, preserving exact machine stitches and embedded colors. Preview only; the editable project is preserved. Maximum 1 MiB. Returns sewing checks and a PNG. No file paths or network URLs are accepted.',inputSchema:obj({filename:{type:'string',minLength:1,maxLength:120},base64:{type:'string',minLength:4,maxLength:1398104},focus:obj({x:num,y:num,w:num,h:num},['x','y','w','h']),view:{enum:['top','angled']}},['filename','base64'])},
 {name:'inspect_region',description:'Measure sewn spans and needle density in a millimeter rectangle. Density is a geometric estimate.',inputSchema:obj({x:num,y:num,w:num,h:num},['x','y','w','h'])},
 {name:'export_pes',description:'Compile, validate, encode and decode PES in memory. Return a base64 file with coordinate comparison; no machine transfer.',inputSchema:obj()},
 {name:'undo_edit',description:'Undo the most recent project edit at an expected revision.',inputSchema:obj({expectedRevision:str,requestId:str},['expectedRevision','requestId'])}
].map(t=>({...t,annotations:{readOnlyHint:!['apply_edit','undo_edit'].includes(t.name),destructiveHint:false,openWorldHint:false}}));
export function validateArgs(value,schema,path='arguments'){
 if(schema.anyOf){let last;for(const option of schema.anyOf){try{return validateArgs(value,option,path);}catch(err){last=err;}}throw last;}
 if(schema.enum&&!schema.enum.includes(value))throw Error(`${path}: unsupported value`);
 if(schema.type==='object'){
  if(!value||typeof value!=='object'||Array.isArray(value))throw Error(`${path}: expected an object`);
  for(const k of schema.required||[])if(!(k in value))throw Error(`${path}: missing ${k}`);
  for(const [k,v] of Object.entries(value)){
   if(['__proto__','constructor','prototype'].includes(k))throw Error('Forbidden property');
   if(schema.additionalProperties===false&&!schema.properties?.[k])throw Error(`${path}: unknown field ${k}`);
   if(schema.properties?.[k])validateArgs(v,schema.properties[k],path+'.'+k);
  }
 }else if(schema.type==='array'){
  if(!Array.isArray(value)||value.length<(schema.minItems||0)||value.length>(schema.maxItems||10000))throw Error(`${path}: invalid list length`);
  value.forEach(v=>validateArgs(v,schema.items,path+'[]'));
 }else if(schema.type==='number'||schema.type==='integer'){
  if(!Number.isFinite(value)||(schema.type==='integer'&&!Number.isInteger(value)))throw Error(`${path}: expected finite ${schema.type}`);
 }else if(schema.type&&typeof value!==schema.type)throw Error(`${path}: expected ${schema.type}`);
 if(schema.type==='string'&&(value.length<(schema.minLength||0)||value.length>(schema.maxLength||Infinity)))throw Error(`${path}: invalid text length`);
}
export function prepareEdits(objects,operations,nextId){
 const result=structuredClone(objects),notes=[];
 for(const op of operations){
  if(op.op==='add_satin'){
   let rails=op.rails;
   if(!rails){
    if(!op.spine||op.width===undefined)throw Error('add_satin needs rails, or spine plus width.');
    let spine=op.spine,width=op.width;
    if(op.smooth){
     const steps=spine.slice(1).map((p,i)=>Math.max(1,Math.min(16,Math.ceil(Math.hypot(p.x-spine[i].x,p.y-spine[i].y)/1.5))));
     if(Array.isArray(width)){if(width.length!==spine.length)throw Error('Give one width, or exactly one width per spine node.');width=smoothPath(width.map((w,i)=>({x:w,y:i})),steps).map(p=>Math.max(.12,p.x));}
     spine=smoothPath(spine,steps);
    }
    rails=railsFromSpineWidths(spine,width);
   }else if(op.smooth)rails=smoothRails(rails);
   result.push(railObject(rails,{id:nextId(),name:op.name,color:op.color,params:op.params}));
  }
  else if(op.op==='add_region'){
   if(!op.points||op.points.length<3)throw Error('add_region needs at least three outline points.');
   const close=ps=>{const c=ps.map(p=>({x:p.x,y:p.y}));if(op.smooth){c.push({...c[0]});return smoothPath(c,c.slice(1).map((p,i)=>Math.max(1,Math.min(16,Math.ceil(Math.hypot(p.x-c[i].x,p.y-c[i].y)/1.5))))).slice(0,-1);}return c;};
   const contours=[close(op.points),...(op.holes||[]).map(close)];
   result.push({id:nextId(),type:'fill',name:op.name||'Region',color:op.color||'#0e1f7c',visible:true,rotation:0,points:contours[0],contours,params:{...defaultParams('fill'),...op.params}});
  }
  else if(op.op==='add_lettering'){
   const r=satinLettering({...op,id:nextId,groupId:'satin-'+nextId()});result.push(...r.objects);
   if(r.substitutions.length)notes.push('Capital forms substituted for: '+r.substitutions.join(', '));
  }else if(['add_shape','add_running','add_text'].includes(op.op)){
   const type={add_shape:'fill',add_running:'running',add_text:'text'}[op.op];
   if(type==='fill'&&(!op.box||!SHAPES.some(s=>s.kind===op.kind)))throw Error('Choose a supported shape kind and a millimeter box.');
   if(type==='running'&&!op.points)throw Error('Running stitch needs points.');
   if(type==='text'&&(!op.text||!FONTS.some(f=>f.name===(op.font||'Anton'))))throw Error('Text needs a supported outline font and nonempty text.');
   result.push({id:nextId(),type,kind:op.kind,name:op.name||op.text||op.kind||'Running line',color:op.color||'#0e1f7c',visible:true,rotation:op.rotation||0,box:op.box,
    points:type==='text'?[{x:op.x??10,y:op.y??50}]:op.points||[],params:{...defaultParams(type),...op.params,...(type==='text'?{text:op.text,font:op.font||'Anton',size:op.height||12}:{})}});
  }else if(op.op==='reorder'){
   if(!Array.isArray(op.ids)||op.ids.length!==result.length||new Set(op.ids).size!==result.length||op.ids.some(id=>!result.some(o=>o.id===id)))throw Error('Reorder must include every object ID once.');
   result.sort((a,b)=>op.ids.indexOf(a.id)-op.ids.indexOf(b.id));
  }else{
   const index=result.findIndex(o=>o.id===op.id);if(index<0)throw Error('Object ID not found: '+op.id);
   if(op.op==='remove')result.splice(index,1);
   else if(op.op==='update'){
    let o=result[index];
    if(op.rails){if(o.kind!=='satin-rails')throw Error('Rail updates require a paired-rail satin object.');o=result[index]=railObject(op.rails,{id:o.id,name:o.name,color:o.color,params:o.params,groupId:o.groupId});}
    if(op.points){
     if(!['running','satin'].includes(o.type)||o.kind==='satin-rails'||o.box)throw Error('Point updates require a freehand running or satin line. Use rails or box for other objects.');
     o.points=structuredClone(op.points);delete o.contours;
    }
    for(const k of ['name','color','rotation','visible','box'])if(op[k]!==undefined)o[k]=op[k];
    if(op.params)o.params={...o.params,...op.params};
    if(o.kind==='satin-rails')bakeRails(o);
   }
  }
 }
 validateProject({version:4,objects:result.map(o=>({...o,base:o._base}))});
 for(const o of result)if(o.kind==='satin-rails'){validateRails(o._rails);}
 return {objects:result,notes};
}
export function createDesignController(hooks){
 let seq=0,last='',busy=false;const session=globalThis.crypto.randomUUID(),cache=new Map();
 const revision=()=>{const text=hooks.fingerprint();if(text!==last){last=text;seq++;}return session+':'+seq;};
 return async(name,args={})=>{
  const spec=DESIGN_TOOLS.find(t=>t.name===name);if(!spec)throw Error('Unsupported Good Sew command.');
  validateArgs(args,spec.inputSchema);
  const key=args.requestId,signature=JSON.stringify({name,args});
  if(key&&cache.has(key)){const old=cache.get(key);if(old.signature!==signature)throw Error('requestId was already used for different arguments.');return old.result;}
  if(busy)throw Error('Another design command is running. Retry after it completes.');
  busy=true;
  try{
   const before=revision();
   if(args.expectedRevision&&args.expectedRevision!==before)throw Error('Revision conflict. Read the design again before editing.');
   let result;
   if(name==='get_design')result={...hooks.read(),revision:before,digitizingGuidance:DIGITIZING_GUIDE,digitizingReview:reviewDigitizing(hooks.objects()),capabilities:{units:'mm',satin:'paired rails with matching direction nodes',satinRoundExactCharacters:SATIN_REPERTOIRE,shapes:SHAPES.map(s=>s.kind),outlineFonts:FONTS.map(f=>f.name)}};
   else if(name==='apply_edit'){
    const candidate=prepareEdits(hooks.objects(),args.operations,hooks.nextId);
    await hooks.prepare(candidate.objects);
    if(revision()!==before)throw Error('Design changed while preparing the edit. Read it again.');
    hooks.apply(candidate.objects);result={revision:revision(),notes:candidate.notes,objectIds:candidate.objects.map(o=>o.id)};
   }else if(name==='undo_edit'){hooks.undo();result={revision:revision()};}
   else {result=await hooks[name](args);result.revision=revision();}
   if(key){cache.set(key,{signature,result});if(cache.size>200)cache.delete(cache.keys().next().value);}
   return result;
  }finally{busy=false;}
 };
}
