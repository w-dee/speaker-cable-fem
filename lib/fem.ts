import cdt2d from "cdt2d";

export type Complex = { re: number; im: number };
export type Quality = "preview" | "refined";
export type SolveInput = {
  frequencyHz: number;
  diameterMm: number;
  gapMm: number;
  sigma: number;
  currentRms: number;
  quality?: Quality;
  outerFactor?: number;
};

export type CableSolution = {
  input: SolveInput;
  radiusM: number;
  areaM2: number;
  centerDistanceM: number;
  skinDepthM: number;
  rDc: number;
  rAc: number;
  ratio: number;
  skinOnlyR: number;
  proximityExtraR: number;
  jouleLossWm: number;
  jNominal: number;
  jMeanAbs: number;
  jMinAbs: number;
  jMaxAbs: number;
  currentResidual: number;
  solverResidual: number;
  iterations: number;
  mesh: {
    points: [number, number][];
    triangles: [number, number, number][];
    material: number[];
    jRe: number[];
    jIm: number[];
    conductorOfNode: number[];
    outerFactor: number;
  };
};

const MU0 = 4e-7 * Math.PI;
const PI2 = 2 * Math.PI;
const EPS = 1e-30;
const c = (re = 0, im = 0): Complex => ({ re, im });
const add = (a: Complex, b: Complex) => c(a.re + b.re, a.im + b.im);
const sub = (a: Complex, b: Complex) => c(a.re - b.re, a.im - b.im);
const mul = (a: Complex, b: Complex) => c(a.re * b.re - a.im * b.im, a.re * b.im + a.im * b.re);
const scale = (a: Complex, s: number) => c(a.re * s, a.im * s);
const div = (a: Complex, b: Complex) => {
  const d = b.re * b.re + b.im * b.im;
  return c((a.re * b.re + a.im * b.im) / d, (a.im * b.re - a.re * b.im) / d);
};
const abs2 = (a: Complex) => a.re * a.re + a.im * a.im;
const dotc = (a: Complex[], b: Complex[]) => {
  let r = 0, i = 0;
  for (let n = 0; n < a.length; n++) {
    r += a[n].re * b[n].re + a[n].im * b[n].im;
    i += a[n].re * b[n].im - a[n].im * b[n].re;
  }
  return c(r, i);
};
const norm = (a: Complex[]) => Math.sqrt(Math.max(0, dotc(a, a).re));

type Mesh = {
  points: [number, number][];
  triangles: [number, number, number][];
  material: number[];
  outer: Set<number>;
  conductorOfNode: number[];
};

