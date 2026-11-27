import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { chromium } from '@playwright/test'
import { createServer } from 'vite'

// Drive the real studio through its public controls so history, selection and scene updates
// are verified together. The development server also allows running this check before build.
const server = await createServer({
  logLevel: 'error',
  server: { host: '127.0.0.1', port: 0 },
})
let browser
try {
  await server.listen()
  browser = await chromium.launch({
    executablePath:
      process.env.CHROMIUM_PATH || (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined),
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage'],
  })
  const url = 'http://127.0.0.1:' + server.httpServer.address().port
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
  await phone.locator('.mobile-tabs').getByRole('button', { name: 'プロパティ' }).tap()
  await phone.getByRole('button', { name: 'シーン', exact: true }).tap()
  const width = await phone.evaluate(() => ({
    doc: document.documentElement.scrollWidth,
    viewport: innerWidth,
  }))
  assert(width.doc <= width.viewport, `Unexpected horizontal overflow: ${JSON.stringify(width)}`)
  assert.equal(await phone.getByLabel('背景色').isVisible(), true)
  console.log(
    'PASS: edits, one-step slider undo, duplicate/delete, path editing, modulation, all 12 style selectors, layer gradient/effects preset round trip, camera, language switch, mobile touch and overflow',
  )
} finally {
  await browser?.close()
  await server.close()
}
