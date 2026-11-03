import { Box, Circle, type Shape } from 'planck';

/** Planck uses multiple fixtures on one body for a capsule. */
export function capsuleParts(radius: number, segmentLength: number, horizontal = false): Shape[] {
  if (segmentLength <= 0) return [new Circle(radius)];
  const half = segmentLength / 2;
  const middle = horizontal ? Box(half, radius) : Box(radius, half);
  // The circles already define the rounded capsule boundary. Planck's default
  // 1 cm polygon skin would inflate its central rectangle beyond that boundary,
  // lifting the feet and changing contacts during rolls. Pinned Planck 1.5.1
  // exposes m_radius; terrain polygons keep their normal collision skin.
  middle.m_radius = 0;
  return horizontal
    ? [middle, new Circle({ x: half, y: 0 }, radius), new Circle({ x: -half, y: 0 }, radius)]
    : [middle, new Circle({ x: 0, y: half }, radius), new Circle({ x: 0, y: -half }, radius)];
}
