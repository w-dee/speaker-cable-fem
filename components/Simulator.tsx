"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import type { CableSolution } from "../lib/fem";
import FieldCanvas, { type FieldMode } from "./FieldCanvas";
import LineChart from "./LineChart";

type SweepPoint = { x: number; rAc: number; ratio: number; relativeLossDb: number };
type Refined = { solution: CableSolution; refR: number; absoluteLossDb: number; relativeLossDb: number };

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const fmt = (v: number, digits = 6) => Number.isFinite(v) ? v.toPrecision(digits) : "—";
const ohm = (v: number) => v < 0.01 ? `${(v * 1000).toFixed(4)} mΩ` : `${v.toFixed(6)} Ω`;

function Slider({ label, value, setValue, min, max, step, unit, log = false }: { label: string; value: number; setValue: (v: number) => void; min: number; max: number; step?: number; unit: string; log?: boolean }) {
  const p = log ? Math.log(value / min) / Math.log(max / min) : (value - min) / (max - min);
  const fromP = (q: number) => log ? min * (max / min) ** q : min + q * (max - min);
  return <div className="control-block">
    <div className="control-head"><label>{label}</label><div><input aria-label={`${label} 数値入力`} type="number" min={min} max={max} step={step ?? "any"} value={value} onChange={e => { const v = Number(e.target.value); if (Number.isFinite(v)) setValue(clamp(v, min, max)); }}/><span>{unit}</span></div></div>
    <input className="range" aria-label={`${label} スライダー`} type="range" min="0" max="1" step="0.001" value={p} onChange={e => setValue(fromP(Number(e.target.value)))}/>
    <div className="range-ends"><span>{min} {unit}</span><span>{max} {unit}</span></div>
  </div>;
}

function Metric({ label, value, note }: { label: string; value: string; note?: string }) {
  return <div className="metric"><span>{label}</span><strong>{value}</strong>{note && <small>{note}</small>}</div>;
}

