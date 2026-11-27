import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium } from '@playwright/test'
import { createServer } from 'vite'

const cacheDir = await mkdtemp(join(tmpdir(), 'formant-storage-'))
const server = await createServer({
  configFile: false,
  cacheDir,
  server: { host: '127.0.0.1', port: 0 },
  logLevel: 'error',
  optimizeDeps: {
    noDiscovery: true,
    include: ['@zip.js/zip.js/index-native.js', '@noble/hashes/sha2.js', '@noble/hashes/utils.js'],
  },
})
let browser
try {
  await server.listen()
  browser = await chromium.launch({
    executablePath:
      process.env.CHROMIUM_PATH || (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined),
  })
  const page = await browser.newPage()
  const url = new URL('/__storage_test', server.resolvedUrls.local[0]).href
  await page.route(url, (route) =>
    route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Local persistence test</title>' }),
  )
  await page.goto(url)
  const result = await page.evaluate(async () => {
    const storage = await import('/src/storage.ts')
    const { createProject } = await import('/src/model.ts')
    const project = createProject('Local test')
    const file = new File(
      [
        '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><path d="M 0 0 L 100 100" stroke="green"/></svg>',
      ],
      'illustration.svg',
      { type: 'image/svg+xml' },
    )
    await storage.validateImage(file)
    const hash = await storage.makeAssetId(file)
    const assets = new Map([[hash, file]])
    project.background.imageId = hash
    await storage.saveAutosave(project, assets)
    const a = await storage.restoreAutosave()
    const bundle = await storage.saveProject(a.project, a.assets)
    const imported = await storage.loadProject(bundle)
    const checksum = await storage.makeAssetId(imported.assets.get(hash))
    const checks = [a.project.name === project.name, a.assets.get(hash).name === file.name, checksum === hash]
    project.background.imageId = null
    await storage.saveAutosave(project, assets)
    const b = await storage.restoreAutosave()
    checks.push(b.assets.size === 0)
    await storage.clearAutosave()
    checks.push((await storage.restoreAutosave()) === null)
    for (const content of [
      '<script/>',
      '<image href="https://example.invalid/logo.png"/>',
      '<rect width="1" fill="url(https://example.invalid/color)"/>',
      '<g onclick="ignored"/>',
    ]) {
      const svg = new File(
        ['<svg xmlns="http://www.w3.org/2000/svg">' + content + '</svg>'],
        'unsupported.svg',
        { type: 'image/svg+xml' },
      )
      let rejected = false
      try {
        await storage.validateImage(svg)
      } catch {
        rejected = true
      }
      checks.push(rejected)
    }
    return checks
  })
  assert(result.length === 9 && result.every(Boolean))
  // Inject a failed final write into a real transaction, after the new asset was queued.
  // This checks atomic rollback independently of browser quota reservations and soft limits.
  const rollback = await page.evaluate(async () => {
    const storage = await import('/src/storage.ts')
    const { createProject } = await import('/src/model.ts')
    const project = createProject('Last acknowledged save')
    await storage.saveAutosave(project, new Map())
    const file = new File(['later media'], 'new.wav')
    const id = await storage.makeAssetId(file)
    const put = IDBObjectStore.prototype.put
    IDBObjectStore.prototype.put = function (...args) {
      const request = put.apply(this, args)
      if (this.name === 'project') this.transaction.abort()
      return request
    }
    let rejected = false
    try {
      await storage.saveAutosave({ ...project, name: 'Uncommitted', mediaId: id }, new Map([[id, file]]))
    } catch {
      rejected = true
    } finally {
      IDBObjectStore.prototype.put = put
    }
    const saved = await storage.restoreAutosave()
    return [rejected, saved.project.name, saved.assets.size]
  })
  assert.deepEqual(rollback, [true, 'Last acknowledged save', 0])
  console.log(
    `Chromium ${browser.version()}: IndexedDB save, restore, pruning, deletion, ZIP round-trip with SVG, SVG validation and injected write failure with real IndexedDB rollback passed`,
  )
} finally {
  await browser?.close()
  await server.close()
  await rm(cacheDir, { recursive: true, force: true })
}
