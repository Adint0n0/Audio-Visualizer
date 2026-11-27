import { spawnSync } from 'node:child_process'
const checks = [
  'check-storage-browser',
  'check-media',
  'check-music-response',
  'check-scene',
  'check-instruments',
  'check-templates',
  'check-panels',
  'check-studio',
  'check-touch',
  'check-export',
  'check-offline',
  'check-offline-update',
  'check-export-dialog',
  'check-composite',
]
for (const name of checks) {
  console.log('Running', name)
  const child = spawnSync(process.execPath, [new URL(name + '.mjs', import.meta.url).pathname], {
    stdio: 'inherit',
  })
  if (child.error) throw child.error
  if (child.status !== 0) process.exit(child.status ?? 1)
}
