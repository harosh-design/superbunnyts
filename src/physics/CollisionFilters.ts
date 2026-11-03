// Категории столкновений (план §7: отрицательный group только у персонажа,
// маски пропускают Terrain и Props).

export const Category = {
  Bunny: 0x0001,
  Terrain: 0x0002,
  Prop: 0x0004,
  Hazard: 0x0008
} as const;

/** Части одного персонажа не сталкиваются друг с другом. */
export const BUNNY_GROUP = -1;

export function bunnyFilter(ownerId = 1) {
  return {
    filterCategoryBits: Category.Bunny,
    filterMaskBits: 0xffff,
    filterGroupIndex: -ownerId
  };
}

export function terrainFilter() {
  return {
    filterCategoryBits: Category.Terrain,
    filterMaskBits: 0xffff,
    filterGroupIndex: 0
  };
}