function buildMesh(gapNorm: number, quality: Quality, outerFactor?: number): Mesh {
  const cfg = quality === "refined"
    ? { nb: 192, air: 0.50, radial: 0.07, outer: outerFactor ?? 20 }
    : { nb: 64, air: 0.90, radial: 0.18, outer: outerFactor ?? 8 };
  const R = cfg.outer;
  const sep = 2 + gapNorm;
  const centers = [-sep / 2, sep / 2];
  const points: [number, number][] = [];
  const edges: [number, number][] = [];
  const outer = new Set<number>();
  const conductorOfNode: number[] = [];
  const seen = new Map<string, number>();
  const key = (x: number, y: number) => `${Math.round(x * 1e10)},${Math.round(y * 1e10)}`;
  const put = (x: number, y: number, cond = -1) => {
    const k = key(x, y);
    const old = seen.get(k);
    if (old !== undefined) {
      if (cond >= 0) conductorOfNode[old] = cond;
      return old;
    }
    const id = points.length;
    points.push([x, y]);
    conductorOfNode.push(cond);
    seen.set(k, id);
    return id;
  };

  // Far Dirichlet square. Segment spacing is comparable to the air mesh.
  const ns = Math.max(8, Math.ceil((2 * R) / cfg.air));
  const ring: number[] = [];
  for (let q = 0; q < 4; q++) {
    for (let i = 0; i < ns; i++) {
      const t = i / ns;
      let x = 0, y = 0;
      if (q === 0) { x = -R + 2 * R * t; y = -R; }
      if (q === 1) { x = R; y = -R + 2 * R * t; }
      if (q === 2) { x = R - 2 * R * t; y = R; }
      if (q === 3) { x = -R; y = R - 2 * R * t; }
      const id = put(x, y);
      outer.add(id); ring.push(id);
    }
  }
  for (let i = 0; i < ring.length; i++) edges.push([ring[i], ring[(i + 1) % ring.length]]);

  // Circular material interfaces are exact polygon constraints. Interior rings
  // are denser near the surface where skin effect changes fastest.
  for (let k = 0; k < 2; k++) {
    const boundary: number[] = [];
    for (let i = 0; i < cfg.nb; i++) {
      const th = PI2 * i / cfg.nb;
      boundary.push(put(centers[k] + Math.cos(th), Math.sin(th), k));
    }
    for (let i = 0; i < boundary.length; i++) edges.push([boundary[i], boundary[(i + 1) % boundary.length]]);

    const nRad = Math.max(4, Math.ceil(1 / cfg.radial));
    put(centers[k], 0, k);
    for (let ir = 1; ir < nRad; ir++) {
      const u = ir / nRad;
      const r = 1 - (1 - u) * (1 - u); // cluster radial layers toward r=1
      const nr = Math.max(8, Math.round(cfg.nb * r));
      const phase = (ir % 2) * Math.PI / nr;
      for (let j = 0; j < nr; j++) {
        const th = PI2 * j / nr + phase;
        put(centers[k] + r * Math.cos(th), r * Math.sin(th), k);
      }
    }
  }

  // Air nodes. Excluding a thin band around each interface avoids nearly
  // coincident unconstrained points while the constrained circle resolves it.
  for (let y = -R + cfg.air; y < R - cfg.air / 2; y += cfg.air) {
    for (let x = -R + cfg.air; x < R - cfg.air / 2; x += cfg.air) {
      let accept = true;
      for (const cx of centers) {
        const rr = Math.hypot(x - cx, y);
        if (rr < 1 + 0.13 * cfg.air) { accept = false; break; }
      }
      if (accept) put(x, y);
    }
  }

  const all = cdt2d(points, edges, { delaunay: true, interior: true, exterior: true });
  const triangles: [number, number, number][] = [];
  const material: number[] = [];
  for (const t of all) {
    if (t[0] < 0 || t[1] < 0 || t[2] < 0) continue;
    const x = (points[t[0]][0] + points[t[1]][0] + points[t[2]][0]) / 3;
    const y = (points[t[0]][1] + points[t[1]][1] + points[t[2]][1]) / 3;
    if (Math.abs(x) > R + 1e-8 || Math.abs(y) > R + 1e-8) continue;
    let m = -1;
    if (Math.hypot(x - centers[0], y) < 1) m = 0;
    else if (Math.hypot(x - centers[1], y) < 1) m = 1;
    triangles.push(t); material.push(m);
  }
  return { points, triangles, material, outer, conductorOfNode };
}

type FemSystem = {
  diagK: Float64Array;
  rowsK: Map<number, number>[];
  rowsM: Map<number, number>[];
  b: [Float64Array, Float64Array];
  area: [number, number];
  unknown: Int32Array;
  rev: Int32Array;
};

