// Vector / geometry helpers. All design coordinates are in millimetres.

export const v = (x, y) => ({ x, y });
export const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
export const scale = (a, s) => ({ x: a.x * s, y: a.y * s });
export const dot = (a, b) => a.x * b.x + a.y * b.y;
export const len = (a) => Math.hypot(a.x, a.y);
export const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

export function norm(a) {
  const l = Math.hypot(a.x, a.y) || 1;
  return { x: a.x / l, y: a.y / l };
}

// Perpendicular (rotate 90°), pointing to the "left" of the direction.
export function perp(a) {
  return { x: -a.y, y: a.x };
}

export function lerp(a, b, t) {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

// Total length of a polyline.
export function pathLength(points) {
  let total = 0;
  for (let i = 1; i < points.length; i++) total += dist(points[i - 1], points[i]);
  return total;
}

// Resample a polyline into points spaced `spacing` mm apart along its length.
// Always includes the first and last vertex. Returns at least the endpoints.
export function resample(points, spacing) {
  if (points.length < 2) return points.slice();
  const out = [points[0]];
  let carry = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    let segLen = dist(a, b);
    if (segLen === 0) continue;
    const dir = norm(sub(b, a));
    let pos = carry;
    while (pos + spacing <= segLen) {
      pos += spacing;
      out.push(add(a, scale(dir, pos)));
    }
    carry = pos + spacing - segLen;
  }
  const last = points[points.length - 1];
  const lastOut = out[out.length - 1];
  if (dist(lastOut, last) > 1e-6) out.push(last);
  return out;
}

// Sample a point and tangent at arc-length `s` along a polyline.
export function sampleAt(points, s) {
  let acc = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i];
    const segLen = dist(a, b);
    if (acc + segLen >= s || i === points.length - 1) {
      const t = segLen === 0 ? 0 : (s - acc) / segLen;
      return { point: lerp(a, b, t), tangent: norm(sub(b, a)) };
    }
    acc += segLen;
  }
  const a = points[points.length - 2], b = points[points.length - 1];
  return { point: b, tangent: norm(sub(b, a)) };
}

export function bbox(points) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY };
}

// Point-in-polygon (ray casting). polygon = array of {x,y}.
export function pointInPolygon(pt, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x, yi = polygon[i].y;
    const xj = polygon[j].x, yj = polygon[j].y;
    const intersect = (yi > pt.y) !== (yj > pt.y) &&
      pt.x < ((xj - xi) * (pt.y - yi)) / (yj - yi + 1e-12) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

// Point-in-region test over MANY contours using the even-odd rule. Outer
// contours fill; nested (counter) contours carve holes. Returns true if `pt`
// lies in the filled region (outside any hole).
export function pointInContours(pt, contours) {
  let inside = false;
  for (const poly of contours) {
    if (pointInPolygon(pt, poly)) inside = !inside;
  }
  return inside;
}

// True if the straight segment a→b stays inside the filled region (even-odd).
// We sample the midpoint plus a few interior points; a single midpoint test can
// miss a thin hole that the segment grazes. Endpoints are skipped since they sit
// on the boundary (penetration points lie exactly on contour edges).
export function segmentInContours(a, b, contours, samples = 5) {
  for (let i = 1; i <= samples; i++) {
    const t = i / (samples + 1);
    const p = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    if (!pointInContours(p, contours)) return false;
  }
  return true;
}

// Signed area of a closed polygon (positive = CCW in a y-down system depends on
// convention; we only use the SIGN to pick the inward normal direction).
export function signedArea(poly) {
  let a = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    a += poly[j].x * poly[i].y - poly[i].x * poly[j].y;
  }
  return a / 2;
}

