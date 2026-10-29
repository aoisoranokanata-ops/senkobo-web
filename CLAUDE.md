# 線工房 Web（senkobo-web）— iPad で動くベクター制作アプリ

exe 版 `../senkobo/`（PySide6、Illustrator 相当）のブラウザ版。主な使い道は iPad（Safari／ホーム画面に追加した PWA）、
Apple Pencil と指で、ロゴ・アイコン・イラスト・チラシを作る。exe にしか載せられない機能は省く。

## 方針
- **ビルドなし・外部ライブラリなし**。`index.html` ＋ `css/app.css` ＋ `js/*.js`（**普通の script。module にしない**）。
  各 js のトップレベル宣言はグローバルで共有される（読み込み順に注意: util → geom → model → text → render → boolean → outline → beyond → trace → snk → pdf → store → view → tools → panels → panels2 → app → shapeops → guides → print → beyondui）。
- 公開は GitHub Pages（`aoisoranokanata-ops/senkobo-web`、ブランチ main）。iPad はローカル HTML を開けないため。
- データは IndexedDB `senkobo-web`（作品ギャラリー）。localStorage のキーは `senkobo-web.` 始まり。
  Pages は他の PWA と同じオリジンなので、sw.js は**自分の接頭辞 `senkobo-web-` のキャッシュだけ**消す・参照する（install は cache:'reload'、skipWaiting）。
- **文書は exe の .snk の document.json と同じ形のまま**メモリに持つ（item は JSON の dict そのもの）。
  Web で扱えない属性（効果の細かい値・文字の書式の範囲など）も dict に残るので、保存すれば exe でそのまま開ける。
  違うのは錨点だけ: メモリでは {x, y, ix, iy, ox, oy, s}、保存時に exe と同じ配列 [x, y] / [x, y, ix, iy, ox, oy, s] に戻す。
- 座標は pt、左上原点・y 下向き（exe と同じ）。行列は [a, b, c, d, e, f]（x' = a x + c y + e）。
- 取り消しは文書全体のスナップショット（JSON 文字列）。画像のバイト列は doc.images に別に持つ（exe と同じ）。

## exe 版から省くもの（予定）
Claude 連携（MCP・アプリ内 Claude）、彩工房との直接の受け渡し（.png の書き出しと読み込みで代わりに）、
フォントのアウトライン化（ブラウザから字形を取れない。字は端末のフォントで表示）、リンク画像（すべて埋め込み）、
ICC・特色の分版（PDF の特色は名前だけ）。

## フェーズ
1. **基盤**: 作品ギャラリー（IndexedDB・自動保存）・画面（Pencil と指・ピンチで拡大縮小・2 本指タップで取り消し）・
   道具（選択＋拡大縮小/回転・ダイレクト選択・ペン・鉛筆・長方形・角丸・楕円・多角形・スター・直線・文字・スポイト・手のひら）・
   塗りと線（色・線幅・端・角・破線）・不透明度・描画モード・レイヤー・グループ・重ね順・複製・削除・取り消し・
   .snk の読み書き（exe と往復）・SVG/PNG 書き出し（共有シート）・画像の配置・PWA
2. **文字と見た目**: エリア内文字・縦書き・文字パネル・グラデーション（パネルとツール）・効果（影・光彩・ぼかし）・
   袋文字・整列・変形の数値・アートボード
3. **形の計算**: パスファインダー・パスのオフセット・線のアウトライン・シェイプ形成・複合パス・クリッピング（自前の多角形演算＋曲線の当てはめ）
4. **印刷**: 定規・ガイド・グリッド・スナップ・PDF 書き出し（自前、CMYK・トンボ・裁ち落とし）・テンプレート
5. **超える機能**: 対称描画・可変幅の線と線幅ツール・角丸・再配色・バリエーション・アイコン一括書き出し・画像トレース
6. **仕上げ**: exe との .snk 往復の突き合わせ・速さ・iPad 実機の操作感・README → v1.0.0

