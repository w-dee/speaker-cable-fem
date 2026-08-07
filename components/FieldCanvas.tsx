"use client";
import { useEffect, useRef, useState } from "react";
import type { CableSolution } from "../lib/fem";

export type FieldMode = "ratio" | "abs" | "re" | "im" | "phase" | "loss";

function ramp01(t: number) {
  t = Math.max(0, Math.min(1, t));
  const stops = [[8, 17, 46], [24, 70, 142], [21, 163, 178], [246, 201, 81], [198, 49, 42]];
  const u = t * (stops.length - 1), i = Math.min(stops.length - 2, Math.floor(u)), f = u - i;
  return `rgb(${stops[i].map((v, k) => Math.round(v + (stops[i + 1][k] - v) * f)).join(",")})`;
}

export default function FieldCanvas({ solution, mode, fixedScale, showMesh }: { solution: CableSolution; mode: FieldMode; fixedScale: boolean; showMesh: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [clipped, setClipped] = useState(false);
  const { mesh } = solution;
  const label = mode === "ratio" ? "|J| / J平均" : mode === "abs" ? "|J| [A/m²]" : mode === "re" ? "Re(J) [A/m²]" : mode === "im" ? "Im(J) [A/m²]" : mode === "phase" ? "位相 [rad]" : "|J|²/σ [W/m³]";

  useEffect(() => {
    const canvas = ref.current; if (!canvas) return;
    const ctx = canvas.getContext("2d"); if (!ctx) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const cssW = Math.max(320, canvas.clientWidth), cssH = Math.max(250, Math.round(cssW * 0.48));
    canvas.width = Math.round(cssW * dpr); canvas.height = Math.round(cssH * dpr); canvas.style.height = `${cssH}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, cssW, cssH);
    const sep = solution.centerDistanceM / solution.radiusM;
    const xHalf = Math.max(3.0, sep / 2 + 1.6), yHalf = 1.55;
    const sx = (cssW - 56) / (2 * xHalf), sy = (cssH - 48) / (2 * yHalf), s = Math.min(sx, sy);
    const X = (x: number) => cssW / 2 + s * x, Y = (y: number) => cssH / 2 - s * y;
    const values = mesh.points.map((_, i) => {
      const re = mesh.jRe[i], im = mesh.jIm[i]; if (!Number.isFinite(re)) return NaN;
      const mag = Math.hypot(re, im);
      if (mode === "ratio") return mag / solution.jNominal;
      if (mode === "abs") return mag;
      if (mode === "re") return re;
      if (mode === "im") return im;
      if (mode === "phase") return Math.atan2(im, re);
      return mag * mag / solution.input.sigma;
    });
    const finite = values.filter(Number.isFinite);
    const signed = mode === "re" || mode === "im" || mode === "phase";
    const maxAbs = Math.max(...finite.map(Math.abs), 1e-30);
    let lim = maxAbs;
    if (fixedScale) {
      if (mode === "ratio") lim = 3;
      else if (mode === "abs" || mode === "re" || mode === "im") lim = 3 * solution.jNominal;
      else if (mode === "phase") lim = Math.PI;
      else lim = 9 * solution.jNominal * solution.jNominal / solution.input.sigma;
    }
    let didClip = false;
    for (let it = 0; it < mesh.triangles.length; it++) {
      if (mesh.material[it] < 0) continue;
      const tri = mesh.triangles[it];
      const v = tri.reduce((sum, id) => sum + (Number.isFinite(values[id]) ? values[id] : 0), 0) / 3;
      if (Math.abs(v) > lim * (1 + 1e-10)) didClip = true;
      const q = signed ? 0.5 + 0.5 * Math.max(-1, Math.min(1, v / lim)) : Math.max(0, Math.min(1, v / lim));
      ctx.beginPath(); ctx.moveTo(X(mesh.points[tri[0]][0]), Y(mesh.points[tri[0]][1]));
      ctx.lineTo(X(mesh.points[tri[1]][0]), Y(mesh.points[tri[1]][1])); ctx.lineTo(X(mesh.points[tri[2]][0]), Y(mesh.points[tri[2]][1])); ctx.closePath();
      ctx.fillStyle = ramp01(q); ctx.fill();
      if (showMesh) { ctx.strokeStyle = "rgba(255,255,255,.24)"; ctx.lineWidth = 0.35; ctx.stroke(); }
    }
    setClipped(didClip);
    const fg = getComputedStyle(document.documentElement).getPropertyValue("--ink").trim() || "#102136";
    ctx.strokeStyle = fg; ctx.fillStyle = fg; ctx.lineWidth = 1.2; ctx.font = "12px system-ui";
    const centers = [-sep / 2, sep / 2];
    for (let k = 0; k < 2; k++) {
      ctx.beginPath(); ctx.arc(X(centers[k]), Y(0), s, 0, 2 * Math.PI); ctx.stroke();
      ctx.beginPath(); ctx.arc(X(centers[k]), Y(0), 2.5, 0, 2 * Math.PI); ctx.fill();
      ctx.fillText(k === 0 ? "A  ⊙  +1 A RMS" : "B  ⊗  −1 A RMS", X(centers[k]) - 40, Y(-1.25));
    }
    // g and center distance dimensions.
    const leftSurface = centers[0] + 1, rightSurface = centers[1] - 1;
    const gy = Y(-0.88); ctx.beginPath(); ctx.moveTo(X(leftSurface), gy); ctx.lineTo(X(rightSurface), gy); ctx.stroke();
    ctx.fillText(`g = ${solution.input.gapMm.toPrecision(3)} mm`, (X(leftSurface) + X(rightSurface)) / 2 - 32, gy - 6);
    const dy = Y(1.28); ctx.beginPath(); ctx.moveTo(X(centers[0]), dy); ctx.lineTo(X(centers[1]), dy); ctx.stroke();
    ctx.fillText(`D = ${(solution.centerDistanceM * 1e3).toFixed(3)} mm`, cssW / 2 - 46, dy - 6);
  }, [solution, mode, fixedScale, showMesh, mesh]);

  const maxLabel = mode === "ratio" ? (solution.jMaxAbs / solution.jNominal).toFixed(3) : mode === "phase" ? "π" : "auto";
  return <div className="field-wrap">
    <canvas ref={ref} className="field-canvas" role="img" aria-label={`2導体断面の${label}ヒートマップ`}/>
    <div className="colorbar" aria-label="カラースケール"><span>{label}</span><i/><span>{fixedScale ? "固定スケール" : `自動: max ${maxLabel}`}</span></div>
    {clipped && fixedScale && <p className="clip-note">固定カラースケール上限を超えた領域はクリップされています。</p>}
  </div>;
}
