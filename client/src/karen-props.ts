// Little held props that make each store-signature karen (shared/sigkarens.ts) recognisable at a glance.
// buildKarenProp(kind) returns a small low-poly group, or null for kinds without one.
// Convention: the origin is the grip point in the right hand; +y is up, +z is forward (the way the character faces),
// sizes are in metres. Attach it to the hand/forearm (e.g. h.armR at the hand's offset) — anything that should rest on
// the floor (the 狗狗試吃團's dog, the 硬要升等's suitcase) is placed below the hand already.
// Geometries and materials are shared between all props (built once), so many karens on screen stay cheap.
import * as THREE from 'three';

const geos = new Map<string, THREE.BufferGeometry>();
const mats = new Map<number, THREE.Material>();
function g(key: string, make: () => THREE.BufferGeometry) { let x = geos.get(key); if (!x) { x = make(); geos.set(key, x); } return x; }
function m(color: number) {
  let x = mats.get(color);
  if (!x) { x = new THREE.MeshStandardMaterial({ color, roughness: 0.65, metalness: 0.05, flatShading: true }); mats.set(color, x); }
  return x;
}
const box = (w: number, h: number, d: number) => g(`b${w},${h},${d}`, () => new THREE.BoxGeometry(w, h, d));
const cyl = (rt: number, rb: number, h: number, s = 8) => g(`c${rt},${rb},${h},${s}`, () => new THREE.CylinderGeometry(rt, rb, h, s));
const sph = (r: number) => g(`s${r}`, () => new THREE.IcosahedronGeometry(r, 0));
const tor = (r: number, t: number, arc = Math.PI * 2) => g(`t${r},${t},${arc}`, () => new THREE.TorusGeometry(r, t, 4, 10, arc));

function add(parent: THREE.Object3D, geo: THREE.BufferGeometry, color: number, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
  const mesh = new THREE.Mesh(geo, m(color));
  mesh.position.set(x, y, z); mesh.rotation.set(rx, ry, rz);
  parent.add(mesh);
  return mesh;
}

