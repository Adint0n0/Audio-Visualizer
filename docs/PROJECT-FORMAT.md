# Formant project files and offline hosting

## Portable files

A settings-only JSON document contains a version 2 Project. Version 1 scenes migrate to version 2 with the full source range and default output settings. Its media, background, textures, images and custom font references are SHA-256 identifiers (64 lowercase hexadecimal characters). Re-linking accepts identical bytes, even when the file name changes. Scene and object presets contain settings. Importing an object preset creates a new layer ID and removes its previous parent reference.

A complete `.avproj` is a standard single-disk ZIP32 archive. `manifest.json` contains the format string `avproj`, integer version `1`, the full Project and an array of `{id,name,size,type}` records. Every referenced file appears exactly once under `assets/<sha256>`. Original display names and media types live in the manifest. The writer stores media without additional compression. The reader checks ZIP CRC32, actual expanded byte counts, SHA-256, the exact expected path set, filename validity and project schema before returning the project. It accepts stored and native-browser-supported deflated ZIP entries. Unrecognized versions fail explicitly. ZIP manifests and object-preset envelopes use version 1 independently of the scene schema.

Complete projects allow 128 assets, 768 MiB per file and 1 GiB per archive, with room reserved for ZIP metadata. JSON settings allow 4 MiB. Hashing and ZIP entry processing use bounded chunks. The ZIP Blob, local media, GPU textures and rendering resources still count against the device's storage and memory budgets. Oversized images are rejected before raster decoding (64 MiB, 32 megapixels, 16,384 pixels per axis). WOFF/WOFF2 and TTF/OTF fonts are bounded to 32 MiB of input; compressed WOFF headers must declare at most 64 MiB of expanded SFNT. Local SVG artwork supports simple shapes, paths, groups, gradients and clip paths up to 1 MiB. Script, animation, style sheets and external references are unsupported.

Autosave uses one IndexedDB transaction for the latest settings and referenced files. Edits reuse stored immutable files with matching content hashes. The next snapshot releases assets it no longer references. Browser storage is origin-specific. Download a complete project to move between a Pages preview URL and production, devices or browser profiles. Clearing the local autosave removes the saved snapshot and its local assets.

## Cloudflare Pages

Use the repository root, `npm ci` for reproducible installation, `npm run build` for the build command, and `dist` for the output directory. Use a supported Node 22.12+ or Node 24 environment. Deploy at the domain root. Pages Git integration handles builds from GitHub. The application requires static files and HTTPS. The build rejects any single file larger than 25 MiB and outputs above 20,000 files, including the generated worker, for the Pages Free plan. User media stay on the device and do not consume Pages static file quota.

`public/_headers` configures same-origin isolation (COOP/COEP/CORP), resource type checking, referrer policy, framing restrictions, and CSP. Local blob URLs support media, workers and imported images. The hashed Vite bundle directory uses immutable caching. HTML, the manifest and the service worker revalidate. Preserve the supplied headers and asset bytes when enabling Pages options. A proxy or automatic HTML/script transformation changes the expected integrity digest.

Open Guide to check installation progress. “Ready for offline use” appears after the worker finishes validating and installing the full build. The guide also reports failed installations and pending updates. After the first complete online visit, a service worker caches the precise build of the HTML, scripts, style sheets, local fonts, shared media, thumbnails, icons and other public files. It checks every SHA-256 digest before installing. Each build has a distinct cache. Interrupted installation leaves the previous shell active. Updates activate after older tabs close. The app requires sufficient browser cache space for installation and IndexedDB space for projects.

Run `npm run build` and `node scripts/check-offline.mjs` to test the production shell with its headers. The check uses installed Chromium (or a Playwright browser, or the executable named in CHROMIUM_PATH). It establishes service-worker control, disconnects the origin in the browser context, reloads the editor, fetches the local demo offline and checks CSP and cross-origin isolation. It exports a real 3D scene in WebM and MP4 offline, then uses FFmpeg and ffprobe to check the decoded pixels, audio track, dimensions and duration. An additional browser test, `node scripts/check-storage-browser.mjs`, covers IndexedDB save, restore, pruning, deletion and SVG project round-tripping. To run a local Pages-style static server manually use `node scripts/serve-pages.mjs`.

## 日本語

上部のプロジェクト名から「素材を含めて保存」を選ぶと、音声・動画、画像、使用中のフォントとシーン設定を含む ZIP 形式の `.avproj` をダウンロードできます。別のブラウザや端末では「プロジェクト・シーン設定を開く」から読み込みます。「シーン設定を保存」は JSON のみを保存します。設定だけを開いた後は「不足素材を再リンク」で元のファイルを選択してください。ファイル名が変わっていても、内容の SHA-256 が一致すれば再リンクできます。

自動保存先はブラウザの IndexedDB です。使用量の確認と削除はプロジェクトメニューから行えます。異なるドメインやブラウザプロファイルとの受け渡しには完全プロジェクトを使用します。プロジェクト ZIP の上限は 1 GiB、素材 1 ファイルにつき 768 MiB、最大 128 素材です。SVG は自己完結した静止ベクター画像に対応します。

Cloudflare Pages ではリポジトリのルートを指定し、ビルドコマンドを `npm run build`、出力先を `dist` に設定します。「ガイド」で準備状態を確認できます。「オフラインで利用できます」と表示されるまでタブを開いたままにしてください。初回オンライン起動でビルドの静的ファイル一式を取得し、検証後にオフラインで開けるようになります。更新の切り替えには古いタブをすべて閉じてから開き直してください。

## Cache integrity and update checks

Each navigation verifies that its build's JavaScript, CSS and WebAssembly can be read intact. Requests for cached assets are checked against the build's digest before use. An available origin repairs missing or corrupt bytes only when the replacement matches that build. If a boot dependency cannot be recovered offline, a bilingual recovery page asks the user to reconnect, close the studio tabs and reopen. This path leaves the project database intact.

`node scripts/check-offline-update.mjs` exercises two successive builds using the production worker generator and delivery headers. Chromium 156 on Linux rejected a mixed-byte deployment and preserved the previous cache. With a valid update, two open tabs continued running the old build until both closed. The next tab activated the new build and retired the old cache. The same run repaired a corrupted local script, returned the recovery page after eviction while offline, and resumed normally on reconnection. A 25 MiB + 1 byte artifact failed the deployment size gate. This local lifecycle exercise does not test an actual Pages rollout, storage eviction policy on a mobile OS, or a physical device.

The browser storage suite also injects an abort after the final IndexedDB write is queued. Chromium discarded the new asset and retained the last acknowledged project. The test exercises a real database transaction with a simulated failure. A separate 1 MiB DevTools quota override did not reliably force Chromium's IndexedDB Blob writes to fail, so this evidence is not a physical disk-full test.