function assemble(mesh: Mesh): FemSystem {
  const rev = new Int32Array(mesh.points.length); rev.fill(-1);
  let nu = 0;
  for (let i = 0; i < mesh.points.length; i++) if (!mesh.outer.has(i)) rev[i] = nu++;
  const unknown = new Int32Array(nu);
  for (let i = 0; i < rev.length; i++) if (rev[i] >= 0) unknown[rev[i]] = i;
  const rowsK = Array.from({ length: nu }, () => new Map<number, number>());
  const rowsM = Array.from({ length: nu }, () => new Map<number, number>());
  const b: [Float64Array, Float64Array] = [new Float64Array(nu), new Float64Array(nu)];
  const area: [number, number] = [0, 0];
  const bump = (rows: Map<number, number>[], i: number, j: number, v: number) => rows[i].set(j, (rows[i].get(j) ?? 0) + v);
  for (let it = 0; it < mesh.triangles.length; it++) {
    const tri = mesh.triangles[it];
    const p0 = mesh.points[tri[0]], p1 = mesh.points[tri[1]], p2 = mesh.points[tri[2]];
    const cross = (p1[0] - p0[0]) * (p2[1] - p0[1]) - (p2[0] - p0[0]) * (p1[1] - p0[1]);
    const A = Math.abs(cross) / 2;
    if (A < 1e-14) continue;
    const bb = [p1[1] - p2[1], p2[1] - p0[1], p0[1] - p1[1]];
    const cc = [p2[0] - p1[0], p0[0] - p2[0], p1[0] - p0[0]];
    const mat = mesh.material[it];
    if (mat >= 0) area[mat] += A;
    for (let li = 0; li < 3; li++) {
      const ui = rev[tri[li]];
      if (ui < 0) continue;
      if (mat >= 0) b[mat][ui] += A / 3;
      for (let lj = 0; lj < 3; lj++) {
        const uj = rev[tri[lj]];
        if (uj < 0) continue;
        bump(rowsK, ui, uj, (bb[li] * bb[lj] + cc[li] * cc[lj]) / (4 * A));
        if (mat >= 0) bump(rowsM, ui, uj, A * (li === lj ? 2 : 1) / 12);
      }
    }
  }
  const diagK = new Float64Array(nu);
  for (let i = 0; i < nu; i++) diagK[i] = rowsK[i].get(i) ?? 1;
  return { diagK, rowsK, rowsM, b, area, unknown, rev };
}

function solvePotential(sys: FemSystem, eta: number, muI: number): { x: Complex[]; residual: number; iterations: number } {
  const n = sys.unknown.length;
  const rhs = Array.from({ length: n }, (_, i) => c(muI * (sys.b[0][i] / sys.area[0] - sys.b[1][i] / sys.area[1]), 0));
  const apply = (x: Complex[]) => {
    const y = Array.from({ length: n }, () => c());
    for (let i = 0; i < n; i++) {
      let kr = 0, ki = 0, mr = 0, mi = 0;
      for (const [j, v] of sys.rowsK[i]) { kr += v * x[j].re; ki += v * x[j].im; }
      for (const [j, v] of sys.rowsM[i]) { mr += v * x[j].re; mi += v * x[j].im; }
      y[i] = c(kr - eta * mi, ki + eta * mr);
    }
    for (let k = 0; k < 2; k++) {
      let sr = 0, si = 0;
      for (let i = 0; i < n; i++) { sr += sys.b[k][i] * x[i].re; si += sys.b[k][i] * x[i].im; }
      const q = eta / sys.area[k];
      for (let i = 0; i < n; i++) if (sys.b[k][i]) {
        // -j eta b (b^T A)/S
        y[i].re += q * sys.b[k][i] * si;
        y[i].im -= q * sys.b[k][i] * sr;
      }
    }
    return y;
  };
  const pre = (v: Complex[]) => v.map((z, i) => {
    const mr = sys.rowsM[i].get(i) ?? 0;
    const d = c(sys.diagK[i], eta * mr);
    return div(z, d);
  });

  const x = Array.from({ length: n }, () => c());
  let r = rhs.map(z => c(z.re, z.im));
  const r0 = r.map(z => c(z.re, z.im));
  let rhoOld = c(1), alpha = c(1), omega = c(1);
  let v = Array.from({ length: n }, () => c());
  let p = Array.from({ length: n }, () => c());
  const bnorm = Math.max(norm(rhs), EPS);
  let rel = norm(r) / bnorm;
  const tol = 2e-9;
  let iter = 0;
  for (; iter < 3200 && rel > tol; iter++) {
    const rho = dotc(r0, r);
    if (Math.sqrt(abs2(rho)) < EPS) break;
    if (iter === 0) p = r.map(z => c(z.re, z.im));
    else {
      const beta = mul(div(rho, rhoOld), div(alpha, omega));
      p = r.map((z, i) => add(z, mul(beta, sub(p[i], mul(omega, v[i])))));
    }
    const phat = pre(p);
    v = apply(phat);
    const den = dotc(r0, v);
    if (Math.sqrt(abs2(den)) < EPS) break;
    alpha = div(rho, den);
    const s = r.map((z, i) => sub(z, mul(alpha, v[i])));
    if (norm(s) / bnorm < tol) {
      for (let i = 0; i < n; i++) x[i] = add(x[i], mul(alpha, phat[i]));
      r = s; rel = norm(r) / bnorm; iter++; break;
    }
    const shat = pre(s);
    const t = apply(shat);
    const tt = dotc(t, t);
    if (Math.sqrt(abs2(tt)) < EPS) break;
    omega = div(dotc(t, s), tt);
    for (let i = 0; i < n; i++) x[i] = add(x[i], add(mul(alpha, phat[i]), mul(omega, shat[i])));
    r = s.map((z, i) => sub(z, mul(omega, t[i])));
    rel = norm(r) / bnorm;
    rhoOld = rho;
    if (Math.sqrt(abs2(omega)) < EPS) break;
  }
  const rr = subVectors(apply(x), rhs);
  return { x, residual: norm(rr) / bnorm, iterations: iter };
}

