// Stable topological scheduling: overlapping pieces retain their original
// layering. Only independent objects can move to save thread changes/travel.
export function optimizeObjects(objects, boundsOf) {
  const boxes = objects.map(boundsOf);
  const predecessors = objects.map(() => []);
  const overlaps = (a,b) => a.minX <= b.maxX && b.minX <= a.maxX && a.minY <= b.maxY && b.minY <= a.maxY;
  for (let j = 0; j < objects.length; j++) for (let i = 0; i < j; i++) {
    if (overlaps(boxes[i], boxes[j]) || objects[i].visible === false || objects[j].visible === false) predecessors[j].push(i);
  }
  const done = new Set(), result = [];
  let lastColor = null, cursor = { x: 50, y: 50 };
  while (result.length < objects.length) {
    const ready = objects.map((_,i) => i).filter(i => !done.has(i) && predecessors[i].every(p => done.has(p)));
    ready.sort((a,b) => {
      const score = (i) => (objects[i].color === lastColor ? 0 : 10000) + Math.hypot((boxes[i].minX + boxes[i].maxX)/2 - cursor.x, (boxes[i].minY + boxes[i].maxY)/2 - cursor.y);
      return score(a) - score(b) || a - b;
    });
    const i = ready[0]; done.add(i); result.push(objects[i]); lastColor = objects[i].color;
    cursor = { x:(boxes[i].minX + boxes[i].maxX)/2, y:(boxes[i].minY + boxes[i].maxY)/2 };
  }
  const changes = (arr) => arr.slice(1).reduce((n,o,i) => n + (o.color !== arr[i].color),0);
  return changes(result) <= changes(objects) ? result : objects.slice();
}
