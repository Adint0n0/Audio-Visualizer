import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { geometry, wait } from './events.mjs'

export const sizes = [
  [360, 640],
  [360, 780],
  [390, 844],
  [412, 915],
  [640, 360],
  [780, 360],
  [844, 390],
  [915, 412],
  [768, 1024],
  [1024, 768],
  [1440, 900],
]
export async function startPage(browser, url, width, height, touch = true) {
  const context = await browser.newContext({
    viewport: { width, height },
    screen: { width, height },
    isMobile: touch,
    hasTouch: touch,
    deviceScaleFactor: 1,
    locale: 'en-US',
    reducedMotion: 'reduce',
    serviceWorkers: 'block',
  })
  const page = await context.newPage()
  await page.goto(url)
  await page.waitForFunction(() => document.querySelector('.export-btn')?.disabled === false, undefined, {
    timeout: 90000,
  })
  await page.evaluate(() => document.fonts.ready)
  return { context, page }
}
async function contactSheet(browser, shots, dest) {
  const page = await browser.newPage({ viewport: { width: 1040, height: 900 }, deviceScaleFactor: 1 })
  const images = await Promise.all(
    shots.map(async ({ path, name }) => ({
      name,
      src: 'data:image/jpeg;base64,' + (await readFile(path)).toString('base64'),
    })),
  )
  await page.setContent(
    '<!doctype html><meta charset="utf-8"><style>*{box-sizing:border-box}body{margin:0;padding:24px;background:#151819;color:#ebf3ee;font:16px system-ui;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:18px}figure{margin:0;padding:10px;background:#252a2b;border-radius:8px;display:grid;gap:8px;align-content:start}figcaption{color:#bfddcf}img{display:block;max-height:375px;max-width:100%;object-fit:contain;margin:auto}</style>',
  )
  await page.evaluate((images) => {
    for (const { name, src } of images) {
      const fig = document.createElement('figure'),
        label = document.createElement('figcaption'),
        im = document.createElement('img')
      label.textContent = name
      im.src = src
      fig.append(label, im)
      document.body.append(fig)
    }
  }, images)
  await page.evaluate(() => Promise.all([...document.images].map((i) => i.decode())))
  await page.screenshot({ path: dest, fullPage: true, type: 'jpeg', quality: 84 })
  await page.close()
}
export async function captureMatrix(browser, url, directory, baseline = false) {
  await mkdir(directory, { recursive: true })
  const records = [],
    shots = []
  const { context, page } = await startPage(browser, url, ...sizes[0], true)
  const photo = async (p, name) => {
    const path = join(directory, name + '.jpg')
    await p.screenshot({ path, type: 'jpeg', quality: 84, animations: 'disabled' })
    shots.push({ path, name })
  }
  try {
    for (const [width, height] of sizes.slice(0, -1)) {
      await page.setViewportSize({ width, height })
      await wait(120)
      const name = width + 'x' + height
      records.push({ name, ...(await geometry(page)) })
      await photo(page, name)
      const panels = baseline
        ? width === 390 || width === 844
          ? ['inspector']
          : []
        : width === 360 && height === 640
          ? ['library', 'layers', 'inspector']
          : width === 390 || width === 844
            ? ['inspector']
            : []
      for (const id of panels) {
        const btn = baseline
          ? page.locator('.mobile-tabs button').last()
          : page.locator('button[data-sheet="' + id + '"]')
        if (await btn.isVisible()) {
          await btn.tap()
          await wait(170)
          if (id === 'library')
            await page
              .locator('.thumb img')
              .first()
              .evaluate((i) => i.decode())
          records.push({ name: name + '-' + id, ...(await geometry(page)) })
          await photo(page, name + '-' + id)
          const stage = baseline
            ? page.locator('.mobile-tabs button').nth(1)
            : page.locator('button[data-sheet="stage"]')
          await stage.tap()
        }
      }
    }
  } finally {
    await context.close()
  }
  const desktop = await startPage(browser, url, 1440, 900, false)
  try {
    records.push({ name: '1440x900', ...(await geometry(desktop.page)) })
    await photo(desktop.page, '1440x900')
  } finally {
    await desktop.context.close()
  }
  await contactSheet(browser, shots, join(directory, 'matrix.jpg'))
  await writeFile(join(directory, 'layout.json'), JSON.stringify(records, null, 2) + '\n')
  return records
}
