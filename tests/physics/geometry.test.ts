import { it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Polygon } from 'planck';
import geometry from '../../src/config/characterGeometry.json';
import { convexHull, partitionHull } from '../../src/physics/ConvexHull';

it('uses collider geometry exported from the currently shipped GLBs',()=>{
  for(const model of ['bunny','sumo'] as const) {
    const bytes=readFileSync(new URL(`../../public/assets/models/${model}.glb`,import.meta.url));
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(geometry[model].sha256);
  }
});

it('partitions small curved outlines without Planck substituting a fallback box',()=>{
  for(const count of [13,21,31,41,61]) {
    const hull=convexHull(Array.from({length:count},(_,i)=>({x:.08*Math.cos(i*2*Math.PI/count),y:.04*Math.sin(i*2*Math.PI/count)})));
    for(const part of partitionHull(hull)) {
      expect(part.length).toBeLessThanOrEqual(12);
      const shape=new Polygon(part);
      expect(shape.m_count).toBeGreaterThanOrEqual(3);
      expect(shape.m_vertices.every(v=>Math.abs(v.x)<.081&&Math.abs(v.y)<.041)).toBe(true);
    }
  }
});
