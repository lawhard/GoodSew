import test from 'node:test';
import assert from 'node:assert/strict';
import {Window} from 'happy-dom';
import {svgPathProperties} from 'svg-path-properties';
import {parseSVG} from '../js/import/svg.js';
const w=new Window();globalThis.document=w.document;globalThis.DOMParser=w.DOMParser;
// The DOM harness does not implement SVG geometry; use an independent path
// library. Native browser CTM/rendering still needs real-browser verification.
const proto=w.SVGElement.prototype;
proto.getTotalLength=function(){return this.localName==='path'?new svgPathProperties(this.getAttribute('d')||'M0 0').getTotalLength():0;};
proto.getPointAtLength=function(n){return new svgPathProperties(this.getAttribute('d')).getPointAtLength(n);};
proto.getCTM=()=>null;
w.SVGPathElement.prototype.getTotalLength=proto.getTotalLength;
w.SVGPathElement.prototype.getPointAtLength=proto.getPointAtLength;
w.SVGPathElement.prototype.getCTM=proto.getCTM;
globalThis.getComputedStyle=el=>({fill:el.getAttribute('fill')||'#000000',stroke:el.getAttribute('stroke')||'none',display:el.getAttribute('display')||'block',visibility:'visible',opacity:'1'});
test('SVG keeps close subpaths separate and resolves relative moveto',()=>{
 const parsed=parseSVG('<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0 H20 V20 H0 Z m1 1 h18 v18 h-18 z"/></svg>',{w:100,h:100});
 assert.equal(parsed.items.length,1);assert.equal(parsed.items[0].base.length,2);
 const outer=parsed.items[0].base[0],hole=parsed.items[0].base[1];assert.equal(outer[0].x,0);assert.equal(hole[0].x,.05);assert.equal(hole[0].y,.05);
 assert.equal(document.body.children.length,0);
});
test('SVG import removes executable content before connecting to DOM',()=>{
 let attached;
 const append=document.body.appendChild.bind(document.body);
 document.body.appendChild=el=>{attached=el.shadowRoot.innerHTML;return append(el);};
 parseSVG('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><script>alert(1)</script><foreignObject><div>bad</div></foreignObject><path href="https://example.com/tracker" onclick="alert(1)" d="M0 0 H20 V20 H0 Z"/></svg>',{w:100,h:100});
 assert.ok(!/script|foreignObject|onload|onclick|href|image/.test(attached));
});
test('SVG definitions are not imported as visible artwork',()=>{
 const parsed=parseSVG('<svg xmlns="http://www.w3.org/2000/svg"><defs><path d="M0 0 H100 V100 H0 Z"/></defs><path d="M0 0 H20 V20 H0 Z"/></svg>',{w:100,h:100});
 assert.equal(parsed.items.length,1);
});

test('Open SVG strokes remain open running-stitch paths',()=>{
 const parsed=parseSVG('<svg xmlns="http://www.w3.org/2000/svg"><path fill="none" stroke="#ff0000" d="M0 0 L20 0 L20 20"/></svg>',{w:100,h:100});
 assert.equal(parsed.items[0].running,true);
 const c=parsed.items[0].base[0];assert.notDeepEqual(c[0],c.at(-1));
});
test('Unsupported SVG effects are reported instead of silently dropping artwork',()=>{
 assert.throws(()=>parseSVG('<svg xmlns="http://www.w3.org/2000/svg"><text>Hello</text></svg>',{w:100,h:100}),/Convert text to paths/);
});
