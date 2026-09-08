import { computeStats, formatTime } from "./stats.js";
import { nearestNewBrothread, hexToRgb } from "./threads.js";
import { analyzeQuality } from "./qa.js";
export const FABRICS = {
  woven: { label: "Woven cotton", spacing: 0.45, stitchLength: 3, pull: 0.2, note: "Start with medium stabilizer and 40 wt embroidery thread. Test the design on matching scrap." },
  knit: { label: "T-shirt / knit", spacing: 0.5, stitchLength: 2.8, pull: 0.3, note: "Use cut-away stabilizer; hoop without stretching. These lighter fill settings are a starting point for a test sew." },
  towel: { label: "Towel / fleece", spacing: 0.4, stitchLength: 3, pull: 0.25, note: "Use suitable backing and water-soluble topping to keep stitches above the pile. Test small lettering carefully." },
};
export function fileStem(name) { return (name || "design").replace(/[^A-Za-z0-9_-]+/g,"_").replace(/^_+|_+$/g,"").slice(0,48) || "design"; }
const esc = s => String(s).replace(/[&<>"']/g,c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function threadSequence(compiled) {
  return compiled.colors.map((c,i) => {
    const spool = nearestNewBrothread(hexToRgb(c.color));
    return { color:c.color, name:spool.name, code:spool.code, brother:c.brother.name,
      stitches:compiled.plan.filter(s => s.cmd === "stitch" && s.color === i).length };
  });
}
export function buildSewSheet(compiled, name, fabric) {
  const st = computeStats(compiled), f = FABRICS[fabric] || FABRICS.woven;
  const b = compiled.bounds, paths = [];
  let run = [], ci = 0;
  const flush = () => { if (run.length > 1) paths.push(`<polyline fill="none" stroke="${esc(compiled.colors[ci]?.color || '#333')}" stroke-width="0.25" points="${run.join(' ')}"/>`); run = []; };
  for (const s of compiled.plan) { if(s.cmd !== 'stitch' || s.color !== ci) flush(); if (s.cmd === 'stitch') { ci=s.color; run.push(`${s.x},${s.y}`); } }
  flush();
  const issues = analyzeQuality(compiled).warnings;
  return `<!doctype html><html lang="en"><meta charset="utf-8"><title>${esc(name)} — sewing sheet</title>
<style>body{font:16px/1.5 system-ui;max-width:900px;margin:40px auto;padding:0 24px;color:#192c33}h1{font-size:32px;margin-bottom:0}table{width:100%;border-collapse:collapse}td,th{text-align:left;padding:10px;border-bottom:1px solid #ddd}.swatch{display:inline-block;width:18px;height:18px;border:1px solid #888;vertical-align:middle;margin-right:10px}.preview{max-width:100%;border:1px solid #ddd}small{color:#465b64}button{padding:10px 20px}@media print{button{display:none}body{margin:0}tr{break-inside:avoid}}</style>
<button onclick="window.print()">Print sewing sheet</button><h1>${esc(name)}</h1><p>Brother SE700 · 100 × 100 mm field · ${esc(f.label)}</p>
<p><b>${st.stitches.toLocaleString()} stitches</b> · ${st.width.toFixed(1)} × ${st.height.toFixed(1)} mm · ${st.threadColors} thread blocks · about ${formatTime(st.seconds)}</p>
<svg class="preview" xmlns="http://www.w3.org/2000/svg" viewBox="${b.minX-3} ${b.minY-3} ${b.w+6} ${b.h+6}" width="360" height="300" role="img" aria-label="Stitch preview">${paths.join('')}</svg>
<p><small>Preview is scaled to this page, not an actual-size placement template. Exports center the design.</small></p>
<h2>Spool order</h2><table><thead><tr><th>Step</th><th>Closest New brothread spool</th><th>Stitches</th></tr></thead><tbody>${threadSequence(compiled).map((t,i) => `<tr><td>${i+1}</td><td><span class="swatch" style="background:${esc(t.color)}"></span>${esc(t.code)} · ${esc(t.name)}</td><td>${t.stitches.toLocaleString()}</td></tr>`).join('')}</tbody></table>
<p>Spool matches are approximations. PES uses the Brother palette; its screen colors may differ from your spools. DST contains no thread-color information.</p>
<h2>Prepare and transfer</h2><p>${esc(f.note)}</p><ol><li>Download the PES file and copy it to a compatible USB flash drive. Insert it into the machine and recall the pattern from USB.</li><li>For wireless transfer from a compatible Windows PC, use Brother Design Database Transfer. Good Sew does not send files directly to the machine.</li><li>Confirm the pattern size and placement on the machine. Load the spools in the order above and test on matching scrap.</li><li>Inspect travel threads between separate pieces. The SE700 may require manual cutting even when the file contains trim commands. Remove basting after sewing.</li></ol>
${issues.length ? `<h2>Design checks</h2><ul>${issues.map(w=>`<li>${esc(w.msg)}</li>`).join('')}</ul>`:''}
<p><small>Estimates use 350 stitches/minute plus time to change thread. Fabric handling and manual cuts add time. Digital checks do not substitute for a physical stitch-out.</small></p><p><a href="https://download.brother.com/welcome/doch102582/888p10_om01en.pdf">Brother SE700 operation manual</a></p></html>`;
}
