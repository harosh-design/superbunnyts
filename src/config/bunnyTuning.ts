// Все значения — из PLAN.md §6–§8 (порт BunnyTuning.cs / BunnyTuning.asset).
// Здесь чистые данные без зависимостей от planck/трёхмерки.

export interface Vec2 {
  x: number;
  y: number;
}

export const DEG2RAD = Math.PI / 180;

export const tuning = {
  // §6: мир
  gravity: { x: 0, y: -7.8 },
  dt: 0.02, // 50 физических тактов/секунду
  velocityIterations: 50,
  positionIterations: 3,

  // §7: тела персонажа
  core: {
    mass: 6,
    coreCenter: { x: 0, y: 0.53 },
    torsoSize: { x: 0.36, y: 0.56 }, // width, height
    headLocal: { x: 0.02, y: 0.34 }, // относительно coreCenter
    headRadius: 0.155,
    linearDamping: 0.05,
    angularDamping: 0.05,
    friction: 0.4,
    restitution: 0,
    ccd: true // в Unity у Core Continuous
  },
  leg: {
    mass: 1.2,
    hip: { x: 0.04, y: 0.36 }, // относительно base
    legSpread: 0.09,
    footSize: { x: 0.16, y: 0.11 },
    restLength: 0.22, // начальная длина ноги (translation в spawn-позе)
    limitMin: 0.14,
    limitMax: 0.32,
    linearDamping: 0.05,
    angularDamping: 0.05,
    friction: 0.9,
    restitution: 0,
    ccd: true // в Unity у стоп Continuous
  },
  arm: {
    mass: 0.4,
    shoulder: { x: 0.03, y: 0.77 }, // относительно base
    handLocal: { x: 0.36, y: 0 }, // смещение круга кисти от origin плеча
    handRadius: 0.06,
    limitDeg: 75,
    linearDamping: 0.05,
    angularDamping: 0.05,
    friction: 0.4,
    restitution: 0,
    ccd: false // в Unity у рук CCD не включено
  },
  spawnFeet: { x: -1.4, y: 0 }, // точка spawn — место подошв на земле

  // §8: моторика
  roll: {
    onSurface: 30, // Н·м
    inAir: 14
  },
  maxSpinDeg: 420, // ограничение угловой скорости Core перед solve
  jump: {
    speed: 4.4, // прибавка скорости всем пяти телам, м/с
    pushSpeed: 7.1, // толчок чужому динамическому телу, м/с
    cancelDownward: true, // BunnyTuning.cancelDownwardVelocityOnJump
    minInterval: 0.15,
    legsExtendFor: 0.15,
    armsRelaxFor: 0.22
  },
  groundedDelay: 0.1, // «Grounded»: контакт стопы <= 0.1 с назад
  surfaceDelay: 0.1, // «OnSurface»: контакт корпуса/головы/стоп/рук <= 0.1 с назад
  legMotor: {
    gain: 25, // motorSpeed = clamp(gain * (target - translation), ±speedLimit)
    extend: { target: 0.32, speedLimit: 6, maxForce: 600 }, // первые 0.15 с после прыжка
    fold: { target: 0.16, speedLimit: 6, maxForce: 220 }, // нет контакта стоп > 0.1 с
    stand: { target: 0.22, speedLimit: 0.5, maxForce: 220 } // остальные случаи, включая стойку
  },
  armMotor: {
    impactSpeed: 2, // м/с по нормали для «сильного удара»
    relaxFor: 0.22,
    strengthRate: 14, // strength += (target - strength) * (1 - exp(-14*dt))
    freeGainMin: 1.2,
    freeGainMax: 4,
    freeTorqueMin: 0.25,
    freeTorqueMax: 12
  },

  // Only the solver's small contact tolerance, rather than a remote grab zone.
  grab: { radius: 0.005, reachAngle: 60, reachGain: 12, reachTorque: 12, holdFriction: 4 },

  // §10: восстановление
  recoveryBounds: { minX: -12, maxX: 12, minY: -6, maxY: 16 }
} as const;
