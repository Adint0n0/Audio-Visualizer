// Chromium's touchEnd list names the released contacts. Keeping the same IDs lets
// us exercise 1→2→1 without accidentally starting a second one-finger gesture.
export const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
export function point(x, y, id = 1) {
  return { x, y, id, radiusX: 5, radiusY: 5, force: 0.65 }
}
export async function dispatch(cdp, type, ...touchPoints) {
  await cdp.send('Input.dispatchTouchEvent', { type, touchPoints })
}
export async function glide(cdp, from, to, steps = 10) {
  for (let i = 1; i <= steps; i++) {
    await dispatch(
      cdp,
      'touchMove',
      ...to.map((p, j) =>
        point(from[j].x + ((p.x - from[j].x) * i) / steps, from[j].y + ((p.y - from[j].y) * i) / steps, p.id),
      ),
    )
    await wait(16)
  }
}
export async function swipe(cdp, from, to, steps = 10) {
  await dispatch(cdp, 'touchStart', from)
  await glide(cdp, [from], [to], steps)
  await dispatch(cdp, 'touchEnd')
  await wait(220)
}
export async function bindTrace(page) {
  await page.evaluate(() => {
    window.touchReview = { events: [], scrolls: [] }
    for (const type of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'lostpointercapture']) {
      document.addEventListener(
        type,
        (e) => {
          if (e.pointerType === 'touch')
            window.touchReview.events.push({
              type,
              id: e.pointerId,
              trusted: e.isTrusted,
              x: e.clientX,
              y: e.clientY,
              target: e.target.tagName,
            })
        },
        true,
      )
    }
    document.addEventListener(
      'scroll',
      (e) => {
        const el = e.target === document ? document.scrollingElement : e.target
        window.touchReview.scrolls.push({ className: el.className || el.tagName, y: el.scrollTop })
      },
      true,
    )
  })
}
export async function readProject(page) {
  return page.evaluate(async () => {
    const open = indexedDB.open('av-studio-projects')
    const db = await new Promise((resolve, reject) => {
      open.onsuccess = () => resolve(open.result)
      open.onerror = () => reject(open.error)
    })
    try {
      const r = db.transaction('project').objectStore('project').get('current')
      return await new Promise((resolve, reject) => {
        r.onsuccess = () => resolve(r.result)
        r.onerror = () => reject(r.error)
      })
    } finally {
      db.close()
    }
  })
}
export async function geometry(page) {
  return page.evaluate(() => {
    const rect = (el) => {
      if (!el) return null
      const r = el.getBoundingClientRect()
      return [r.x, r.y, r.width, r.height].map(Math.round)
    }
    return {
      viewport: [innerWidth, innerHeight],
      pageWidth: document.documentElement.scrollWidth,
      documentScroll: Math.round(document.scrollingElement.scrollTop),
      canvas: rect(document.querySelector('.stage-frame canvas')),
      smallPrimary: [
        ...document.querySelectorAll(
          '.appbar button,.viewport-head button,.viewport-foot button,.mobile-tabs button,.transport button,.timeline-tools button',
        ),
      ]
        .filter((el) => {
          const b = el.getBoundingClientRect()
          return b.width > 0 && b.height > 0 && (b.width < 43.95 || b.height < 43.95)
        })
        .map((el) => ({
          name: el.getAttribute('aria-label') || el.title || el.textContent.trim(),
          size: rect(el).slice(2),
        })),
      scrollAreas: [...document.querySelectorAll('main *')]
        .filter((el) => {
          const box = el.getBoundingClientRect()
          return (
            box.width > 0 &&
            box.height > 0 &&
            el.scrollHeight > el.clientHeight + 2 &&
            ['auto', 'scroll'].includes(getComputedStyle(el).overflowY)
          )
        })
        .map((el) => ({
          className: el.className,
          rect: rect(el),
          offset: Math.round(el.scrollTop),
          max: el.scrollHeight - el.clientHeight,
        })),
    }
  })
}