## 進み具合
- **フェーズ1 完了（v0.1.0、2026-10-29）**。exe の見本 4 つ＋画像入り 1 つで .snk の往復は中身の差 0（`snk_check.py`）。
- **フェーズ2 完了（v0.2.0、2026-10-29）**: text.js（exe の _do_layout と同じ手順で字を 1 つずつ置く: 書式の範囲 runs・ルビ・
  縦中横・均等配置・禁則とぶら下げ・エリアは形の中で折り返す・パス上文字・ワープは字の中心で一次近似）、
  文字パネル（編集中に入力欄で範囲を選ぶと runs に）・グラデーション（パネルと G ツール）・縁取り（style.extra）・
  効果（影・外側/内側の光彩・ぼかし）・変形の数値（基準点・回転・反転）・アートボード（タブと Shift+O ツール）・SVG に効果のフィルター。
  Web で作った .snk を exe で開いて保存し直しても差 0（`webdoc_check.py`）、絵もほぼ同じ。
- **フェーズ3 完了（v0.3.0、2026-10-29）**: boolean.js（自前の形の計算）。形を折れ線にして（元の区間と t を覚える）→ 交わりで切った
  平面のグラフ → 面ごとに内外を調べる → 残す面の境目をつなぐ → 元の曲線から来た所は元の曲線の一部としてそのまま戻す（合体した円は 8 点）。
  線を太らせる（線のアウトライン）・オフセットは区間の四角＋角の形＋端の形を全部合わせ、新しくできた境目だけ曲線を当てはめる（長い直線は直線のまま）。
  shapeops.js: パスファインダー 6 種（exe と同じ: 合体・前面型抜き・交差・中マド・背面型抜き・分割、色の取り方も同じ）・パスのオフセット・
  線のアウトライン・連結・複合パスの解除・パスの反転・シェイプ形成ツール（Shift+M、なぞって合体／消すモード）。
  exe（skia-pathops）との突き合わせ: `tools/boolcases.js` を画面で eval → `python tools/boolean_check.py`。9 組×9 操作で面積が 0.6% 以内
  （円の面積は Web の方が理論値に近い）。1 点で接する所は pathops が 8 の字の 1 輪、Web は 2 輪に分ける（数は違ってよい）。
- **フェーズ4 完了（v0.4.0、2026-10-29）**:
  outline.js（文字のアウトライン: 字を 1em=400px で描いて濃さ 50% の等高線をなぞり、角で切って曲線を当てはめる。字ごとに覚える）。
  これで形の計算・PDF に文字が使える（［アウトラインを作成］も）。字の形は端末のフォント（exe とは少し違うことがある）。
  pdf.js（自前の PDF 書き出し: 書類の色のまま・特色は Separation・トンボはレジストレーション /All・Trim/BleedBox・
  グラデーションはシェーディング・文字はアウトライン・効果は 300ppi の画像・K100 のオーバープリント・RGB 画像を CMYK に）。
  guides.js（定規・ガイド・グリッド: exe と同じ doc.data.guides / grid / meta.guides_locked、定規から引く・定規へ戻すと消える、
  グリッドにスナップ・ガイドにスナップ・マージンにガイド・トンボを作成）。print.js（PDF の設定・テンプレート: IndexedDB の作品に template:true）。
  確認: 画面で web_*.pdf を作る（手順は tools/pdf_check.py の先頭）→ `python tools/pdf_check.py`（exe の PDF と描き比べ。sym 以外は差 1.5 以下、
  sym は可変幅の線がまだ）。Acrobat 9 でも開けてエラーなし（2026-10-29）。
