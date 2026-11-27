export type OfflineState =
  'development' | 'checking' | 'installing' | 'ready' | 'waiting' | 'failed' | 'updateFailed' | 'unsupported'
let state: OfflineState = import.meta.env.PROD ? 'checking' : 'development'
const subscribers = new Set<() => void>()
export const getOfflineState = () => state
export function subscribeOffline(listener: () => void) {
  subscribers.add(listener)
  return () => {
    subscribers.delete(listener)
  }
}
function setState(next: OfflineState) {
  if (next === state) return
  state = next
  for (const listener of subscribers) listener()
}

/** The worker reaches "installed" only after the entire versioned shell passes SHA-256 checks. */
export async function registerOffline(): Promise<void> {
  if (!import.meta.env.PROD) return
  if (!('serviceWorker' in navigator)) {
    setState('unsupported')
    return
  }
  try {
    const workers = navigator.serviceWorker
    const registration = await workers.register('/sw.js', { scope: '/', updateViaCache: 'none' })
    let lastFailure = false
    const refresh = () => {
      const active = registration.active?.state === 'activated'
      if (registration.waiting && active) setState('waiting')
      else if (registration.installing && registration.installing.state !== 'redundant')
        setState('installing')
      else if (active) setState(lastFailure ? 'updateFailed' : 'ready')
      else if (lastFailure) setState('failed')
      else setState('installing')
    }
    const watch = (worker: ServiceWorker | null) => {
      if (!worker) return
      const changed = () => {
        if (worker.state === 'redundant') {
          // A retired active version can also emit redundant after an ordinary update.
          if (!registration.active || worker !== workers.controller) lastFailure = true
        }
        if (worker.state === 'activated' || worker.state === 'redundant')
          worker.removeEventListener('statechange', changed)
        refresh()
      }
      worker.addEventListener('statechange', changed)
    }
    registration.addEventListener('updatefound', () => {
      lastFailure = false
      watch(registration.installing)
      refresh()
    })
    workers.addEventListener('controllerchange', refresh)
    watch(
      registration.installing ??
        registration.waiting ??
        (registration.active?.state === 'activating' ? registration.active : null),
    )
    refresh()
  } catch (error) {
    setState('failed')
    throw error
  }
}
