"use client";

type Point = { x: number; y: number };

function fmt(v: number) {
  if (!Number.isFinite(v)) return "—";
  if (Math.abs(v) >= 1000 || (Math.abs(v) > 0 && Math.abs(v) < 0.001)) return v.toExponential(2);
  return v.toFixed(Math.abs(v) < 0.1 ? 4 : 3);
}

export default function LineChart({ data, xLabel, yLabel, logX = true, currentX }: { data: Point[]; xLabel: string; yLabel: string; logX?: boolean; currentX?: number }) {
  const W = 660, H = 250, m = { l: 76, r: 18, t: 18, b: 46 };
  const valid = data.filter(p => p.x > 0 && Number.isFinite(p.x) && Number.isFinite(p.y));
  if (valid.length < 2) return <div className="chart-empty">計算待ち</div>;
  const tx = (x: number) => logX ? Math.log10(x) : x;
  const xmin = Math.min(...valid.map(p => tx(p.x))), xmax = Math.max(...valid.map(p => tx(p.x)));
  let ymin = Math.min(...valid.map(p => p.y)), ymax = Math.max(...valid.map(p => p.y));
  if (Math.abs(ymax - ymin) < 1e-14) { ymin -= 0.5; ymax += 0.5; }
  const pad = (ymax - ymin) * 0.08; ymin -= pad; ymax += pad;
  const X = (x: number) => m.l + (tx(x) - xmin) / (xmax - xmin) * (W - m.l - m.r);
  const Y = (y: number) => H - m.b - (y - ymin) / (ymax - ymin) * (H - m.t - m.b);
  const path = valid.map((p, i) => `${i ? "L" : "M"}${X(p.x).toFixed(2)},${Y(p.y).toFixed(2)}`).join(" ");
  const xticks = Array.from({ length: 5 }, (_, i) => {
    const q = xmin + (xmax - xmin) * i / 4; return { q, v: logX ? 10 ** q : q };
  });
  const yticks = Array.from({ length: 5 }, (_, i) => ymin + (ymax - ymin) * i / 4);
  const selected = currentX ? valid.reduce((a, b) => Math.abs(Math.log(b.x / currentX)) < Math.abs(Math.log(a.x / currentX)) ? b : a) : undefined;
  return <svg className="line-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${xLabel} 対 ${yLabel} の計算グラフ`}>
    <title>{`${xLabel} 対 ${yLabel}`}</title>
    {yticks.map(v => <g key={v}><line x1={m.l} x2={W - m.r} y1={Y(v)} y2={Y(v)} className="gridline"/><text x={m.l - 9} y={Y(v) + 4} textAnchor="end">{fmt(v)}</text></g>)}
    {xticks.map(({ v }) => <g key={v}><line x1={X(v)} x2={X(v)} y1={m.t} y2={H - m.b} className="gridline"/><text x={X(v)} y={H - m.b + 18} textAnchor="middle">{fmt(v)}</text></g>)}
    <path d={path} className="series-line"/>
    {selected && <circle cx={X(selected.x)} cy={Y(selected.y)} r="4.5" className="selected-dot"><title>{`${fmt(selected.x)} / ${fmt(selected.y)}`}</title></circle>}
    <text x={(m.l + W - m.r) / 2} y={H - 6} textAnchor="middle" className="axis-label">{xLabel}</text>
    <text transform={`translate(16 ${(m.t + H - m.b) / 2}) rotate(-90)`} textAnchor="middle" className="axis-label">{yLabel}</text>
  </svg>;
}
