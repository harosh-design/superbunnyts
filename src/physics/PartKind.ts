// Роли тел в физическом мире. PartKind — части одного персонажа (BunnyRig);
// `part: null` — чужое тело (terrain/prop).

export type PartKind = 'core' | 'leg-0' | 'leg-1' | 'arm-0' | 'arm-1';

export interface BodyUserData {
  /** Свой серийный id (planck 1.5.1 не даёт id телам) — для dedup и kick. */
  id: number;
  /** Часть персонажа или null для не-персонажных тел. */
  part: PartKind | null;
  ownerId?: number;
  hazard?: boolean;
}

const ids = new WeakMap<object, number>();
export function nextBodyId(world: object): number { const id = (ids.get(world) ?? 0) + 1; ids.set(world, id); return id; }

export function isBunnyPart(part: PartKind | null | undefined): part is PartKind {
  return part !== null && part !== undefined;
}

export const ALL_PART_KINDS: PartKind[] = ['core', 'leg-0', 'leg-1', 'arm-0', 'arm-1'];
