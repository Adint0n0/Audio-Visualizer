// Local production-output smoke tests. Applies the static _headers rules used by this app.
import { createReadStream } from 'node:fs'
import { readFile, realpath, stat } from 'node:fs/promises'
import { createServer } from 'node:http'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

export async function servePages(port = 4173, directory = 'dist') {
  const root = await realpath(directory)
  const rules = new Map()
  let current
  for (const line of (await readFile(path.join(root, '_headers'), 'utf8')).split(/\r?\n/)) {
    if (line.startsWith('/')) {
      current = {}
      rules.set(line.trim(), current)
    } else if (line.trim()) {
      const colon = line.indexOf(':')
      current[line.slice(0, colon).trim()] = line.slice(colon + 1).trim()
    }
  }
  const types = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css',
    '.js': 'text/javascript',
    '.json': 'application/json',
    '.webmanifest': 'application/manifest+json',
    '.png': 'image/png',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml',
    '.wasm': 'application/wasm',
    '.wav': 'audio/wav',
    '.woff2': 'font/woff2',
    '.woff': 'font/woff',
    '.txt': 'text/plain',
    '.mp3': 'audio/mpeg',
  }
  const server = createServer(async (request, response) => {
    try {
      const url = decodeURIComponent(new URL(request.url, 'http://localhost').pathname)
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        response.writeHead(405).end()
        return
      }
      const filename = await realpath(path.join(root, url === '/' ? 'index.html' : url))
      if (!filename.startsWith(root + path.sep) || url === '/_headers') {
        response.writeHead(404).end()
        return
      }
      const info = await stat(filename)
      if (!info.isFile()) {
        response.writeHead(404).end()
        return
      }
      const headers = {
        'Content-Type': types[path.extname(filename)] ?? 'application/octet-stream',
        'Accept-Ranges': 'bytes',
      }
      for (const [rule, values] of rules) {
        if (rule.endsWith('*') ? url.startsWith(rule.slice(0, -1)) : url === rule)
          Object.assign(headers, values)
      }
      let start = 0,
        end = info.size - 1
      const range = request.headers.range
      if (range) {
        const match = /^bytes=(\d*)-(\d*)$/.exec(range)
        if (match && (match[1] || match[2])) {
          start = match[1] ? Number(match[1]) : Math.max(0, info.size - Number(match[2]))
          end = match[1] && match[2] ? Math.min(info.size - 1, Number(match[2])) : info.size - 1
        }
        if (!match || start > end || end < 0) {
          response.writeHead(416, { 'Content-Range': 'bytes */' + info.size }).end()
          return
        }
        headers['Content-Range'] = `bytes ${start}-${end}/${info.size}`
      }
      headers['Content-Length'] = Math.max(0, end - start + 1)
      response.writeHead(range ? 206 : 200, headers)
      if (request.method === 'HEAD' || !info.size) response.end()
      else {
        const stream = createReadStream(filename, { start, end })
        stream.on('error', () => response.destroy())
        response.on('close', () => stream.destroy())
        stream.pipe(response)
      }
    } catch {
      if (!response.headersSent) response.writeHead(404)
      response.end()
    }
  })
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, '127.0.0.1', () => resolve(server))
  })
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const server = await servePages(Number(process.env.PORT ?? 4173))
  console.log('Production output at http://127.0.0.1:' + server.address().port)
}
