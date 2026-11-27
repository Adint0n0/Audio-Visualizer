import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium, expect } from '@playwright/test'
import { servePages } from './serve-pages.mjs'

const grid = 128
function normalizedFrame(input, image, crop) {
  return execFileSync(
    'ffmpeg',
    [
      '-v',
      'error',
      '-i',
      input,
      '-an',
      '-frames:v',
      '1',
      '-vf',
      [crop, `scale=${grid}:${grid}:flags=area`].filter(Boolean).join(','),
      '-pix_fmt',
      'rgb24',
      '-f',
      'rawvideo',
      'pipe:1',
    ],
    { input: image },
  )
}

function compareComposition(preview, output) {
  assert.equal(output.length, preview.length)
  let intersection = 0,
    union = 0,
    difference = 0
  const boundsA = [grid, grid, 0, 0]
  const boundsB = [...boundsA]
  function expand(bounds, i) {
    const x = (i / 3) % grid,
      y = Math.floor(i / 3 / grid)
    bounds[0] = Math.min(bounds[0], x)
    bounds[1] = Math.min(bounds[1], y)
    bounds[2] = Math.max(bounds[2], x)
    bounds[3] = Math.max(bounds[3], y)
  }
  for (let i = 0; i < preview.length; i += 3) {
    const a = Math.max(preview[i], preview[i + 1], preview[i + 2]) > 65
    const b = Math.max(output[i], output[i + 1], output[i + 2]) > 65
    if (a) expand(boundsA, i)
    if (b) expand(boundsB, i)
    if (a && b) intersection++
    if (a || b) union++
    for (let c = 0; c < 3; c++) difference += Math.abs(preview[i + c] - output[i + c])
  }
  assert.ok(union > 100, 'Expected visible spectrum')
  const overlap = intersection / union
  const mae = difference / preview.length
  assert.ok(overlap > 0.75, `Spectrum mask overlap ${overlap.toFixed(3)}`)
  assert.ok(
    boundsA.every((edge, i) => Math.abs(edge - boundsB[i]) <= 3),
    `Bounds ${boundsA} → ${boundsB}`,
  )
  assert.ok(mae < 6, `RGB mean absolute error ${mae.toFixed(2)}`)
  return { overlap, mae }
}

