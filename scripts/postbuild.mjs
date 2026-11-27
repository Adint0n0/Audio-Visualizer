import { createHash } from 'node:crypto'
import { readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { pathToFileURL } from 'node:url'

const maxFileSize = 25 * 1024 * 1024
const hash = (data) => createHash('sha256').update(data).digest('hex')

async function collect(dir) {
  const files = []
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) files.push(...(await collect(path)))
    else if (entry.isFile()) files.push(path)
    else throw new Error(`Unexpected build output: ${path}`)
  }
  return files
}

export async function finalizeBuild(output = 'dist') {
  // Redistribute license texts with the exact dependency versions used for this build.
  const lock = JSON.parse(await readFile('package-lock.json', 'utf8'))
  const notices = []
  for (const [location, pkg] of Object.entries(lock.packages)) {
    if (!location || pkg.dev || pkg.optional) continue
    const filename = (await readdir(location)).find((f) => /^(?:licen[cs]e|copying|ofl)(?:\.\w+)?$/i.test(f))
    if (!filename) throw new Error(`Missing license notice for ${location}`)
    const title = `${pkg.name ?? location.split('node_modules/').pop()} ${pkg.version} (${pkg.license ?? 'see license'})`
    notices.push(title + '\n' + (await readFile(join(location, filename), 'utf8')))
  }
  await writeFile(join(output, 'licenses', 'dependencies.txt'), notices.join('\n\n'))

  const paths = (await collect(output)).sort()
  if (paths.filter((path) => relative(output, path) !== 'sw.js').length + 1 > 20_000) {
    throw new Error('Cloudflare Pages free-plan limit of 20,000 files exceeded')
  }
  const precache = {}
  for (const path of paths) {
    if ((await stat(path)).size > maxFileSize)
      throw new Error(`Cloudflare Pages file limit exceeded: ${path}`)
    const name = relative(output, path)
    if (['sw.js', '_headers', '_redirects'].includes(name)) continue
    precache[name === 'index.html' ? '/' : '/' + name] = hash(await readFile(path))
  }
  if (!precache['/']) throw new Error('Missing production HTML')
  const template = await readFile(new URL('./offline-worker.js', import.meta.url), 'utf8')
  const manifest = JSON.stringify(precache)
  const worker = template
    .replace("'PRECACHE_MANIFEST'", () => manifest)
    .replace("'CACHE_VERSION'", () =>
      JSON.stringify('av-studio-shell-' + hash(template + manifest).slice(0, 20)),
    )
  await writeFile(join(output, 'sw.js'), worker)
  console.log(`Offline shell includes ${Object.keys(precache).length} verified static assets`)
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await finalizeBuild()
