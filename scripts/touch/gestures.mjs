import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect } from '@playwright/test'
import { dispatch, geometry, glide, point, readProject, swipe, wait } from './events.mjs'

const btn = (page, key) => page.locator('button[data-' + key[0] + '="' + key[1] + '"]:visible')
const sheet = (p, id) => btn(p, ['sheet', id])
const mode = (p, id) => btn(p, ['mode', id])
const action = (p, id) => btn(p, ['action', id])
const xyz = (layer) => [...layer.position, ...layer.rotation, ...layer.scale]
async function committed(page, check, label) {
  let p
  await expect
    .poll(
      async () => {
        p = await readProject(page)
        return Boolean(p && check(p))
      },
      { message: label, timeout: 12000, intervals: [120, 250] },
    )
    .toBe(true)
  return p
}
async function canvasPoint(page, u = 0.5, v = 0.5, id = 1) {
  const rect = await page.locator('.stage-frame canvas').boundingBox()
  assert(rect && rect.height > 20)
  return point(rect.x + rect.width * u, rect.y + rect.height * v, id)
}
async function tap(cdp, p) {
  await dispatch(cdp, 'touchStart', p)
  await wait(35)
  await dispatch(cdp, 'touchEnd')
}
async function importFixture(page) {
  const original = await committed(page, (p) => p.mediaId && p.layers.length, 'wait for the built-in project')
  const base = structuredClone(original.layers[0])
  Object.assign(base, {
    kind: 'visualizer',
    style: 'orb',
    id: 'touch-subject',
    name: 'Touch subject',
    position: [0, 0, 0],
    scale: [1, 1, 1],
    rotation: [0, 0, 0],
    pivot: [0, 0, 0],
    parentId: null,
    motions: [],
    modulations: [],
    visible: true,
    locked: false,
    screenSpace: false,
    effects: { bloom: 0, trail: 0 },
  })
  Object.assign(base.settings, { radius: 1.15, baseline: 0, maxHeight: 1, count: 32, speed: 0 })
  const groups = Array.from({ length: 23 }, (_, i) => ({
    ...structuredClone(base),
    kind: 'group',
    id: 'touch-group-' + i,
    name: 'Group ' + (i + 1),
  }))
  const camera = {
    ...original.camera,
    projection: 'perspective',
    position: [0, 0, 9],
    target: [0, 0, 0],
    zoom: 1,
    roll: 0,
    orbit: 0,
  }
  const project = {
    ...original,
    name: 'Touch fixture',
    layers: [base, ...groups],
    camera,
    modulations: [],
    motions: [],
    effects: { bloom: 0, trail: 0 },
  }
  await page.locator('input[accept=".avproj,.json"]').setInputFiles({
    name: 'touch.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(project)),
  })
  return committed(page, (p) => p.name === 'Touch fixture', 'scene fixture import')
}