export default function Simulator() {
  const [frequencyHz, setFrequency] = useState(10000);
  const [diameterMm, setDiameter] = useState(3);
  const [gapMm, setGap] = useState(1);
  const [lengthM, setLength] = useState(10);
  const [loadOhm, setLoad] = useState(4);
  const [sigma20, setSigma20] = useState(5.8e7);
  const [temperatureC, setTemperature] = useState(20);
  const [reference, setReference] = useState("1000");
  const [customRef, setCustomRef] = useState(1000);
  const [preview, setPreview] = useState<CableSolution | null>(null);
  const [refined, setRefined] = useState<Refined | null>(null);
  const [fData, setFData] = useState<SweepPoint[]>([]);
  const [gData, setGData] = useState<SweepPoint[]>([]);
  const [status, setStatus] = useState("準備中…");
  const [error, setError] = useState("");
  const [fieldMode, setFieldMode] = useState<FieldMode>("ratio");
  const [fixedScale, setFixedScale] = useState(false);
  const [showMesh, setShowMesh] = useState(false);
  const requestId = useRef(0);
  const workerRef = useRef<Worker | null>(null);
  const sigma = sigma20 / (1 + 0.00393 * (temperatureC - 20));
  const referenceHz: number | "dc" = reference === "dc" ? "dc" : reference === "custom" ? customRef : Number(reference);

  useEffect(() => {
    const id = ++requestId.current;
    workerRef.current?.terminate();
    const worker = new Worker(new URL("../workers/solver.worker.ts", import.meta.url), { type: "module" });
    workerRef.current = worker;
    worker.onmessage = (event) => {
      if (event.data.id !== id) return;
      const { kind, payload } = event.data;
      if (kind === "status") {
        setStatus(payload);
        if (payload === "高速メッシュを計算中…") { setError(""); setRefined(null); setFData([]); setGData([]); }
      }
      else if (kind === "preview") setPreview(payload);
      else if (kind === "refined") setRefined(payload);
      else if (kind === "frequency") setFData(payload);
      else if (kind === "gap") setGData(payload);
      else if (kind === "done") setStatus("精密解・スイープ計算完了");
      else if (kind === "error") { setError(payload); setStatus("計算エラー"); }
    };
    worker.postMessage({ id, input: { frequencyHz, diameterMm, gapMm, sigma, currentRms: 1 }, lengthM, loadOhm, referenceHz });
    return () => worker.terminate();
  }, [frequencyHz, diameterMm, gapMm, sigma, lengthM, loadOhm, referenceHz]);

  const sol = refined?.solution ?? preview;
  const geom = useMemo(() => {
    const a = diameterMm / 2, area = Math.PI * a * a, D = diameterMm + gapMm;
    return { a, area, D };
  }, [diameterMm, gapMm]);
  const applyRegression = () => { setFrequency(10000); setDiameter(3); setGap(0.01); setLength(10); setLoad(4); setReference("1000"); setCustomRef(1000); };

  return <main>
    <header className="hero">
      <div><p className="eyebrow">2D MAGNETOQUASISTATIC FEM · exp(jωt)</p><h1>スピーカーケーブル<br/>表皮・近接効果シミュレーター</h1></div>
      <div className="solver-state"><span className="pulse"/>{status}<small>往復電流 +1 / −1 A RMS</small></div>
    </header>

    <p className="model-note">この計算は円形単線2本の2次元モデルです。一般的な撚線、リッツ線、平角線、編組線の挙動を直接表すものではありません。</p>

    <section className="workspace">
      <aside className="controls">
        <div className="section-title"><span>01</span><h2>計算条件</h2></div>
        <Slider label="周波数" value={frequencyHz} setValue={v => setFrequency(Math.round(v))} min={20} max={100000} step={1} unit="Hz" log/>
        <Slider label="導体直径" value={diameterMm} setValue={setDiameter} min={0.5} max={6} step={0.01} unit="mm"/>
        <Slider label="導体表面間隔 g" value={gapMm} setValue={setGap} min={0.01} max={20} step={0.001} unit="mm" log/>
        <div className="geometry-readout"><span>半径 a <b>{geom.a.toFixed(3)} mm</b></span><span>断面積 <b>{geom.area.toFixed(4)} mm²</b></span><span>中心間距離 D = 2a + g <b>{geom.D.toFixed(4)} mm</b></span></div>
        <Slider label="ケーブル長（片道）" value={lengthM} setValue={setLength} min={0.5} max={100} step={0.1} unit="m"/>
        <Slider label="負荷抵抗" value={loadOhm} setValue={setLoad} min={2} max={16} step={0.1} unit="Ω"/>
        <div className="control-block"><div className="control-head"><label>基準周波数</label><select value={reference} onChange={e => setReference(e.target.value)}><option value="dc">DC近似</option><option value="20">20 Hz</option><option value="100">100 Hz</option><option value="1000">1 kHz</option><option value="custom">ユーザー入力</option></select></div>{reference === "custom" && <div className="inline-input"><input type="number" min="1" max="100000" value={customRef} onChange={e => setCustomRef(clamp(Number(e.target.value), 1, 100000))}/><span>Hz</span></div>}</div>
        <div className="control-block"><div className="control-head"><label>20℃基準の導電率 σ</label><div><input type="number" min="1000000" max="100000000" step="100000" value={sigma20} onChange={e => setSigma20(clamp(Number(e.target.value), 1e6, 1e8))}/><span>S/m</span></div></div></div>
        <div className="control-block"><div className="control-head"><label>銅温度</label><div><input type="number" min="-20" max="150" step="1" value={temperatureC} onChange={e => setTemperature(clamp(Number(e.target.value), -20, 150))}/><span>℃</span></div></div><small>α = 0.00393 /℃ → 使用 σ = {sigma.toExponential(4)} S/m</small></div>
        <button className="preset" type="button" onClick={applyRegression}>添付動画と同条件の回帰プリセット</button>
      </aside>

      <div className="results">
        <div className="section-title"><span>02</span><h2>複素電流密度</h2></div>
        <div className="field-toolbar">
          <label>表示量<select value={fieldMode} onChange={e => setFieldMode(e.target.value as FieldMode)}><option value="ratio">|J| / J平均</option><option value="abs">|J| [A/m²]</option><option value="re">J 実部</option><option value="im">J 虚部</option><option value="phase">J 位相</option><option value="loss">局所ジュール損失密度</option></select></label>
          <label className="check"><input type="checkbox" checked={fixedScale} onChange={e => setFixedScale(e.target.checked)}/>固定カラースケール</label>
          <label className="check"><input type="checkbox" checked={showMesh} onChange={e => setShowMesh(e.target.checked)}/>メッシュ表示</label>
        </div>
        {sol ? <FieldCanvas solution={sol} mode={fieldMode} fixedScale={fixedScale} showMesh={showMesh}/> : <div className="field-placeholder">有限要素解を計算中…</div>}
        {sol && <div className="j-stats"><span>平均 |J| <b>{sol.jMeanAbs.toExponential(4)} A/m²</b></span><span>最大 |J| <b>{sol.jMaxAbs.toExponential(4)}</b></span><span>最小 |J| <b>{sol.jMinAbs.toExponential(4)}</b></span><span>最大 / 公称平均 <b>{(sol.jMaxAbs / sol.jNominal).toFixed(3)}×</b></span></div>}
        <p className="fine-note">表示色の面積は抵抗計算に使いません。抵抗は複素 J から導体内の |J|²/σ を面積積分して求めます。</p>

        <div className="section-title metrics-title"><span>03</span><h2>抵抗・伝送量</h2></div>
        {sol ? <>
          <div className="metrics-grid">
            <Metric label="直流ループ抵抗 Rdc′" value={`${fmt(sol.rDc)} Ω/m`}/>
            <Metric label="交流ループ抵抗 Rac′" value={`${fmt(sol.rAc)} Ω/m`} note={refined ? "精密メッシュ" : "高速メッシュ"}/>
            <Metric label="Rac / Rdc" value={`${sol.ratio.toFixed(5)} ×`}/>
            <Metric label={`片道 ${lengthM.toFixed(1)} m のループ抵抗`} value={ohm(sol.rAc * lengthM)}/>
            <Metric label="表皮効果だけの増加量" value={`${fmt(sol.skinOnlyR - sol.rDc)} Ω/m`}/>
            <Metric label="近接効果を含む増加量" value={`${fmt(sol.rAc - sol.rDc)} Ω/m`}/>
            <Metric label="近接効果による追加分" value={`${fmt(sol.proximityExtraR)} Ω/m`}/>
            <Metric label="総ジュール損失（1 A RMS）" value={`${fmt(sol.jouleLossWm)} W/m`}/>
          </div>
          <div className="loss-pair">
            <div><span>抵抗ゼロのケーブルに対する挿入損失</span><strong>{refined ? `${refined.absoluteLossDb.toFixed(5)} dB` : "精密解を計算中"}</strong><small>20 log₁₀ |RL / (RL + Rac′L)|</small></div>
            <div><span>{referenceHz === "dc" ? "DC近似" : `${Number(referenceHz) >= 1000 ? `${Number(referenceHz) / 1000} kHz` : `${referenceHz} Hz`}`} 基準の追加損失</span><strong>{refined ? `${refined.relativeLossDb.toFixed(5)} dB` : "精密解を計算中"}</strong><small>20 log₁₀ |H(f) / H(fref)|</small></div>
          </div>
          <div className="numerics"><span>表皮深さ δ <b>{(sol.skinDepthM * 1e3).toFixed(4)} mm</b></span><span>FEM節点 <b>{sol.mesh.points.length.toLocaleString()}</b></span><span>電流制約残差 <b>{sol.currentResidual.toExponential(2)}</b></span><span>線形解残差 <b>{sol.solverResidual.toExponential(2)}</b></span></div>
        </> : <div className="metrics-loading">計算中…</div>}
        {error && <p className="error">{error}</p>}
      </div>
    </section>

    <section className="graphs">
      <div className="section-title"><span>04</span><h2>周波数スイープ</h2></div>
      <div className="chart-grid three">
        <div><h3>周波数対 Rac/Rdc</h3><LineChart data={fData.map(p => ({ x: p.x, y: p.ratio }))} xLabel="周波数 [Hz]（対数）" yLabel="Rac/Rdc" currentX={frequencyHz}/></div>
        <div><h3>周波数対 Rac′</h3><LineChart data={fData.map(p => ({ x: p.x, y: p.rAc }))} xLabel="周波数 [Hz]（対数）" yLabel="Rac′ [Ω/m]" currentX={frequencyHz}/></div>
        <div><h3>基準周波数からの追加損失</h3><LineChart data={fData.map(p => ({ x: p.x, y: p.relativeLossDb }))} xLabel="周波数 [Hz]（対数）" yLabel="追加損失 [dB]" currentX={frequencyHz}/></div>
      </div>
      <div className="section-title gap-title"><span>05</span><h2>導体表面間隔スイープ</h2></div>
      <div className="chart-grid two">
        <div><h3>表面間隔 g 対 Rac/Rdc</h3><LineChart data={gData.map(p => ({ x: p.x, y: p.ratio }))} xLabel="表面間隔 g [mm]（対数）" yLabel="Rac/Rdc" currentX={gapMm}/></div>
        <div><h3>表面間隔 g 対追加損失</h3><LineChart data={gData.map(p => ({ x: p.x, y: p.relativeLossDb }))} xLabel="表面間隔 g [mm]（対数）" yLabel="追加損失 [dB]" currentX={gapMm}/></div>
      </div>
    </section>

    <section className="method">
      <div><h2>モデル</h2><p>未知量は A<sub>z</sub> と各導体の電流制約です。導体内 J<sub>z</sub> = σ(C<sub>k</sub> − jωA<sub>z</sub>)、空気中はラプラス方程式。g はメッシュ幾何だけに入り、導体中心間距離は常に D = 2a + g です。1/g 型の経験補正はありません。</p></div>
      <div><h2>損失積分</h2><p>両導体の ∫|J<sub>z</sub>|²/σ dS を三角形内3点積分し、1 A RMS の総損失から Rac′ を得ます。表皮効果だけの値は独立円形導体の Bessel 解析解です。</p></div>
    </section>
    <footer>
      <p>この伝送損失表示は、ケーブルの周波数依存抵抗のみを計算しています。ケーブルのインダクタンス、静電容量、スピーカーの複素インピーダンスは含みません。</p>
      <p>同じ向きの電流モードは実装していません。通常の2芯スピーカーケーブルに対応する逆向き往復電流のみを扱います。</p>
    </footer>
  </main>;
}
