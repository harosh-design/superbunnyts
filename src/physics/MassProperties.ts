// Аналитические mass properties точных форм (стадиум-капсула, круг) и их композиция
// через теорему параллельных осей. Чистая математика без planck — исполняется в Node.
//
// PLAN §7: составная капсула Planck = прямоугольник + 2 круга с перекрывающимися
// областями; наивная сумма fixture даёт иную инерцию, поэтому итоговые mass/COM/I
// приводятся к точным значениям явно через setMassData (BodyFactory).
// Сумма по формам намеренно дублирует области пересечения — как Unity/Box2D,
// которые суммируют mass properties каждого коллайдера.

import type { Vec2 } from '../config/bunnyTuning';

export interface ShapeMass {
  /** кг */
  mass: number;
  /** центр масс в локальных координатах тела */
  com: Vec2;
  /** момент инерции относительно СВОЕГО центра масс, кг·м² */
  I: number;
}

export interface CompositeMass {
  mass: number;
  center: Vec2;
  I: number;
}

/** Площадь стадиума (капсулы): прямоугольник 2r×L + два полу-круга. */
export function stadiumArea(radius: number, segmentLength: number): number {
  return 2 * radius * Math.max(0, segmentLength) + Math.PI * radius * radius;
}

/**
 * Момент инерции стадиума заданной массы относительно его центра масс.
 * Стадиум = прямоугольник 2r×L + два полу-круга; центр тяжести полу-круга
// смещён от центра полного круга на d = 4r/(3π).
 */
export function stadiumInertia(mass: number, radius: number, segmentLength: number): number {
  const L = Math.max(0, segmentLength);
  const area = stadiumArea(radius, L);
  const mRect = (mass * (2 * radius * L)) / area;
  const mHalf = (mass * (Math.PI * radius * radius) / 2) / area;
  const d = (4 * radius) / (3 * Math.PI);
  // Прямоугольник относительно центра стадиума:
  const iRect = (mRect * (4 * radius * radius + L * L)) / 12;
  // Полу-круг: относительно центра своего полного круга m·r²/2, минус параллельная ось
  // до собственного центроида, плюс параллельная ось до центроида стадиума:
  const iHalf = mHalf * (radius * radius / 2 - d * d + (L / 2 + d) * (L / 2 + d));
  return iRect + 2 * iHalf;
}

/** Стадиум (капсула) с центром в `center`, масса `mass`. */
export function stadiumMass(mass: number, radius: number, segmentLength: number, center: Vec2): ShapeMass {
  return { mass, com: center, I: stadiumInertia(mass, radius, segmentLength) };
}

export function circleArea(radius: number): number {
  return Math.PI * radius * radius;
}

export function circleMass(mass: number, radius: number, center: Vec2): ShapeMass {
  return { mass, com: center, I: (mass * radius * radius) / 2 };
}

/**
 * Суммирует формы одной составной капсулы (плотность одна на все части) —
// та наивная сумма, которую Planck делает из fixture. Нужна, чтобы задать
// плотность: при ней наивная сумма масс даёт точную target-массу.
 */
export function capsuleNaiveArea(radius: number, totalLength: number): number {
  const L = Math.max(0, totalLength - 2 * radius);
  return L === 0 ? Math.PI * radius * radius : 2 * radius * L + 2 * Math.PI * radius * radius;
}

/**
 * Композиция форм: итоговый I — относительно ОБЩЕГО центра масс
// Body.setMassData требует I относительно origin: адаптер добавляет mass*|center|².
 */
export function compositeMassData(parts: ShapeMass[]): CompositeMass {
  let mass = 0;
  let cx = 0;
  let cy = 0;
  for (const p of parts) {
    mass += p.mass;
    cx += p.mass * p.com.x;
    cy += p.mass * p.com.y;
  }
  cx /= mass;
  cy /= mass;
  let I = 0;
  for (const p of parts) {
    const dx = p.com.x - cx;
    const dy = p.com.y - cy;
    I += p.I + p.mass * (dx * dx + dy * dy);
  }
  return { mass, center: { x: cx, y: cy }, I };
}
