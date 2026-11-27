import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { chromium } from '@playwright/test'
import { servePages } from './serve-pages.mjs'

// Exercise the same static bundle and HTTP headers that the deployment serves.
const server = await servePages(0, process.env.FORMANT_TEST_DIST ?? 'dist')
let browser
try {
  browser = await chromium.launch({
    executablePath:
      process.env.CHROMIUM_PATH || (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined),
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage'],
  })
  const url = 'http://127.0.0.1:' + server.address().port
  const page = await browser.newPage({
    viewport: { width: 1400, height: 920 },
    locale: 'en-US',
  })
  page.setDefaultTimeout(20000)
  const faults = []
  page.on('pageerror', (e) => faults.push(e.message))
  await page.goto(url)
  await page.getByRole('button', { name: 'Layers', exact: true }).click()
  await page.getByRole('button', { name: 'Add layer', exact: true }).click()
  await page.getByRole('button', { name: 'Visualizer', exact: true }).click()
  const panel = page.locator('.ip-panel')
  const counter = page.locator('.ly-list .ly-row')
  const total = await counter.count()
  const density = panel.getByRole('spinbutton', {
    name: 'Elements',
    exact: true,
  })
  const original = await density.inputValue()
  await density.fill('126')
  await density.press('Enter')
  assert.equal(await density.inputValue(), '126')
  await page.getByTitle('Undo', { exact: true }).click()
  assert.equal(await density.inputValue(), original)
  await page.getByTitle('Redo', { exact: true }).click()
  assert.equal(await density.inputValue(), '126')
  const slider = panel.getByRole('slider', { name: 'Elements', exact: true })
  const rect = await slider.boundingBox()
  assert(rect)
  await page.mouse.move(rect.x + 8, rect.y + rect.height / 2)
  await page.mouse.down()
  await page.mouse.move(rect.x + rect.width * 0.4, rect.y + rect.height / 2, {
    steps: 6,
  })
  await page.mouse.up()
  assert.notEqual(await density.inputValue(), '126')
  await page.getByTitle('Undo', { exact: true }).click()
  assert.equal(await density.inputValue(), '126', 'One undo restores the entire range drag')
  await page.getByRole('button', { name: 'Layer tools', exact: true }).click()
  await page.getByRole('button', { name: 'Duplicate', exact: true }).click()
  assert.equal(await counter.count(), total + 1)
  await page.getByRole('button', { name: 'Delete', exact: true }).click()
  assert.equal(await counter.count(), total)
  await page.locator('.ly-select').first().click()
  await panel.getByLabel('Layout', { exact: true }).selectOption('path')
  await panel.getByRole('button', { name: 'Edit as polyline' }).click()
  await panel.getByRole('button', { name: 'Insert point' }).click()
  await panel.getByRole('button', { name: 'Apply path' }).click()
  assert.match(await panel.getByLabel('Path data (SVG d)').inputValue(), /^M[\d.]+ [\d.]+ L/)
  await page.getByRole('button', { name: 'Advanced', exact: true }).click()
  await panel
    .locator('summary')
    .filter({ hasText: /^Audio mappings/ })
    .click()
  await panel.getByRole('button', { name: 'Add audio mapping' }).click()
  await panel.getByLabel('Signal', { exact: true }).selectOption('band')
  await panel.getByLabel('Low cutoff').fill('32')
  await panel.getByLabel('Low cutoff').press('Enter')
  assert.equal(await panel.getByLabel('Low cutoff').inputValue(), '32')
  await panel.getByLabel('Style', { exact: true }).selectOption('prism')
  assert.equal(await panel.getByLabel('Layout', { exact: true }).count(), 0)
  await panel.getByLabel('Color mapping', { exact: true }).selectOption('position')
  await panel.getByRole('button', { name: 'Add color stop' }).click()
  assert.equal(await panel.getByLabel('Stop 3', { exact: true }).count(), 1)
  await panel.getByLabel('Stop 3', { exact: true }).fill('#993e50')
  const bloom = panel.getByRole('spinbutton', {
    name: 'Layer bloom',
    exact: true,
  })
  await bloom.fill('0.26')
  await bloom.press('Enter')
  assert.equal(await bloom.inputValue(), '0.26')
  await panel.locator('summary').filter({ hasText: 'Layer settings' }).click()
  const downloadPromise = page.waitForEvent('download')
  await panel.getByRole('button', { name: 'Save layer preset' }).click()
  const saved = await downloadPromise
  const preset = await saved.path()
  assert(preset)
  await panel.getByLabel('Style', { exact: true }).selectOption('waveform')
  await panel.getByLabel('Load layer preset', { exact: true }).setInputFiles(preset)
  await page.waitForFunction(() => document.querySelector('select[aria-label="Style"]').value === 'prism')
  assert.equal(await panel.getByLabel('Stop 3', { exact: true }).inputValue(), '#993e50')
  assert.equal(await bloom.inputValue(), '0.26')
  const styles = panel.getByLabel('Style', { exact: true })
  const options = await styles.locator('option').evaluateAll((opts) => opts.map((o) => o.value))
  for (const style of options) {
    await styles.selectOption(style)
    assert.equal(await panel.getByLabel('Layout', { exact: true }).count(), Number(style === 'spectrum'))
    assert.equal(
      await panel.getByLabel('Shape', { exact: true }).count(),
      Number(style === 'spectrum' || style === 'particles'),
    )
  }
  await panel.getByRole('button', { name: 'Scene', exact: true }).click()
  await panel.locator('summary').filter({ hasText: 'Output camera' }).click()
  await panel.getByLabel('Projection').selectOption('orthographic')
  assert.equal(await panel.getByLabel('Ortho size').isVisible(), true)
  await page.getByTitle('日本語に切り替え').click()
  assert.equal(await panel.getByLabel('投影法').inputValue(), 'orthographic')
  assert.equal(await page.evaluate(() => document.documentElement.lang), 'ja')
  assert.deepEqual(faults, [])
  await page.close()
  const touch = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
    locale: 'ja-JP',
  })
  const phone = await touch.newPage()
  await phone.goto(url)
  await phone.locator('button[data-sheet="inspector"]').tap()
  const mobilePanel = phone.locator('.ip-panel')
  const category = mobilePanel.getByRole('combobox', { name: '設定カテゴリー' })
  await phone.getByRole('button', { name: '詳細', exact: true }).tap()
  await category.selectOption('appearance')
  const opacity = mobilePanel.getByRole('spinbutton', { name: '不透明度', exact: true })
  const down = mobilePanel.getByRole('button', { name: /不透明度.*減らす/ })
  const before = Number(await opacity.inputValue())
  await down.tap()
  assert.equal(Number(await opacity.inputValue()), Number((before - 0.01).toFixed(2)))
  const controlBox = await down.boundingBox()
  assert(controlBox && controlBox.width >= 44 && controlBox.height >= 44)
  const control = mobilePanel.getByRole('slider', { name: '不透明度', exact: true })
  const area = control.locator('..')
  const scroll = phone.locator('.right-dock .dock-scroll')
  await area.evaluate((el) => el.scrollIntoView({ block: 'center' }))
  let hit = await area.boundingBox()
  assert(hit && hit.height >= 44)
  const touchSource = await touch.newCDPSession(phone)
  const gesture = async (x, y, dx, dy, cancel = false) => {
    const event = (type, touchPoints) => touchSource.send('Input.dispatchTouchEvent', { type, touchPoints })
    await event('touchStart', [{ x, y }])
    for (let i = 1; i <= 7; i++) await event('touchMove', [{ x: x + (dx * i) / 7, y: y + (dy * i) / 7 }])
    await event(cancel ? 'touchCancel' : 'touchEnd', [])
  }
  const scrolled = await scroll.evaluate((el) => el.scrollTop)
  const originalOpacity = await opacity.inputValue()
  await gesture(hit.x + hit.width * 0.5, hit.y + hit.height / 2, 2, -90)
  await phone.waitForFunction(
    (previous) => document.querySelector('.right-dock .dock-scroll').scrollTop > previous + 12,
    scrolled,
  )
  assert.equal(await opacity.inputValue(), originalOpacity, 'Vertical swipe edits no value')
  await area.evaluate((el) => el.scrollIntoView({ block: 'center' }))
  hit = await area.boundingBox()
  await gesture(hit.x + hit.width * 0.25, hit.y + hit.height / 2, hit.width * 0.48, 0)
  const finalOpacity = Number(await opacity.inputValue())
  assert(finalOpacity > 0.65 && finalOpacity < 0.85)
  await gesture(hit.x + hit.width * 0.25, hit.y + hit.height / 2, hit.width * 0.2, 0, true)
  assert.equal(Number(await opacity.inputValue()), finalOpacity, 'Cancel must discard the touch preview')
  await category.selectOption('transform')
  assert.equal(await mobilePanel.getByRole('slider', { name: '不透明度', exact: true }).count(), 0)
  assert.equal(
    await mobilePanel.getByRole('spinbutton', { name: 'X', exact: true }).first().isVisible(),
    true,
  )
  await mobilePanel.getByRole('button', { name: 'シーン', exact: true }).tap()
  const width = await phone.evaluate(() => ({
    doc: document.documentElement.scrollWidth,
    viewport: innerWidth,
  }))
  assert(width.doc <= width.viewport, `Unexpected horizontal overflow: ${JSON.stringify(width)}`)
  assert.equal(await phone.getByLabel('背景色').isVisible(), true)
  await category.selectOption('analysis')
  const applyAnalysis = phone.getByRole('button', { name: '解析設定を適用', exact: true })
  await applyAnalysis.scrollIntoViewIfNeeded()
  const depth = await applyAnalysis.evaluate((el) => {
    const ancestors = []
    for (let p = el.parentElement; p; p = p.parentElement) {
      if (/auto|scroll/.test(getComputedStyle(p).overflowY) && p.scrollHeight > p.clientHeight)
        ancestors.push(p.className)
    }
    return ancestors
  })
  assert.deepEqual(depth, ['dock-scroll'], 'One vertical scroll owner for long analysis panel')
  await phone.setViewportSize({ width: 844, height: 390 })
  await category.selectOption('camera')
  const near = mobilePanel.getByRole('spinbutton', { name: '近クリップ', exact: true })
  await near.scrollIntoViewIfNeeded()
  assert.equal(await near.isVisible(), true)
  const horizontal = await scroll.evaluate((el) => el.scrollWidth - el.clientWidth)
  assert(horizontal <= 1, `Landscape camera overflows by ${horizontal}px`)
  await phone.locator('button[data-sheet="layers"]').tap()
  const layers = phone.locator('.ly-panel')
  await layers.getByRole('button', { name: 'レイヤーを追加', exact: true }).tap()
  await layers.getByRole('button', { name: 'グループ', exact: true }).tap()
  await layers.getByRole('button', { name: 'レイヤー操作', exact: true }).tap()
  const duplicate = layers.getByRole('button', { name: '複製', exact: true })
  for (let i = 0; i < 8; i++) await duplicate.tap()
  const lastLayer = layers.locator('.ly-select').last()
  await lastLayer.scrollIntoViewIfNeeded()
  assert.equal(await lastLayer.isVisible(), true)
  assert.equal(await layers.locator('.ly-list').evaluate((el) => getComputedStyle(el).overflowY), 'visible')
  assert(
    await phone.locator('.left-dock .dock-scroll').evaluate((el) => el.scrollTop > 30),
    'Long layer list scrolls in the sheet',
  )
  console.log(
    'PASS: edits, one-step slider undo, duplicate/delete, path editing, modulation, all registered style selectors, layer gradient/effects preset round trip, camera, language switch, touch category picker, steppers, native vertical scroll, horizontal drag, touch cancellation and overflow',
  )
} finally {
  await browser?.close()
  await new Promise((resolve) => server.close(resolve))
}