function subVectors(a: Complex[], b: Complex[]) { return a.map((z, i) => sub(z, b[i])); }

function besselJ(n: 0 | 1, z: Complex): Complex {
  // Entire-function power series. |ka| remains modest in this application's
  // 20 Hz..100 kHz, 0.5..6 mm domain.
  const half = scale(z, 0.5);
  const zz = mul(half, half);
  let term = n === 0 ? c(1) : half;
  let sum = c(term.re, term.im);
  for (let m = 0; m < 160; m++) {
    const den = (m + 1) * (m + n + 1);
    term = scale(mul(term, zz), -1 / den);
    sum = add(sum, term);
    if (Math.sqrt(abs2(term)) < 2e-15 * Math.max(1, Math.sqrt(abs2(sum)))) break;
  }
  return sum;
}

export function isolatedRoundResistance(frequencyHz: number, diameterMm: number, sigma: number): number {
  const a = diameterMm * 5e-4;
  if (frequencyHz <= 1e-9) return 1 / (sigma * Math.PI * a * a);
  const q = 2 * Math.PI * frequencyHz * MU0 * sigma;
  const k = c(Math.sqrt(q / 2), -Math.sqrt(q / 2)); // sqrt(-j ω μ σ)
  const ka = scale(k, a);
  const zint = scale(div(mul(k, besselJ(0, ka)), besselJ(1, ka)), 1 / (2 * Math.PI * a * sigma));
  return zint.re;
}