const BUILDERS: Record<string, (o: THREE.Group) => void> = {
  sampler(o) { // tester bottle + cotton pad
    add(o, cyl(0.035, 0.035, 0.12), 0xf783ac, 0, 0.04, 0.03);
    add(o, cyl(0.022, 0.022, 0.035), 0xf8f9fa, 0, 0.12, 0.03);
    add(o, cyl(0.03, 0.03, 0.008, 10), 0xffffff, 0.06, 0.0, 0.05, Math.PI / 2);
  },
  reader(o) { // open book
    add(o, box(0.13, 0.008, 0.18), 0x2b8a3e, -0.065, 0, 0.06, 0, 0, 0.25);
    add(o, box(0.13, 0.008, 0.18), 0x2b8a3e, 0.065, 0, 0.06, 0, 0, -0.25);
    add(o, box(0.12, 0.012, 0.17), 0xfff9db, -0.06, 0.008, 0.06, 0, 0, 0.25);
    add(o, box(0.12, 0.012, 0.17), 0xfff9db, 0.06, 0.008, 0.06, 0, 0, -0.25);
  },
  toucher(o) { // croissant pinched between the fingers
    add(o, tor(0.05, 0.028, Math.PI * 1.3), 0xe8b04b, 0, 0.02, 0.07, Math.PI / 2, 0, 0.6);
    add(o, sph(0.03), 0xc68642, 0, 0.02, 0.07);
  },
  taster(o) { // skewer with two sample cubes + a tiny paper cup
    add(o, cyl(0.004, 0.004, 0.16, 4), 0xe9c46a, 0, 0.06, 0.04);
    add(o, box(0.03, 0.03, 0.03), 0xff8787, 0, 0.1, 0.04);
    add(o, box(0.03, 0.03, 0.03), 0xffd43b, 0, 0.06, 0.04);
    add(o, cyl(0.03, 0.022, 0.04), 0xffffff, 0.07, -0.01, 0.05);
  },
  dogfeed(o) { // leash down to a small dog at his feet, a treat in the hand
    add(o, box(0.05, 0.02, 0.03), 0xf59f00, 0, 0.0, 0.05);
    add(o, cyl(0.006, 0.006, 0.85, 4), 0xe03131, 0, -0.42, 0.22, -0.5);
    const dog = new THREE.Group(); dog.position.set(0, -0.82, 0.45); o.add(dog);
    add(dog, box(0.26, 0.13, 0.13), 0xd9a066, 0, 0.12, 0);
    add(dog, sph(0.075), 0xd9a066, 0.15, 0.2, 0);
    add(dog, sph(0.025), 0x212529, 0.22, 0.2, 0);
    for (const [x, z] of [[-0.09, -0.04], [-0.09, 0.04], [0.09, -0.04], [0.09, 0.04]]) add(dog, cyl(0.018, 0.018, 0.08, 5), 0xc68642, x, 0.04, z);
    add(dog, box(0.03, 0.06, 0.06), 0x8d6e63, 0.14, 0.27, 0.05); add(dog, box(0.03, 0.06, 0.06), 0x8d6e63, 0.14, 0.27, -0.05);
  },
  squatter(o) { // laptop tucked in the hand, screen open
    add(o, box(0.3, 0.015, 0.21), 0xadb5bd, 0, 0, 0.1);
    add(o, box(0.3, 0.2, 0.012), 0x495057, 0, 0.1, 0.0, -0.25);
    add(o, box(0.26, 0.16, 0.002), 0x74c0fc, 0, 0.1, 0.008, -0.25);
  },
  kicker(o) { // popcorn bucket
    add(o, cyl(0.075, 0.055, 0.16, 8), 0xe03131, 0, 0.06, 0.06);
    add(o, cyl(0.077, 0.077, 0.03, 8), 0xffffff, 0, 0.1, 0.06);
    for (const [x, z] of [[0.02, 0.03], [-0.03, 0.07], [0.03, 0.09], [-0.01, 0.05]]) add(o, sph(0.03), 0xfff3bf, x, 0.15, z);
  },
  packer(o) { // stack of takeaway containers
    for (let i = 0; i < 3; i++) add(o, box(0.16, 0.05, 0.12), i === 1 ? 0xffa8a8 : 0xe9ecef, 0, i * 0.055, 0.08);
    add(o, box(0.17, 0.012, 0.13), 0x1c7ed6, 0, 0.165, 0.08);
  },
  wiper(o) { // car keys swinging on a ring
    add(o, tor(0.025, 0.005), 0xadb5bd, 0, -0.02, 0.05);
    add(o, box(0.05, 0.02, 0.035), 0x212529, 0.03, -0.06, 0.05);
    add(o, box(0.012, 0.05, 0.004), 0xced4da, -0.01, -0.07, 0.05);
  },
  benchhog(o) { // dumbbell
    add(o, cyl(0.014, 0.014, 0.22, 6), 0x868e96, 0, 0, 0.05, 0, 0, Math.PI / 2);
    add(o, cyl(0.05, 0.05, 0.05, 8), 0x212529, -0.09, 0, 0.05, 0, 0, Math.PI / 2);
    add(o, cyl(0.05, 0.05, 0.05, 8), 0x212529, 0.09, 0, 0.05, 0, 0, Math.PI / 2);
  },
  doneness(o) { // steak knife pointing accusingly
    add(o, box(0.02, 0.025, 0.09), 0x5c3d2e, 0, 0, 0.03);
    add(o, box(0.006, 0.03, 0.14), 0xdee2e6, 0, 0.005, 0.14);
  },
  refry(o) { // fried chicken cutlet in a paper sleeve
    add(o, box(0.15, 0.025, 0.2), 0xd9822b, 0, 0.04, 0.09, 0.3);
    add(o, box(0.16, 0.03, 0.1), 0xfff9db, 0, 0.0, 0.05, 0.3);
  },
  unboxer(o) { // opened box with its flaps up and the earphones hanging out
    add(o, box(0.16, 0.1, 0.12), 0xc68642, 0, 0.03, 0.08);
    add(o, box(0.16, 0.005, 0.06), 0xc68642, 0, 0.09, 0.03, -0.7);
    add(o, box(0.16, 0.005, 0.06), 0xc68642, 0, 0.09, 0.13, 0.7);
    add(o, tor(0.035, 0.008, Math.PI), 0xf8f9fa, 0, 0.1, 0.08);
  },
  photo(o) { // a celebrity photo held up
    add(o, box(0.13, 0.17, 0.008), 0xf8f9fa, 0, 0.1, 0.06, -0.2);
    add(o, box(0.11, 0.14, 0.002), 0xf783ac, 0, 0.1, 0.066, -0.2);
    add(o, sph(0.03), 0xffd8a8, 0, 0.12, 0.07);
  },
  coins(o) { // a sagging cloth bag of coins
    add(o, sph(0.08), 0xe9c46a, 0, -0.07, 0.05);
    add(o, cyl(0.025, 0.04, 0.04, 6), 0xd4a373, 0, 0.0, 0.05);
    for (const [x, z] of [[0.03, 0.1], [-0.04, 0.09]]) add(o, cyl(0.016, 0.016, 0.005, 8), 0xfab005, x, -0.13, z);
  },
  rx(o) { // empty prescription pad + pill bottle
    add(o, box(0.1, 0.004, 0.14), 0xffffff, 0, 0, 0.07, 0.4);
    add(o, cyl(0.025, 0.025, 0.06, 8), 0xf08c00, 0.07, 0.03, 0.05);
    add(o, cyl(0.027, 0.027, 0.015, 8), 0xffffff, 0.07, 0.065, 0.05);
  },
  upgrader(o) { // rolling suitcase pulled along, VIP card in hand
    add(o, box(0.06, 0.004, 0.09), 0xfab005, 0.05, 0.02, 0.06, 0.5);
    add(o, cyl(0.008, 0.008, 0.45, 4), 0x868e96, 0, -0.22, -0.12, 0.35);
    const bag = new THREE.Group(); bag.position.set(0, -0.6, -0.3); o.add(bag);
    add(bag, box(0.3, 0.4, 0.16), 0x5f3dc4, 0, 0, 0);
    for (const x of [-0.11, 0.11]) add(bag, cyl(0.025, 0.025, 0.02, 6), 0x212529, x, -0.21, 0, 0, 0, Math.PI / 2);
  },
  // ---- general karens (round 27) ----
  lottery(o) { // a fan of receipts, and a rubber-banded stack of more
    for (let i = 0; i < 5; i++) add(o, box(0.07, 0.003, 0.15), 0xffffff, -0.06 + i * 0.03, 0.02 + i * 0.004, 0.08, 0, (i - 2) * 0.22, 0);
    add(o, box(0.08, 0.05, 0.16), 0xf8f9fa, 0.02, -0.05, 0.02);
    add(o, box(0.085, 0.012, 0.012), 0xe03131, 0.02, -0.05, 0.02);
  },
  change(o) { // an open coin purse and a coin pinched in the fingers
    add(o, sph(0.06), 0xd6336c, 0, -0.03, 0.06);
    add(o, tor(0.045, 0.008, Math.PI), 0xfab005, 0, 0.02, 0.06, Math.PI / 2);
    add(o, cyl(0.022, 0.022, 0.005, 10), 0xfcc419, 0.05, 0.07, 0.08, Math.PI / 2);
  },
  bagman(o) { // a bulging plastic shopping bag stuffed with more bags (and goods)
    add(o, tor(0.05, 0.008, Math.PI), 0xf8f9fa, 0, -0.02, 0.05);
    add(o, sph(0.17), 0xf1f3f5, 0, -0.24, 0.06);
    add(o, sph(0.1), 0xffd43b, 0.06, -0.14, 0.1);
    add(o, sph(0.09), 0x74c0fc, -0.07, -0.13, 0.08);
  },
  toilet(o) { // the tour leader's little flag on a telescopic pole
    add(o, cyl(0.01, 0.01, 0.7), 0xadb5bd, 0, 0.32, 0.04);
    add(o, box(0.2, 0.13, 0.008), 0xe03131, 0.1, 0.6, 0.04);
    add(o, sph(0.02), 0xfab005, 0, 0.68, 0.04);
  },
  toiletMember(o) { // a roll of toilet paper, ready
    add(o, cyl(0.055, 0.055, 0.1, 10), 0xffffff, 0, 0.02, 0.06, 0, 0, Math.PI / 2);
    add(o, cyl(0.02, 0.02, 0.102, 8), 0xced4da, 0, 0.02, 0.06, 0, 0, Math.PI / 2);
  },
};

/** A held prop for a store-signature karen, or null if this kind has none. */
export function buildKarenProp(kind: string): THREE.Object3D | null {
  const b = BUILDERS[kind];
  if (!b) return null;
  const o = new THREE.Group(); o.name = 'karenProp:' + kind;
  b(o);
  return o;
}
/** Kinds that have a prop (for tests / previews). */
export const KAREN_PROP_KINDS = Object.keys(BUILDERS);
