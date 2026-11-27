import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { chromium } from '@playwright/test'
import { servePages } from './serve-pages.mjs'
import { bindTrace, dispatch, geometry, glide, point, readProject, swipe, wait } from './touch/events.mjs'
import { gestures } from './touch/gestures.mjs'
import { captureMatrix, startPage } from './touch/layouts.mjs'

const baseline = process.argv.includes('--baseline')
const artifacts = process.env.FORMANT_TOUCH_ARTIFACTS ?? (await mkdtemp(join(tmpdir(), 'formant-touch-')))
const server = await servePages(0, process.env.FORMANT_TEST_DIST ?? 'dist')
const url = 'http://127.0.0.1:' + server.address().port
const browser = await chromium.launch({
  executablePath:
    process.env.CHROMIUM_PATH || (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined),
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage'],
})
try {
  await mkdir(artifacts, { recursive: true })
  const { context, page } = await startPage(browser, url, 360, 640)
  const cdp = await context.newCDPSession(page)
  await bindTrace(page)
  if (baseline) {
    const report = { browser: browser.version(), stage: await geometry(page) }
    await page.locator('.mobile-tabs button').last().tap()
    await page.getByRole('button', { name: 'Advanced', exact: true }).tap()
    await wait(180)
    report.inspector = await geometry(page)
    await swipe(cdp, point(340, 400), point(340, 190))
    report.afterSwipe = await geometry(page)
    report.scrolls = await page.evaluate(() => window.touchReview.scrolls.slice(-6))
    await page.screenshot({ path: join(artifacts, 'inspector-after-swipe.jpg'), type: 'jpeg', quality: 88 })
    await page.locator('.mobile-tabs button').nth(1).tap()
    await wait(750)
    const before = await readProject(page)
    const rect = await page.locator('.stage-frame canvas').boundingBox()
    const a = point(rect.x + rect.width * 0.45, rect.y + rect.height * 0.5, 1),
      b = point(a.x + 25, a.y, 2)
    await dispatch(cdp, 'touchStart', a)
    await dispatch(cdp, 'touchStart', a, b)
    await glide(cdp, [a, b], [point(a.x - 12, a.y + 3), point(b.x + 25, b.y - 7, 2)])
    await dispatch(cdp, 'touchEnd')
    await wait(800)
    report.sameAfterPinch = JSON.stringify(before) === JSON.stringify(await readProject(page))
    report.pinchEvents = await page.evaluate(() =>
      window.touchReview.events.filter((e) => e.target === 'CANVAS' && e.type !== 'pointermove'),
    )
    await writeFile(join(artifacts, 'interaction.json'), JSON.stringify(report, null, 2) + '\n')
    console.log('Baseline:', JSON.stringify(report))
  } else if (!process.argv.includes('--matrix-only')) {
    try {
      await gestures(page, cdp, artifacts)
    } catch (e) {
      await page.screenshot({ path: join(artifacts, 'failure.jpg'), type: 'jpeg' })
      console.error(
        'State during failure',
        JSON.stringify(await geometry(page)),
        await page.locator('[role=alert]').allTextContents(),
      )
      throw e
    }
  }
  await context.close()
  if (!process.argv.includes('--no-matrix')) {
    const matrix = await captureMatrix(browser, url, artifacts, baseline)
    if (!baseline)
      for (const r of matrix) {
        assert(r.pageWidth <= r.viewport[0], r.name + ' horizontal overflow')
        assert(r.canvas?.[2] > 0 && r.canvas[3] > 0, r.name + ' lost preview')
        assert(
          r.canvas[0] >= -1 && r.canvas[0] + r.canvas[2] <= r.viewport[0] + 1,
          r.name + ' preview clipped horizontally',
        )
        if (r.name !== '1440x900')
          assert.deepEqual(r.smallPrimary, [], r.name + ' has undersized primary touch buttons')
      }
  }
  console.log('Touch artifacts:', artifacts)
} finally {
  await browser.close()
  server.closeAllConnections()
  await new Promise((r) => server.close(r))
}