- **フェーズ5 完了（v0.5.0、2026-10-29）**: beyond.js（exe の beyond.py・palette.py と同じ計算: 可変幅の線 variableOutline・
  線幅の点・角丸 roundNodes・色を集める／塗り替える・バリエーション・アイコンの計画・.ico（PNG 入り）・配色の提案）、
  trace.js（画像トレース: exe と同じプリセット・k-means は Lab・輪郭は traceField＋角で切って当てはめ）、beyondui.js（対称描画の開始／終了／再開／確定・
  線幅ツール Shift+W・角を丸くする・再配色（キャンバスで見ながら）・バリエーション・アイコン一括書き出し（zip）・画像トレース・配色の提案）。
  メニューは上の「超える」。図形（長方形・多角形・スター）は選択の欄に「角の丸み」。可変幅の線は PDF・SVG・線のアウトラインでも輪郭の形。
  見本_対称と線幅も exe との絵の差 14.8 → 0.5。Web で作った対称・線幅の作品も exe で開いて保存し直しの差 0。
- **フェーズ6 完了 → v1.0.0（2026-10-29）**。以降は使いながら改修。
  速さ: GEO_EPOCH（Doc.touch で増える）が同じ間は Path2D（itemPath2D）・外枠・選択の輪郭・文字の組み・可変幅の輪郭・吸着の升目（View.snapIndex）を覚える。
  選択ツールで動かしている間は物をさわらず renderer.preview（見た目だけの変形）、離したときに 1 回だけ itemTransform。
  47,000 点の作品で 描く 10→1.2ms・全部選んで 35→2.3ms・ドラッグ 50→2.8ms・吸着 14→0ms。取り消しは合わせて 8000 万字まで。
  iPad: 長押しの選択・吹き出しを止める・パネルに×・navigator.storage.persist()・［使い方とショートカット］。
- **突き合わせを一度に**: `python tools/snk_check.py prepare` → 画面で `eval(await (await fetch('tools/selftest.js')).text())` →
  `python tools/check_all.py`（.snk の往復・形の計算・PDF・Web で作った全部入りの作品を exe で開く。2026-10-29 すべて OK）。
- Web で使えない物（dict には残るので exe で開けば元通り）: フォントの OpenType 機能（features・palt）（canvas の制約）。
- 文字の組み: 字は 100px のフォントで描き、大きさ・位置は字の行列 g.m に入れる。runs の番号は exe と同じコードポイント（cpIndex/u16Index）。
  縦書きの約物はフォントの vert の代わりに、句読点を右上へずらす・括弧と長音を 90° 寝かせる（V_SHIFT / V_ROTATE）。
- 効果: iPad の Safari は ctx.filter が効かない。影・外側の光彩は shadow（速い）、ぼかし・内側の光彩は別 canvas に描いて
  自前のボックスぼかし（render.js の blurImageData）。σ は exe と同じ blur / 2。
- iPad の操作: Pencil を一度使うと指は画面の移動になる（表示メニューで戻せる）。2 本指タップ＝取り消し、3 本指＝やり直し、
  ダブルタップは自前で判定（view.js の lastTap）。文字は上の入力欄（#textdock）で打ち、キャンバスにはそのまま組んで出す
  （選んだ範囲を色で、カーソルを線で。日本語の変換のため textarea）。
- exe の見本_文字.snk はルビの範囲が色の範囲で 2 つに割れていて、exe ではルビが 2 回描かれる（Web は隣り合う同じルビをまとめて描く）。

## 起動・確認
- 開発サーバー: launch.json の `senkobo-web`（`python senkobo-web/tools/devserver.py 8677`、no-store・tools/fixtures への PUT）。
- exe との往復: `python tools/snk_check.py prepare` → 開発サーバーの画面で
  `eval(await (await fetch('tools/roundtrip.js')).text())` → `python tools/snk_check.py check`
  （exe の .snk を Web で開いて保存し直し、exe で開いた中身と絵が元と同じかを見る。tools/fixtures/ は git に入れない）。
- Web で作った作品を exe で: 画面で webdoc_名前.snk / .png を PUT（手順は tools/webdoc_check.py の先頭）→ `python tools/webdoc_check.py`。
- 並べて見る: `python tools/snk_check.py compare` → tools/fixtures/cmp_*.png（左 exe・右 Web）。
- アイコン: `python tools/make_icons.py`（exe の tools/make_icon.py と同じ絵）。
- ファイルを直したら sw.js の VERSION と js/util.js の APP_VERSION を両方上げる。
