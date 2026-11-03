import * as planck from 'planck';

const V = planck.Vec2;

// helper: shape area = computeMass({mass:0,...}, 1).mass  (density 1 => mass == area)
function area(shape) {
  const md = { mass: 0, center: new V(0, 0), I: 0 };
  shape.computeMass(md, 1);
  return md.mass;
}

// --- capsule naive area check ---
const r = 0.18, T = 0.56, s = T - 2 * r;
console.log('s =', s);

const box = planck.Box(r, s / 2);
const cUp = new planck.Circle(new V(0, s / 2), r);
const cDn = new planck.Circle(new V(0, -s / 2), r);

const aBox = area(box), aC = area(cUp);
console.log('box area =', aBox, ' circle area =', aC);
const planckNaive = aBox + 2 * aC;
console.log('planck naive (box + 2 circles) =', planckNaive);
console.log('2rs + 2*pi*r^2 =', 2 * r * s + 2 * Math.PI * r * r);
console.log('4rs + 2*pi*r^2 =', 4 * r * s + 2 * Math.PI * r * r);
console.log('stadium exact 2rs + pi*r^2 =', 2 * r * s + Math.PI * r * r);

// --- world + multi-fixture mass + setMassData ---
const world = new planck.World({ gravity: { x: 0, y: -7.8 } });
const target = 6;
const density = target / (2 * r * s + 2 * Math.PI * r * r); // corrected naive
const b = world.createBody({ type: 'dynamic', position: new V(0, 2) });
const opt = (d) => ({ density: d, filterCategoryBits: 1, filterMaskBits: 0xff, filterGroupIndex: -1 });
b.createFixture(box, opt(density));
b.createFixture(cUp, opt(density));
b.createFixture(cDn, opt(density));
console.log('\nnaive mass after 3 createFixture =', b.getMass().toFixed(5), '(target ' + target + ')');
console.log('naive localCenter =', b.getLocalCenter().x.toFixed(5), b.getLocalCenter().y.toFixed(5));
console.log('naive getInertia (about origin) =', b.getInertia().toFixed(5));

// exact stadium inertia about COM
const stExactI = (mass, radius, L) => {
  const A = 2 * radius * L + Math.PI * radius * radius;
  const mRect = (mass * (2 * radius * L)) / A;
  const mHalf = (mass * (Math.PI * radius * radius) / 2) / A;
  const d = (4 * radius) / (3 * Math.PI);
  const iRect = (mRect * (4 * radius * radius + L * L)) / 12;
  const iHalf = mHalf * (radius * radius / 2 - d * d + (L / 2 + d) * (L / 2 + d));
  return iRect + 2 * iHalf;
};
const exactI = stExactI(target, r, s);
console.log('\nexact stadium I (about COM) =', exactI.toFixed(5));

b.setMassData({ mass: target, center: { x: 0, y: 0 }, I: exactI });
console.log('after setMassData: mass =', b.getMass(), ' localCenter =', b.getLocalCenter().x.toFixed(5), b.getLocalCenter().y.toFixed(5), ' getInertia =', b.getInertia().toFixed(5));

// velocity preservation on re-call
b.setLinearVelocity(new V(1.5, 2.5));
b.setAngularVelocity(0.7);
b.setMassData({ mass: 6.1, center: { x: 0.01, y: -0.02 }, I: 1.1 });
console.log('velocity after re-setMassData =', b.getLinearVelocity().x.toFixed(4), b.getLinearVelocity().y.toFixed(4), ' omega =', b.getAngularVelocity().toFixed(4));
console.log('localCenter after re-set =', b.getLocalCenter().x.toFixed(4), b.getLocalCenter().y.toFixed(4), ' worldCenter =', b.getWorldCenter().x.toFixed(4), b.getWorldCenter().y.toFixed(4));

// --- joint translation probe ---
const world2 = new planck.World({ gravity: { x: 0, y: -7.8 } });
const core = world2.createBody({ type: 'dynamic', position: new V(0, 0.53) });
const leg = world2.createBody({ type: 'dynamic', position: new V(0, 0.31) });
core.createFixture(new planck.Circle(new V(0, 0), 0.2), { filterGroupIndex: -1 });
leg.createFixture(new planck.Circle(new V(0, 0), 0.05), { filterGroupIndex: -1 });
const pj = new planck.PrismaticJoint({
  bodyA: core, bodyB: leg,
  localAnchorA: new V(0, 0), localAnchorB: new V(0, 0),
  localAxisA: new V(0, 1), referenceAngle: 0,
  enableLimit: true, lowerTranslation: 0.14, upperTranslation: 0.32,
  enableMotor: true, maxMotorForce: 220, motorSpeed: 0,
  collideConnected: false
});
world2.createJoint(pj);
console.log('\nprismatic getJointTranslation at spawn =', pj.getJointTranslation().toFixed(5), '(expect +0.22)');
console.log('leg limit lo/hi =', pj.getLowerLimit(), pj.getUpperLimit());

const armB = world2.createBody({ type: 'dynamic', position: new V(0.03, 1.3) });
armB.createFixture(new planck.Circle(new V(0.36, 0), 0.06), { filterGroupIndex: -1 });
const rj = new planck.RevoluteJoint({
  bodyA: armB, bodyB: core,
  localAnchorA: new V(0, 0), localAnchorB: new V(0.03, 0.77),
  referenceAngle: 0,
  enableLimit: true, lowerAngle: -1.309, upperAngle: 1.309,
  enableMotor: true, maxMotorTorque: 12, motorSpeed: 0,
  collideConnected: false
});
world2.createJoint(rj);
console.log('revolute getJointAngle at spawn =', rj.getJointAngle().toFixed(5));
core.setAngle(0.5);
world2.step(0.02, 50, 3);
console.log('after core angle 0.5 + 1 step: getJointAngle =', rj.getJointAngle().toFixed(5));

// --- begin-contact + isTouching while sleeping ---
let began = 0, ended = 0;
world2.on('begin-contact', () => { began++; });
world2.on('end-contact', () => { ended++; });
const floor = world2.createBody({ type: 'static', position: new V(0, -1.5) });
floor.createFixture(planck.Box(8, 1.5), { filterCategoryBits: 2, filterMaskBits: 0xffff });
console.log('\nbegan before drop =', began);
for (let i = 0; i < 300; i++) world2.step(0.02, 50, 3);
console.log('after 300 steps: began =', began, ' ended =', ended);
let touching = false, sleeping = false;
for (let c = world2.getContactList(); c; c = c.getNext()) {
  const a = c.getFixtureA().getBody(), b2 = c.getFixtureB().getBody();
  if (a === leg || b2 === leg) touching = touching || c.isTouching();
}
console.log('leg touching after rest =', touching, ' leg sleeping =', !leg.isAwake());
console.log('leg y =', leg.getPosition().y.toFixed(4));

console.log('\nAll probes done.');