async function visibleScrollOwner(page) {
  const g = await geometry(page)
  return g.scrollAreas
    .filter((a) => a.max > 25)
    .sort((a, b) => b.rect[2] * b.rect[3] - a.rect[2] * a.rect[3])[0]
}
async function swipePanel(page, cdp, name) {
  await sheet(page, name).tap()
  await wait(150)
  const item = await visibleScrollOwner(page)
  assert(item, 'No scrollable content in ' + name)
  const [x, y, w, h] = item.rect,
    top = Math.max(0, y) + 5,
    bottom = Math.min(y + h, (await page.viewportSize()).height) - 5
  // Swipe the content gutter, outside slider thumbs and row action buttons.
  const fingerX = Math.min(x + w - 5, (await page.viewportSize()).width - 7)
  const start = point(fingerX, top + (bottom - top) * 0.81),
    end = point(fingerX, top + (bottom - top) * 0.17)
  let last = item
  const before = await geometry(page)
  assert.equal(before.documentScroll, 0)
  for (let i = 0; i < 65 && last.offset < last.max - 2; i++) {
    await swipe(cdp, start, end, 6)
    last = await visibleScrollOwner(page)
    assert(last && last.offset > item.offset, 'No finger scroll progress in ' + name)
  }
  assert(last.offset >= last.max - 3, `Cannot reach bottom of ${name}: ${last.offset}/${last.max}`)
  const after = await geometry(page)
  assert(after.canvas[2] > 0 && after.canvas[3] > 0)
  assert.equal(after.documentScroll, 0, 'page scrolled instead of ' + name)
  console.log('Scrolled', name, last.offset, '/', last.max)
  return { name, owner: last.className, from: item.offset, bottom: last.offset, max: last.max }
}
export async function gestures(page, cdp, artifacts) {
  const record = { panels: [] },
    errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  // The emulated cutout and home indicator are applied by Chromium to CSS env().
  await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: { top: 20, bottom: 28 } })
  const insets = await page.evaluate(() => {
    const shell = getComputedStyle(document.querySelector('.app'))
    const bar = document.querySelector('.appbar').getBoundingClientRect()
    const nav = document.querySelector('.mobile-tabs').getBoundingClientRect()
    return [
      parseFloat(shell.paddingTop),
      parseFloat(shell.paddingBottom),
      Math.round(bar.top),
      Math.round(innerHeight - nav.bottom),
    ]
  })
  assert.deepEqual(insets, [20, 28, 20, 28], 'notch/home-indicator would cover the editor chrome')
  record.safeInsets = insets
  await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: {} })
  const initial = await importFixture(page)
  console.log('Imported mobile interaction scene')
  for (const name of process.argv.includes('--gestures-only') ? [] : ['library', 'layers', 'inspector']) {
    record.panels.push(await swipePanel(page, cdp, name))
    await sheet(page, 'stage').tap()
  }
  await mode(page, 'object').tap()
  const center = await canvasPoint(page),
    empty = await canvasPoint(page, 0.05, 0.08)
  await tap(cdp, empty)
  const selection = page.locator('[data-selection-bound]:visible')
  await expect(selection).toHaveCount(0)
  await tap(cdp, center)
  await expect(selection).toHaveCount(1)
  await dispatch(cdp, 'touchStart', center)
  await wait(650)
  await dispatch(cdp, 'touchEnd')
  const hold = page.getByRole('dialog', { name: 'Layer actions' })
  await expect(hold).toBeVisible()
  await wait(200)
  await hold.getByRole('button', { name: 'Close', exact: true }).tap()
  record.hold = true
  console.log('Selection, background and long-press verified')

  // A near-center drag starts a snap latch and exposes an actual screen-space guide.
  await dispatch(cdp, 'touchStart', center)
  await glide(cdp, [center], [point(center.x + 7, center.y)])
  await expect(page.locator('[data-guide="x"]:visible')).toHaveCount(1)
  await glide(cdp, [point(center.x + 7, center.y)], [point(center.x + 12, center.y)])
  await expect(page.locator('[data-guide="x"]:visible')).toHaveCount(1)
  await dispatch(cdp, 'touchCancel')
  await expect(page.locator('[data-guide]:visible')).toHaveCount(0)
  record.snapLatch = true

  // Combined translation, scaling and twisting must commit once after the last finger lifts.
  const orbit = mode(page, 'orbit'),
    view = mode(page, 'view')
  const a = point(center.x - 20, center.y),
    one = point(a.x + 8, a.y + 5)
  const b = point(center.x + 24, center.y, 2)
  const c = point(one.x - 11, one.y - 10),
    d = point(b.x + 24, b.y + 22, 2)
  await dispatch(cdp, 'touchStart', a)
  await glide(cdp, [a], [one])
  await dispatch(cdp, 'touchStart', one, b)
  await glide(cdp, [one, b], [c, d])
  const beforeRelease = await selection.boundingBox()
  assert(beforeRelease)
  await dispatch(cdp, 'touchEnd', d)
  const following = point(c.x + 38, c.y - 17)
  await glide(cdp, [c], [following])
  const afterRelease = await selection.boundingBox()
  assert(
    afterRelease &&
      Math.abs(afterRelease.width - beforeRelease.width) < Math.max(5, beforeRelease.width * 0.08),
    'scale jumped at two-to-one transition',
  )
  await dispatch(cdp, 'touchEnd')
  const edited = await committed(page, (p) => p.layers[0].scale[0] > 1.2, 'multi-touch transform committed')
  assert(Math.abs(edited.layers[0].rotation[2]) > 3, 'twist did not rotate the object')
  assert.notDeepEqual(edited.layers[0].position, initial.layers[0].position)
  assert.deepEqual(edited.camera, initial.camera)
  console.log('Multitouch edit', edited.layers[0].position, edited.layers[0].rotation, edited.layers[0].scale)
  record.gesture = xyz(edited.layers[0]).map((v) => Number(v.toFixed(3)))
  await action(page, 'undo').tap()
  await committed(
    page,
    (p) => JSON.stringify(xyz(p.layers[0])) === JSON.stringify(xyz(initial.layers[0])),
    'one Undo restores all finger segments',
  )

  // Simulate an OS stealing the gesture while two contacts are captured.
  await dispatch(cdp, 'touchStart', a, b)
  await glide(cdp, [a, b], [c, d])
  await dispatch(cdp, 'touchCancel')
  await wait(800)
  assert.deepEqual(
    xyz((await readProject(page)).layers[0]),
    xyz(initial.layers[0]),
    'canceled touch committed unexpectedly',
  )
  // Release the DOM's active pointer capture, then deliver a move and lift through the browser.
  await dispatch(cdp, 'touchStart', a)
  await glide(cdp, [a], [point(a.x + 33, a.y + 12)])
  const released = await page.locator('.stage-frame canvas').evaluate((el) => {
    const id = window.touchReview.events.filter((e) => e.type === 'pointerdown').at(-1).id
    if (!el.hasPointerCapture(id)) return false
    el.releasePointerCapture(id)
    return true
  })
  assert(released, 'active canvas contact was not captured')
  await dispatch(cdp, 'touchMove', point(a.x + 39, a.y + 12))
  await dispatch(cdp, 'touchEnd')
  await wait(800)
  assert.deepEqual(
    xyz((await readProject(page)).layers[0]),
    xyz(initial.layers[0]),
    'capture loss committed unexpectedly',
  )
  record.captureRollback = true
  await orbit.tap()
  await swipe(cdp, center, point(center.x + 33, center.y - 22))
  const turned = await committed(
    page,
    (p) => Math.abs(p.layers[0].rotation[0]) + Math.abs(p.layers[0].rotation[1]) > 1,
    'arcball rotation',
  )
  assert.deepEqual(turned.layers[0].position, initial.layers[0].position)
  record.orbit = turned.layers[0].rotation
  await action(page, 'undo').tap()
  await committed(page, (p) => p.layers[0].rotation.every((n) => Math.abs(n) < 0.001), 'arcball undo')

  // Compare WebGL pixels while paused, then verify the durable output camera is untouched.
  await view.tap()
  await wait(200)
  const hash = () => page.locator('.stage-frame canvas').evaluate((c) => c.toDataURL())
  const beforeView = await hash()
  await swipe(cdp, center, point(center.x + 51, center.y + 19))
  await dispatch(cdp, 'touchStart', a, b)
  await glide(cdp, [a, b], [c, d])
  await dispatch(cdp, 'touchEnd')
  await wait(450)
  assert.notEqual(await hash(), beforeView, 'editor camera did not alter WebGL pixels')
  const viewOnly = await readProject(page)
  assert.deepEqual(viewOnly.camera, initial.camera)
  assert.deepEqual(xyz(viewOnly.layers[0]), xyz(initial.layers[0]))
  record.cameraIsolated = true

  await mode(page, 'object').tap()
  // Resize and rotate during active capture using the browser orientation notification.
  await dispatch(cdp, 'touchStart', center)
  await glide(cdp, [center], [point(center.x + 22, center.y + 12)])
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 640,
    height: 360,
    deviceScaleFactor: 1,
    mobile: true,
    screenWidth: 640,
    screenHeight: 360,
    screenOrientation: { type: 'landscapePrimary', angle: 90 },
  })
  await wait(220)
  await dispatch(cdp, 'touchEnd')
  await wait(700)
  assert.deepEqual(
    xyz((await readProject(page)).layers[0]),
    xyz(initial.layers[0]),
    'orientation change committed interrupted edit',
  )
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 360,
    height: 640,
    deviceScaleFactor: 1,
    mobile: true,
    screenWidth: 360,
    screenHeight: 640,
    screenOrientation: { type: 'portraitPrimary', angle: 0 },
  })
  await wait(250)
  await action(page, 'precision').tap()
  const precision = page.getByRole('dialog', { name: 'Precise transform' })
  await expect(precision).toBeVisible()
  const field = precision.getByRole('spinbutton').first()
  await field.tap()
  await page.setViewportSize({ width: 360, height: 390 })
  await field.fill('1.25')
  await field.press('Enter')
  await expect(field).toHaveValue('1.25')
  const fieldBox = await field.boundingBox()
  assert(
    fieldBox && fieldBox.y >= 0 && fieldBox.y + fieldBox.height <= 390,
    'focused precision input is clipped after viewport shrink',
  )
  record.keyboardViewport = [360, 390]
  await expect(precision).toBeVisible()
  await page.setViewportSize({ width: 360, height: 640 })
  await precision.getByRole('button', { name: 'Close', exact: true }).tap()
  await committed(page, (p) => p.layers[0].position[0] === 1.25, 'precise position')
  await action(page, 'snap').tap()
  const snap = page.getByRole('dialog', { name: 'Snap guides' })
  await expect(snap).toBeVisible()
  await snap.getByRole('checkbox', { name: 'Snapping', exact: true }).uncheck()
  await snap.getByRole('button', { name: 'Close', exact: true }).tap()
  await page.getByRole('button', { name: 'Play', exact: true }).filter({ visible: true }).tap()
  await page.waitForFunction(() => document.querySelector('video').currentTime > 0.13)
  const t = await page.locator('video').evaluate((v) => v.currentTime)
  await swipe(cdp, center, point(center.x + 40, center.y - 12))
  const playback = await committed(
    page,
    (p) => Math.abs(p.layers[0].position[0] - 1.25) > 0.1,
    'drag during playback committed',
  )
  assert(playback.layers[0].position.every(Number.isFinite))
  assert(
    await page.locator('video').evaluate((v, t) => !v.paused && v.currentTime > t, t),
    'editing interrupted playback',
  )
  await page.getByRole('button', { name: 'Pause', exact: true }).filter({ visible: true }).tap()
  record.pointerEvents = await page.evaluate(() => {
    const events = window.touchReview.events
    return {
      trusted: events.every((e) => e.trusted),
      downs: events.filter((e) => e.type === 'pointerdown').length,
      cancels: events.filter((e) => e.type === 'pointercancel').length,
    }
  })
  assert(record.pointerEvents.trusted && record.pointerEvents.cancels >= 1)
  assert.deepEqual(errors, [])
  await writeFile(join(artifacts, 'interaction.json'), JSON.stringify(record, null, 2) + '\n')
  console.log('Touch controls:', JSON.stringify(record))
}