// Offset a closed polygon INWARD by `d` mm. Each vertex moves along the inward
// normal of its two adjacent edges (miter). Used to pull an edge-walk / outline
// run just inside the boundary so rendered thread doesn't bleed over the edge.
// `keepInside` (a region for even-odd point test) drops any offset vertex that
// landed outside (a sharp concave spike can flip a miter outward).
export function offsetContourInward(poly, d, region) {
  if (poly.length < 3 || d <= 0) return poly.slice();
  const reg = region || [poly];
  const out = [];
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    const prev = poly[(i - 1 + n) % n], cur = poly[i], next = poly[(i + 1) % n];
    const e1 = norm(sub(cur, prev));
    const e2 = norm(sub(next, cur));
    // Angle bisector normal (averaged edge normals). Direction (inward vs
    // outward) is ambiguous from winding alone at a concave/convex vertex, so we
    // resolve it empirically: step a tiny amount each way and keep whichever
    // lands inside the region.
    const nrm = (e) => ({ x: -e.y, y: e.x });
    const n1 = nrm(e1), n2 = nrm(e2);
    let mx = n1.x + n2.x, my = n1.y + n2.y;
    const ml = Math.hypot(mx, my);
    if (ml < 1e-6) { mx = n1.x; my = n1.y; } else { mx /= ml; my /= ml; }
    const cosHalf = Math.max(0.2, n1.x * mx + n1.y * my);
    const step = Math.min(d / cosHalf, d * 3);
    const probe = 1e-3;
    const inSign =
      pointInContours({ x: cur.x + mx * probe, y: cur.y + my * probe }, reg) ? 1
      : pointInContours({ x: cur.x - mx * probe, y: cur.y - my * probe }, reg) ? -1
      : 0;
    if (inSign === 0) { out.push(cur); continue; } // on a thin spike — leave it
    const p = { x: cur.x + inSign * mx * step, y: cur.y + inSign * my * step };
    // Guard: the mitered offset can overshoot through a thin feature; keep it
    // only if it stays inside, else leave the original vertex.
    out.push(pointInContours(p, reg) ? p : cur);
  }
  return out;
}

// Classify each contour as OUTER or HOLE by even-odd nesting. A contour is a
// HOLE when a point on its boundary lies inside an ODD number of the OTHER
// contours (counters/holes nest one level deep inside an outer ring). Glyph
// contours never cross, so a single boundary vertex is an unambiguous probe (a
// centroid of an outer ring can land in its own counter and misclassify).
// Returns a boolean array parallel to `contours`: true = hole.
export function classifyHoles(contours) {
  const isHole = new Array(contours.length).fill(false);
  for (let i = 0; i < contours.length; i++) {
    const probe = contours[i][0];
    if (!probe) continue;
    let depth = 0;
    for (let j = 0; j < contours.length; j++) {
      if (i === j) continue;
      if (pointInPolygon(probe, contours[j])) depth++;
    }
    isHole[i] = depth % 2 === 1;
  }
  return isHole;
}

// Intersections of a horizontal line y=yc with polygon edges; returns sorted x's.
export function scanlineIntersections(polygon, yc) {
  const xs = [];
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const yi = polygon[i].y, yj = polygon[j].y;
    if ((yi <= yc && yj > yc) || (yj <= yc && yi > yc)) {
      const t = (yc - yi) / (yj - yi);
      xs.push(polygon[i].x + t * (polygon[j].x - polygon[i].x));
    }
  }
  xs.sort((a, b) => a - b);
  return xs;
}

// Scanline intersections of y=yc across MANY contours (even-odd fill rule).
export function contoursScanline(contours, yc) {
  const xs = [];
  for (const poly of contours) {
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const yi = poly[i].y, yj = poly[j].y;
      if ((yi <= yc && yj > yc) || (yj <= yc && yi > yc)) {
        const t = (yc - yi) / (yj - yi);
        xs.push(poly[i].x + t * (poly[j].x - poly[i].x));
      }
    }
  }
  xs.sort((a, b) => a - b);
  return xs;
}

// Bounding box over a set of contours.
export function contoursBBox(contours) {
  return bbox(contours.flat());
}

// Flatten a cubic bezier into `steps` line points (excludes start, includes end).
export function flattenCubic(p0, p1, p2, p3, steps) {
  const out = [];
  for (let i = 1; i <= steps; i++) {
    const t = i / steps, mt = 1 - t;
    const a = mt * mt * mt, b = 3 * mt * mt * t, c = 3 * mt * t * t, d = t * t * t;
    out.push({ x: a * p0.x + b * p1.x + c * p2.x + d * p3.x, y: a * p0.y + b * p1.y + c * p2.y + d * p3.y });
  }
  return out;
}

// Flatten a quadratic bezier into `steps` line points (excludes start, includes end).
export function flattenQuad(p0, p1, p2, steps) {
  const out = [];
  for (let i = 1; i <= steps; i++) {
    const t = i / steps, mt = 1 - t;
    const a = mt * mt, b = 2 * mt * t, c = t * t;
    out.push({ x: a * p0.x + b * p1.x + c * p2.x, y: a * p0.y + b * p1.y + c * p2.y });
  }
  return out;
}

export function rotatePoint(p, center, angleRad) {
  const c = Math.cos(angleRad), s = Math.sin(angleRad);
  const dx = p.x - center.x, dy = p.y - center.y;
  return { x: center.x + dx * c - dy * s, y: center.y + dx * s + dy * c };
}