const server = await servePages(0)
const artifacts = await mkdtemp(join(tmpdir(), 'formant-aspect-'))
let browser
try {
  browser = await chromium.launch({
    executablePath:
      process.env.CHROMIUM_PATH || (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined),
    args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--disable-dev-shm-usage'],
  })
  const page = await browser.newPage({ locale: 'en-US', viewport: { width: 1327, height: 881 } })
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto('http://127.0.0.1:' + server.address().port)
  const exportButton = page.getByRole('button', { name: 'Export', exact: true })
  const dialog = page.getByRole('dialog', { name: 'Export video' })
  const resolution = dialog.getByRole('combobox', { name: 'Resolution', exact: true })
  const ratio = page.getByRole('combobox', { name: 'Preview aspect ratio' })
  const canvas = page.getByLabel('3D scene preview')
  const close = () => dialog.getByRole('button', { name: 'Close', exact: true }).click()
  async function apply(name) {
    await page.getByLabel('Search templates').fill(name)
    await page.locator('.template-pick').click()
    await page.getByRole('button', { name: 'Replace scene' }).click()
  }

  await expect(exportButton).toBeEnabled({ timeout: 90000 })
  await apply('Twin Rail')
  await page.getByTitle('Preview settings').click()
  await page.getByRole('checkbox', { name: 'Adaptive quality' }).uncheck()
  await page.locator('.view-options').getByLabel('Resolution').selectOption('0.5')
  await page.getByTitle('Preview settings').click()

  async function readPreview() {
    const png = await canvas.evaluate(async (element) => {
      for (let i = 0; i < 4; i++) await new Promise(requestAnimationFrame)
      return element.toDataURL('image/png').split(',')[1]
    })
    return normalizedFrame('pipe:0', Buffer.from(png, 'base64'))
  }

  async function downloadVideo(format, width, height) {
    await dialog.getByRole('combobox', { name: 'Format', exact: true }).selectOption(format)
    const codec = format === 'mp4' ? 'avc' : 'vp9'
    await dialog.getByRole('combobox', { name: 'Video codec' }).selectOption(codec, { timeout: 90000 })
    await dialog.getByRole('button', { name: 'Render video' }).click({ timeout: 90000 })
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 90000 }),
      dialog.getByRole('link', { name: 'Download video' }).click({ timeout: 90000 }),
    ])
    const file = join(artifacts, `${width}x${height}.${format}`)
    await download.saveAs(file)
    const { streams } = JSON.parse(
      execFileSync('ffprobe', ['-v', 'error', '-show_streams', '-of', 'json', file], { encoding: 'utf8' }),
    )
    const video = streams.find((stream) => stream.codec_type === 'video')
    assert.deepEqual([video.width, video.height], [width, height])
    assert.equal(video.codec_name, format === 'mp4' ? 'h264' : 'vp9')
    assert.ok(!video.sample_aspect_ratio || ['1:1', 'N/A'].includes(video.sample_aspect_ratio))
    assert.ok(streams.some((stream) => stream.codec_type === 'audio'))
    return file
  }

  const standard = [
    { name: '16:9', ratios: ['1280 × 720', '1920 × 1080', '2560 × 1440', '3840 × 2160'], size: [1280, 720] },
    { name: '1:1', ratios: ['720 × 720', '1080 × 1080', '1440 × 1440', '2160 × 2160'], size: [1440, 1440] },
    { name: '9:16', ratios: ['720 × 1280', '1080 × 1920', '1440 × 2560', '2160 × 3840'], size: [720, 1280] },
    { name: '3:2', ratios: ['1080 × 720', '1620 × 1080', '2160 × 1440', '3240 × 2160'], size: [1620, 1080] },
  ]
  assert.ok((await ratio.locator('option').count()) >= 14)
  let customPreview
  for (const {
    name,
    ratios,
    size: [width, height],
  } of [...standard, { name: '50:31', size: [500, 310] }]) {
    const custom = name === '50:31'
    const ratioChoice = custom ? 'custom' : name.replace(':', ' / ')
    // Exercise both the orthographic and perspective camera paths.
    if (name === '9:16') await apply('Crystal Organ')
    if (!custom) {
      await ratio.selectOption(ratioChoice)
    } else {
      await ratio.selectOption('edit-custom')
      const form = page.getByRole('dialog', { name: 'Custom aspect ratio' })
      await form.getByLabel('Width units').fill('50')
      await form.getByLabel('Height units').fill('31')
      await form.getByRole('button', { name: 'Apply ratio' }).click()
    }
    await expect(ratio).toHaveValue(ratioChoice)
    await expect
      .poll(async () => {
        const rect = await canvas.boundingBox()
        return Math.abs(rect.width / rect.height - width / height)
      })
      .toBeLessThan(0.002)
    await page.locator('video').evaluate((video) => {
      video.currentTime = 2
    })
    await expect(page.locator('.clock')).toContainText('00:02.000')
    const preview = await readPreview()
    if (custom) customPreview = preview

    await exportButton.click()
    await expect(dialog.locator('.export-frame-ratio')).toContainText(name)
    if (custom) {
      const options = await resolution.locator('option').allTextContents()
      assert.ok(options.length > 2)
      assert.ok(
        options.slice(0, -1).every((value) => {
          const [w, h] = value.split(' × ').map(Number)
          return w * 31 === h * 50
        }),
      )
      await resolution.selectOption('custom')
      await expect(dialog.getByRole('checkbox', { name: 'Lock to editor aspect ratio' })).toBeChecked()
      await dialog.getByLabel('Width (px)').fill('500')
      await expect(dialog.getByLabel('Height (px)')).toHaveValue('310')
    } else {
      assert.deepEqual(await resolution.locator('option').allTextContents(), [...ratios, 'Custom'])
      await resolution.selectOption({ label: `${width} × ${height}` })
    }
    await dialog.getByLabel('Start (s)').fill('2')
    await dialog.getByLabel('End (s)').fill('2.1')
    for (const format of ['mp4', 'webm']) {
      const file = await downloadVideo(format, width, height)
      const { overlap, mae } = compareComposition(preview, normalizedFrame(file))
      console.log(
        `PASS ${format} ${name} ${width}×${height}, mask overlap ${(100 * overlap).toFixed(1)}%, RGB MAE ${mae.toFixed(2)}`,
      )
    }
    await close()
    await expect(ratio).toHaveValue(ratioChoice)
    assert.deepEqual(
      await readPreview(),
      preview,
      'Changing output resolution changed the editor composition',
    )
  }

  // The explicit unlock letterboxes this export and does not override the saved editor dimensions.
  await exportButton.click()
  await expect(dialog.getByLabel('Width (px)')).toHaveValue('500')
  await expect(dialog.getByLabel('Height (px)')).toHaveValue('310')
  await dialog.getByRole('checkbox', { name: 'Lock to editor aspect ratio' }).uncheck()
  await dialog.getByLabel('Width (px)').fill('640')
  await dialog.getByLabel('Height (px)').fill('640')
  const boxed = await downloadVideo('mp4', 640, 640)
  assert.ok(
    normalizedFrame(boxed)
      .subarray(0, grid * 3)
      .every((channel) => channel <= 3),
  )
  compareComposition(customPreview, normalizedFrame(boxed, undefined, 'crop=640:396:0:122'))
  await close()
  await expect(ratio).toHaveValue('custom')
  assert.deepEqual(await readPreview(), customPreview)
  await exportButton.click()
  await expect(dialog.getByRole('checkbox', { name: 'Lock to editor aspect ratio' })).toBeChecked()
  await expect(dialog.getByLabel('Width (px)')).toHaveValue('500')
  await expect(dialog.getByLabel('Height (px)')).toHaveValue('310')
  await close()
  console.log('PASS one-off 640×640 output with black borders and unchanged editor composition')
  assert.deepEqual(errors, [])
} finally {
  await browser?.close()
  server.closeAllConnections()
  await new Promise((resolve) => server.close(resolve))
  await rm(artifacts, { recursive: true, force: true })
}
