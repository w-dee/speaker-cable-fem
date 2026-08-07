import assert from "node:assert/strict";
import { isolatedRoundResistance, solveCable } from "../lib/fem.ts";

const base = { diameterMm: 3, gapMm: 0.01, sigma: 5.8e7, currentRms: 1 };
let passed = 0;
const check = (name: string, fn: () => void) => { fn(); console.log(`PASS  ${name}`); passed++; };

// Standard cylindrical internal-impedance/Bessel reference, one conductor.
check("Bessel skin-effect reference at 10 kHz, 3 mm", () => {
  const got = isolatedRoundResistance(10000, 3, 5.8e7);
  const reference = 0.003386726289645797;
  assert.ok(Math.abs(got / reference - 1) < 2e-10, `${got}`);
});

const low = solveCable({ ...base, frequencyHz: 0.1, gapMm: 1, quality: "preview", outerFactor: 8 });
check("DC limit tends to Rac/Rdc = 1", () => assert.ok(Math.abs(low.ratio - 1) < 0.005, `${low.ratio}`));
check("current constraints are satisfied", () => assert.ok(low.currentResidual < 1e-8, `${low.currentResidual}`));

const gaps = [0.05, 0.02, 0.01, 0.005, 0.002];
const rs = gaps.map(gapMm => solveCable({ ...base, frequencyHz: 10000, gapMm, quality: "preview", outerFactor: 8 }).rAc);
check("narrow-gap resistance is finite and continuous/monotone", () => {
  assert.ok(rs.every(Number.isFinite));
  for (let i = 1; i < rs.length; i++) assert.ok(rs[i] >= rs[i - 1] * 0.999, `${gaps[i]} mm: ${rs[i - 1]} -> ${rs[i]}`);
  assert.ok(rs.at(-1)! / rs[0] < 1.03, `finite approach: ${rs.join(", ")}`);
});

const refined = solveCable({ ...base, frequencyHz: 10000, quality: "refined", outerFactor: 20 });
check("browser FEM agrees with independent Python FEM regression", () => {
  const independent = 0.01013068528688112;
  assert.ok(Math.abs(refined.rAc / independent - 1) < 0.005, `${refined.rAc}`);
});
check("refined solution satisfies prescribed RMS currents", () => assert.ok(refined.currentResidual < 1e-8, `${refined.currentResidual}`));

console.log(`\n${passed} numerical checks passed.`);
