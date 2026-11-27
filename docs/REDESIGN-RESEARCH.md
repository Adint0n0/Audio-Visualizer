# 改修前調査

添付の4画像は目視確認した。いずれの画像もアプリの素材に用いない。公開サイトの到達性と、実際に読めた資料を以下に記録する。

## 表現の分析

| 参考画像 | 構図・光・密度 | 音との関係をどう設計するか |
| --- | --- | --- |
| 粒子銀河 | 発光する核に視線を集め、その外に密度の異なる渦を重ねる。斜めの視点と遠方の弱い光が奥行きをつくる。 | 低域が渦の高さ、中域が腕のうねり、高域が局所の輝度を動かす。個々の粒子の位置はシード固定。 |
| 円形の複合シーン | 中央の静かな空洞、強い外周、淡い内周の順で視線が流れる。細かい波形と放射状の短い粒子を異なる深度で重ねる。 | 長さは周波数、内周は波形、アクセントはオンセットの減衰履歴で制御。全体を拡大するだけの反応を避ける。 |
| LED | 各点の間に暗い面を残し、色は列単位の帯として連続する。減衰する裾と中心の明部に段差がある。 | 連続量からセル毎の点灯率を求め、消灯セルもごく暗く残す。ミラー時も軸を読み取りやすくする。 |
| 発光する球体 | 線の密度、輪郭、裏面の減光で球体を読ませる。余白を残し、色温度の異なる光を交差させる。 | 低域は大きな起伏、高域は細かい変形に割り当てる。緩やかな地の動きを残して振幅だけを強調する。 |

projectM の README は MilkDrop プリセット、波形・FFT と GPU 描画を説明している。反応性を周波数形状と時間方向で評価する。描画時刻から再評価する設計を採用し、フレームバッファの蓄積順に依存するフィードバックを避ける。Three.js の公式 webaudio サンプルのソースでは Analyser からの周波数値をテクスチャとしてシェーダーへ渡す。既存の解析キャッシュを利用し、粒子変位をGPU側で評価する。 [projectM](https://github.com/projectM-visualizer/projectm) · [Three.js サンプルのソース](https://github.com/mrdoob/three.js/blob/dev/examples/webaudio_visualizer.html)

## 操作の分析

- Material Components の公式資料はモーダルと標準シート、collapsed・half-expanded・expanded 状態を例示する。編集にはプレビューを残した標準シートを使い、ライブラリとレイヤーも同じ領域に収める。横画面では横に展開する。 [公式 Bottom Sheet 資料](https://github.com/material-components/material-components-android/blob/master/docs/components/BottomSheet.md)
- WCAG 2.2 の公式原文は最小ターゲット24 CSS pxに例外を設けている。本改修は主要操作で44〜48 CSS pxを目安にし、ジェスチャーに加えてステッパー・数値編集を用意する。 [WCAG公式原文](https://github.com/w3c/wcag/blob/main/understanding/22/target-size-minimum.html)
- Pointer Events と MDN はタッチ開始位置とスクロール祖先の `touch-action`、pointercancel、lostpointercapture を説明する。割り当てはキャンバスだけに限定し、設定内ではブラウザの縦スクロールを使う。接触数が変わるたびに変換の基準を更新し、解放とキャンセルを区別する。 [Pointer Events仕様](https://github.com/w3c/pointerevents/blob/gh-pages/index.html) · [MDN原文](https://github.com/mdn/content/blob/main/files/en-us/web/css/reference/properties/touch-action/index.md)

旧コードはモバイルタブの切替でプレビュー自体を非表示にする。設定には `dock-scroll`、`ip-scroll`、レイヤー一覧のスクロール指定が重なり、画面の高さに引きずられる。旧キャンバスはタップ判定とPCギズモを主に使用する。改修ではプレビューを固定して表示し、各パネルに縦スクロールの所有者を一つ置く。物体とビューの操作を明示的なモードで切り替える。視点変更は書き出しカメラから独立させる。

## アクセス制限

次の直接参照は、環境プロキシにより CONNECT 403 が返った。閲覧済みとも、映像作品の比較を実施したとも扱わない。代替は添付4画像の比較、上記の公式リポジトリの原文、旧アプリと既存テンプレートの実レンダリング。Maps 型の操作はユーザー指定の挙動を上記 Pointer Events の仕様に基づいて設計する。配信先も同様の制限のため、公開条件はローカルの Pages ヘッダー付きサーバーで検証する。

- [Adobe](https://helpx.adobe.com/after-effects/using/generate-effects.html)
- [Maxon](https://www.maxon.net/en/red-giant/trapcode)
- [TD](https://docs.derivative.ca/Audio_Spectrum_CHOP)
- [Notch](https://manual.notch.one/)
- [Magic](https://magicmusicvisuals.com/)
- [Winamp](https://www.winamp.com/)
- [Avee](https://www.aveeplayer.com/)
- [Wallpaper](https://docs.wallpaperengine.io/en/web/audio/visualizer.html)
- [Shadertoy](https://www.shadertoy.com/)
- [Three](https://threejs.org/examples/#webaudio_visualizer)
- [Portfolio](https://www.behance.net/search/projects/audio%20visualizer)
- [Dribbble](https://dribbble.com/search/audio-visualizer)
- [Material](https://m3.material.io/components/bottom-sheets/guidelines)
- [Android](https://developer.android.com/guide/topics/ui/accessibility/apps)
- [Apple](https://developer.apple.com/design/human-interface-guidelines/gestures)
- [NNG](https://www.nngroup.com/articles/touch-target-size/)
- [WCAG](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html)
- [Maps](https://support.google.com/maps/answer/144339)
- [Pointer](https://developer.mozilla.org/en-US/docs/Web/API/Pointer_events)
- [Touch](https://developer.mozilla.org/en-US/docs/Web/CSS/touch-action)
- [Luma](https://luma-touch.com/lumafusion-for-ios-2/)
- [Nomad](https://nomadsculpt.com/manual/navigation)
- [Pages](https://audio-visualizer-5cf.pages.dev)
