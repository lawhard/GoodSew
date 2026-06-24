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
