/// <reference lib="webworker" />
import { logspace, solveCable, type CableSolution, type SolveInput } from "../lib/fem";

type Request = {
  id: number;
  input: Omit<SolveInput, "quality" | "outerFactor">;
  lengthM: number;
  loadOhm: number;
  referenceHz: number | "dc";
};

const transfer = (r: number, length: number, load: number) => load / (load + r * length);
const db = (x: number) => 20 * Math.log10(Math.max(x, 1e-300));
const slim = (s: CableSolution) => ({ rAc: s.rAc, ratio: s.ratio });

self.onmessage = (event: MessageEvent<Request>) => {
  const req = event.data;
  const post = (kind: string, payload: unknown) => self.postMessage({ id: req.id, kind, payload });
  try {
    post("status", "高速メッシュを計算中…");
    const preview = solveCable({ ...req.input, quality: "preview", outerFactor: 8 });
    post("preview", preview);

    post("status", "精密メッシュを計算中…");
    const refined = solveCable({ ...req.input, quality: "refined", outerFactor: 20 });
    let refR: number;
    if (req.referenceHz === "dc") refR = refined.rDc;
    else if (Math.abs(req.referenceHz - req.input.frequencyHz) < 1e-12) refR = refined.rAc;
    else refR = solveCable({ ...req.input, frequencyHz: req.referenceHz, quality: "refined", outerFactor: 20 }).rAc;
    const h = transfer(refined.rAc, req.lengthM, req.loadOhm);
    const href = transfer(refR, req.lengthM, req.loadOhm);
    post("refined", { solution: refined, refR, absoluteLossDb: db(h), relativeLossDb: db(h / href) });

    post("status", "周波数スイープを計算中…");
    const frequencies = logspace(20, 100000, 13);
    if (!frequencies.some(f => Math.abs(Math.log(f / req.input.frequencyHz)) < 0.03)) frequencies.push(req.input.frequencyHz);
    frequencies.sort((a, b) => a - b);
    const fData = frequencies.map(f => {
      const s = solveCable({ ...req.input, frequencyHz: f, quality: "preview", outerFactor: 8 });
      const hh = transfer(s.rAc, req.lengthM, req.loadOhm);
      return { x: f, rAc: s.rAc, ratio: s.ratio, relativeLossDb: db(hh / href) };
    });
    post("frequency", fData);

    post("status", "導体間隔スイープを計算中…");
    const gaps = logspace(0.01, 20, 12);
    if (!gaps.some(g => Math.abs(Math.log(g / req.input.gapMm)) < 0.04)) gaps.push(req.input.gapMm);
    gaps.sort((a, b) => a - b);
    const gData = gaps.map(g => {
      const s = solveCable({ ...req.input, gapMm: g, quality: "preview", outerFactor: 8 });
      let rr: number;
      if (req.referenceHz === "dc") rr = s.rDc;
      else rr = solveCable({ ...req.input, gapMm: g, frequencyHz: req.referenceHz, quality: "preview", outerFactor: 8 }).rAc;
      return { x: g, rAc: s.rAc, ratio: s.ratio, relativeLossDb: db(transfer(s.rAc, req.lengthM, req.loadOhm) / transfer(rr, req.lengthM, req.loadOhm)) };
    });
    post("gap", gData);
    post("done", { current: slim(refined) });
  } catch (error) {
    post("error", error instanceof Error ? error.message : String(error));
  }
};

export {};
