# スピーカーケーブル 表皮・近接効果シミュレーター

無限長・平行な同径円形銅単線2本に `+1 A RMS / -1 A RMS` を流す2次元磁気準静的FEM Webアプリ。表皮効果と近接効果を複素電流密度として同時に解き、ジュール損失積分からループ交流抵抗と抵抗性伝送損失を求める。

## 実行

```bash
npm ci
npm run dev
```

数値自動テスト:

```bash
npm run test:numerics
```

本番ビルド:

```bash
npm run build
```

## GitHub Actions

`.github/workflows/ci.yml` を同梱している。`main` への push、Pull Request、手動実行で次を順に実行する。

1. Node.js 22 のセットアップと npm キャッシュ復元
2. `npm ci`
3. `npm run lint`
4. `npm run test:numerics`
5. `npm run build`
6. `dist/` を `speaker-cable-fem-dist` というGitHub Actions Artifactとして14日間保存

GitHub-hosted `ubuntu-latest` runner を前提としており、ビルド用のSecretは不要。現在の `npm run build` はVinext/Cloudflare Worker形式の成果物を生成するため、このWorkflowはCIビルド用であり、GitHub Pagesへの静的デプロイは行わない。

### GitHub Pagesへの公開

`.github/workflows/pages.yml` は `main` への push または手動実行で、Next.jsの静的出力をGitHub Pagesへデプロイする。Cloudflare Worker用の `npm run build` とは別経路である。

初回のみ、GitHubリポジトリの `Settings` → `Pages` → `Build and deployment` → `Source` で `GitHub Actions` を選択する。以後、`main` にpushすると自動公開される。

このリポジトリの公開URLは通常 `https://w-dee.github.io/speaker-cable-fem/` になる。公開元リポジトリを別名へ移す場合も、Actionsの `GITHUB_REPOSITORY` からサブパスを自動設定する。

## 物理モデル

時間依存 `exp(jωt)`、未知量は軸方向磁気ベクトルポテンシャル `Az`。導体 k 内は

```text
Jz = σ(Ck - jωAz)
∇²Az - jωμσAz = -μσCk
∫Ωk Jz dS = Ik,  IA=+I, IB=-I
```

空気では `∇²Az=0`。外周に `Az=0` を置き、計算領域を十分遠方まで拡張する。各導体の表面間隔 `g` はメッシュ幾何のみに入り、中心間距離は必ず `D=2a+g`。`1/g`, `1/g²` 型の補正式、最小値専用式、経験補正、画像面積からの有効断面積推定は使わない。

損失とループ抵抗は

```text
P' = Σk ∫Ωk |Jz|²/σ dS
Rac' = P'/|I|²
Rdc' = 2/(σπa²)
```

を用いる。Web FEMは線形P1三角形要素。導体内質量行列と電流制約を含む複素連立方程式を、BiCGSTABで解く。UI操作時は粗いメッシュを先に返し、停止後に外周20a・円周192分割の精密メッシュへ更新する。ジュール損失は各導体三角形内の3点積分で評価する。

表皮効果のみの比較値は、単独円形導体の標準内部インピーダンス

`Zint = k J0(ka)/(2πaσ J1(ka)), k=sqrt(-jωμσ)`

から得る。

## 伝送量

`Rac'` は往復2導体を含むため、片道長 `L` に対して `Rcable=Rac'L`。純抵抗負荷では

```text
H(f) = RL / (RL + Rcable(f))
Loss_absolute = 20 log10 |H(f)|
Loss_relative = 20 log10 |H(f)/H(fref)|
```

を別々に表示する。インダクタンス、静電容量、スピーカーの複素インピーダンスは v1 には含めない。

## 検証

詳細は `validation/VALIDATION.md`。主な確認結果:

- 0.1 Hzで `Rac/Rdc=1.000257`。
- 単独円形導体のBessel解析解との最大差 0.113%。
- g=1.0→0.01 mm、および0.005/0.002 mmまで連続・有限。`g→0+` で発散傾向なし。
- 狭ギャップの最終2メッシュ差 0.0622%。
- 外周20a→24a差 0.0974%。
- Web精密FEMと独立Python FEMの回帰差 0.2884%。
- 添付動画条件の独立計算は、1 kHz→10 kHzの追加損失 `-0.10964 dB`。動画の約 `-0.986 dB` を正解値として使用していない。

独立検証コード `validation/reference_fem.py` は Triangle による別メッシュと SciPy sparse direct solve を使い、ブラウザ実装の triangulation/iterative solver を共有しない。

## 仮定・既知の制限

- 2本の均質な円形銅単線、無限長、2次元断面、空気/真空、非接触のみ。
- 撚線、リッツ線、平角線、編組線、端部、コネクタ、酸化膜、接触抵抗は対象外。
- 同じ向きの電流モードは、戻り経路が定義できないため実装していない。
- UIの最小ギャップは0.01 mm。検証コードでは極限確認のため0.002 mmまで計算した。
- v1の伝送表示は周波数依存抵抗のみ。L/Cやスピーカーの複素インピーダンスを含まない。
- 温度補正は20℃導電率と銅の線形温度係数 `α=0.00393/℃` による。
- Webのグラフスイープは応答性のため高速メッシュ。現在点の主要数値とヒートマップは精密メッシュに更新される。

## 外部ライブラリ

| ライブラリ | ライセンス | 用途 | 数値計算上の役割 |
|---|---|---|---|
| React / ReactDOM 19.2.6 | MIT | UI | なし |
| cdt2d 1.0.0 | MIT | ブラウザ内2D制約Delaunay三角形分割 | FEMメッシュ生成のみ。電磁界式や抵抗補正式は提供しない |
| Vinext 0.0.50 / Vite 8.0.13 | MIT | Webビルド/Worker bundling | なし |
| tsx 4.23.9 | MIT | TypeScript数値テスト実行 | なし |
| NumPy / SciPy | BSD系 | 独立Python検証 | 配列計算、Bessel関数、sparse direct solve。Web本体では不使用 |
| triangle (Python wrapper) | LGPL-3系 | 独立Python検証メッシュ | Web本体では不使用 |

## ソース構成

- `lib/fem.ts` — 複素P1 FEM、BiCGSTAB、Bessel解析解、損失積分
- `workers/solver.worker.ts` — 非同期計算、精密解と周波数/ギャップスイープ
- `components/FieldCanvas.tsx` — 電流密度/損失密度ヒートマップ
- `components/LineChart.tsx` — 対数軸スイープグラフ
- `components/Simulator.tsx` — 入力、主要値、伝送量、注意書き
- `validation/web-solver.test.ts` — ブラウザ数値核の自動回帰試験
- `validation/reference_fem.py` — 独立Python FEM
- `validation/VALIDATION.md` — 検証表と添付動画条件比較
