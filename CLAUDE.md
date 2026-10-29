# 線工房 Web（senkobo-web）— iPad で動くベクター制作アプリ

exe 版 `../senkobo/`（PySide6、Illustrator 相当）のブラウザ版。主な使い道は iPad（Safari／ホーム画面に追加した PWA）、
Apple Pencil と指で、ロゴ・アイコン・イラスト・チラシを作る。exe にしか載せられない機能は省く。

## 方針
- **ビルドなし・外部ライブラリなし**。`index.html` ＋ `css/app.css` ＋ `js/*.js`（**普通の script。module にしない**）。
  各 js のトップレベル宣言はグローバルで共有される（読み込み順に注意: util → geom → model → render → snk → store → view → tools → panels → app）。
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
- Web でまだ描かない物（dict には残るので exe で開けば元通り）: パス上文字・文字のワープ（フェーズ2）、
  可変幅の線（profile、フェーズ5 で `window.variableOutline` を作れば render.js がそれを使う）、内側の光彩。
- 縦書きの半角は 1 字ずつ寝かせるだけ（exe のように単語で回さない）。字の形・幅は端末のフォント（ヒラギノ）。
- iPad の操作: Pencil を一度使うと指は画面の移動になる（表示メニューで戻せる）。2 本指タップ＝取り消し、3 本指＝やり直し、
  ダブルタップは自前で判定（view.js の lastTap）。文字は textarea を重ねて入力（日本語変換のため）、入力中は canvas 側を描かない（`_editing`）。

## 起動・確認
- 開発サーバー: launch.json の `senkobo-web`（`python senkobo-web/tools/devserver.py 8677`、no-store・tools/fixtures への PUT）。
- exe との往復: `python tools/snk_check.py prepare` → 開発サーバーの画面で
  `eval(await (await fetch('tools/roundtrip.js')).text())` → `python tools/snk_check.py check`
  （exe の .snk を Web で開いて保存し直し、exe で開いた中身と絵が元と同じかを見る。tools/fixtures/ は git に入れない）。
- アイコン: `python tools/make_icons.py`（exe の tools/make_icon.py と同じ絵）。
- ファイルを直したら sw.js の VERSION と js/util.js の APP_VERSION を両方上げる。
