// postbuild replaces the two literals with build-specific values.
const manifest = 'PRECACHE_MANIFEST'
const cacheName = 'CACHE_VERSION'
const critical = Object.keys(manifest).filter(path => /\.(?:js|css|wasm)$/.test(path))

async function matchesBuild(response, expected) {
  if (!response?.ok) return false
  const digest = await crypto.subtle.digest('SHA-256', await response.clone().arrayBuffer())
  return Array.from(new Uint8Array(digest), n => n.toString(16).padStart(2, '0')).join('') === expected
}
async function download(cache, path, installing = false) {
  const response = await fetch(path, {cache:'reload', redirect:'error'})
  if (!await matchesBuild(response, manifest[path])) throw new Error('Offline integrity check failed: ' + path)
  if (cache) {
    const write = cache.put(path, response.clone())
    if (installing) await write
    else await write.catch(() => {}) // A full cache can still serve verified online bytes.
  }
  return response
}
async function load(cache, path) {
  const response = await cache?.match(path).catch(() => null)
  if (await matchesBuild(response, manifest[path])) return response
  return download(cache, path)
}

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(cacheName)
    try {
      for (const url of Object.keys(manifest)) await download(cache, url, true)
    } catch (error) {
      await caches.delete(cacheName)
      throw error
    }
  })())
})

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (key.startsWith('av-studio-shell-') && key !== cacheName) await caches.delete(key)
    }
    await self.clients.claim()
  })())
})

function recovery() {
  return new Response(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Formant · Offline recovery</title><style>body{margin:8vh auto;padding:24px;max-width:40em;background:#171919;color:#eee;font:1.1rem/1.6 system-ui}h1{color:#92edc8}</style>
<h1>Formant Studio</h1><p>Part of the offline application is missing or out of date. Reconnect, close all Formant tabs and open the studio again. Your local project is kept in browser storage.</p>
<p lang="ja">オフライン用のアプリに不足または破損があります。オンラインに戻り、Formant のタブをすべて閉じてから再度開いてください。プロジェクトはブラウザの保存領域に保持されています。</p></html>`,
    {status:503,headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'"}})
}

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url)
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return
  const path = url.pathname === '/index.html' ? '/' : url.pathname
  if (!Object.hasOwn(manifest, path)) return
  event.respondWith((async () => {
    const cache = await caches.open(cacheName).catch(() => null)
    try {
      if (event.request.mode === 'navigate' && path === '/') {
        // Detect an evicted bundle before returning HTML that cannot bootstrap offline.
        for (const asset of critical) await load(cache, asset)
      }
      return await load(cache, path)
    } catch {
      if (event.request.mode === 'navigate') return recovery()
      return new Response('Formant offline asset unavailable', {status:503,headers:{'Cache-Control':'no-store'}})
    }
  })())
})
