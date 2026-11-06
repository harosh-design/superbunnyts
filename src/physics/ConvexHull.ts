import type { Vec2 } from '../config/bunnyTuning';

export function convexHull(points: Vec2[], tolerance = .0002): Vec2[] {
  const p = points.map(v => ({ x: v.x, y: v.y })).sort((a, b) => a.x - b.x || a.y - b.y);
  const cross = (a: Vec2, b: Vec2, c: Vec2) => (b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);
  const half = (input: Vec2[]) => {
    const h: Vec2[] = [];
    for (const point of input) { while(h.length > 1 && cross(h[h.length-2], h[h.length-1], point) <= 1e-10) h.pop(); h.push(point); }
    return h;
  };
  const a = half(p), b = half([...p].reverse()); a.pop(); b.pop();
  const hull = a.concat(b);
  // Inscribed approximation: never add the old centimetre-wide polygon shell.
  let changed = true;
  while (changed && hull.length > 3) {
    changed = false;
    for (let i=0;i<hull.length;i++) {
      const prev=hull[(i+hull.length-1)%hull.length], next=hull[(i+1)%hull.length], point=hull[i];
      const distance=Math.abs(cross(prev,next,point))/Math.max(1e-9,Math.hypot(next.x-prev.x,next.y-prev.y));
      if(distance < tolerance) { hull.splice(i,1); changed=true; break; }
    }
  }
  // Planck welds vertices closer than half its 5 mm linear slop. Remove these
  // explicitly so a tiny final wedge can never turn into its fallback 2 m box.
  for(let i=0;hull.length>3&&i<hull.length;) {
    const a=hull[i],b=hull[(i+1)%hull.length];
    if(Math.hypot(a.x-b.x,a.y-b.y)<.0026)hull.splice((i+1)%hull.length,1);else i++;
  }
  return hull;
}

/** Exact partition of a convex outline into Planck's <=12 vertex polygons. */
export function partitionHull(vertices: Vec2[]): Vec2[][] {
  if(vertices.length<=12)return [vertices];
  const center=vertices.reduce((p,v)=>({x:p.x+v.x/vertices.length,y:p.y+v.y/vertices.length}),{x:0,y:0});
  const result: Vec2[][] = [];
  for(let i=0;i<vertices.length;i+=10) {
    const arc=Array.from({length:Math.min(10,vertices.length-i)+1},(_,j)=>vertices[(i+j)%vertices.length]);
    result.push([center,...arc]);
  }
  return result;
}