export function solveCable(input: SolveInput): CableSolution {
  const frequencyHz = Math.max(0, input.frequencyHz);
  const sigma = input.sigma;
  const I = input.currentRms;
  const a = input.diameterMm * 5e-4;
  const g = input.gapMm * 1e-3;
  const D = 2 * a + g;
  const quality = input.quality ?? "preview";
  const omega = 2 * Math.PI * frequencyHz;
  const eta = omega * MU0 * sigma * a * a;
  const mesh = buildMesh(g / a, quality, input.outerFactor);
  const sys = assemble(mesh);
  const solved = solvePotential(sys, eta, MU0 * I);
  const A = Array.from({ length: mesh.points.length }, () => c());
  for (let u = 0; u < sys.unknown.length; u++) A[sys.unknown[u]] = solved.x[u];

  const C: Complex[] = [];
  for (let k = 0; k < 2; k++) {
    let ba = c();
    for (let u = 0; u < sys.unknown.length; u++) ba = add(ba, scale(solved.x[u], sys.b[k][u]));
    const ik = k === 0 ? I : -I;
    C[k] = add(c(ik / (sigma * a * a * sys.area[k]), 0), scale(c(-ba.im, ba.re), omega / sys.area[k]));
  }

  const jRe = new Array(mesh.points.length).fill(NaN);
  const jIm = new Array(mesh.points.length).fill(NaN);
  for (let i = 0; i < mesh.points.length; i++) {
    const k = mesh.conductorOfNode[i];
    if (k < 0) continue;
    const az = A[i];
    const jj = scale(sub(C[k], c(-omega * az.im, omega * az.re)), sigma);
    jRe[i] = jj.re; jIm[i] = jj.im;
  }

  const bary = [[2 / 3, 1 / 6, 1 / 6], [1 / 6, 2 / 3, 1 / 6], [1 / 6, 1 / 6, 2 / 3]];
  let loss = 0, meanAbsIntegral = 0, conductorAreaPhysical = 0;
  const currents = [c(), c()];
  let minAbs = Infinity, maxAbs = 0;
  for (let it = 0; it < mesh.triangles.length; it++) {
    const k = mesh.material[it]; if (k < 0) continue;
    const tri = mesh.triangles[it];
    const p0 = mesh.points[tri[0]], p1 = mesh.points[tri[1]], p2 = mesh.points[tri[2]];
    const areaN = Math.abs((p1[0] - p0[0]) * (p2[1] - p0[1]) - (p2[0] - p0[0]) * (p1[1] - p0[1])) / 2;
    const areaP = areaN * a * a;
    conductorAreaPhysical += areaP;
    for (const w of bary) {
      const az = add(add(scale(A[tri[0]], w[0]), scale(A[tri[1]], w[1])), scale(A[tri[2]], w[2]));
      const jj = scale(sub(C[k], c(-omega * az.im, omega * az.re)), sigma);
      const mag = Math.sqrt(abs2(jj));
      const dS = areaP / 3;
      loss += abs2(jj) / sigma * dS;
      meanAbsIntegral += mag * dS;
      currents[k] = add(currents[k], scale(jj, dS));
      minAbs = Math.min(minAbs, mag); maxAbs = Math.max(maxAbs, mag);
    }
  }
  const expected = [c(I), c(-I)];
  const currentResidual = Math.max(...currents.map((z, k) => Math.sqrt(abs2(sub(z, expected[k]))) / Math.max(Math.abs(I), EPS)));
  const rDc = 2 / (sigma * Math.PI * a * a);
  const rAc = loss / (I * I);
  const skinOnlyR = 2 * isolatedRoundResistance(frequencyHz, input.diameterMm, sigma);
  return {
    input: { ...input, quality }, radiusM: a, areaM2: Math.PI * a * a, centerDistanceM: D,
    skinDepthM: frequencyHz > 0 ? Math.sqrt(2 / (omega * MU0 * sigma)) : Infinity,
    rDc, rAc, ratio: rAc / rDc, skinOnlyR, proximityExtraR: rAc - skinOnlyR,
    jouleLossWm: loss, jNominal: Math.abs(I) / (Math.PI * a * a),
    jMeanAbs: meanAbsIntegral / conductorAreaPhysical, jMinAbs: minAbs, jMaxAbs: maxAbs,
    currentResidual, solverResidual: solved.residual, iterations: solved.iterations,
    mesh: { points: mesh.points, triangles: mesh.triangles, material: mesh.material, jRe, jIm, conductorOfNode: mesh.conductorOfNode, outerFactor: quality === "refined" ? (input.outerFactor ?? 20) : (input.outerFactor ?? 8) },
  };
}

export function logspace(lo: number, hi: number, n: number) {
  const a = Math.log(lo), b = Math.log(hi);
  return Array.from({ length: n }, (_, i) => Math.exp(a + (b - a) * i / (n - 1)));
}
