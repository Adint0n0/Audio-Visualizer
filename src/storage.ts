import {
  BlobReader,
  BlobWriter,
  ZipReader,
  ZipWriter,
  type FileEntry,
} from '@zip.js/zip.js/index-native.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex } from '@noble/hashes/utils.js'
import { parseLayer, parseProject, type Layer, type Project } from './model'
import { validateImage } from './validateImage'

export { validateImage }
export type Assets = Map<string, File>
type Snapshot = { project: Project; assets: Assets }
type AssetRecord = { id: string; name: string; size: number; type: string }
const MiB = 1024 * 1024
export const STORAGE_LIMITS = {
  json: 4 * MiB,
  archive: 1024 * MiB,
  singleAsset: 768 * MiB,
  assets: 128,
} as const
const idPattern = /^[0-9a-f]{64}$/
const cache = new WeakMap<Blob, Promise<string>>()
/** Limit both the transferred font and the SFNT size declared by a compressed WOFF container. */
export async function validateFont(file: Blob): Promise<void> {
  if (file.size < 12 || file.size > 32 * MiB)
    throw new Error(
      'Font must be a WOFF, WOFF2, TTF, or OTF file up to 32 MiB / フォントの上限は32 MiBです',
    )
  const header = new DataView(await file.slice(0, 48).arrayBuffer())
  const family = header.getUint32(0)
  if (family === 0x774f4646 || family === 0x774f4632) {
    const minHeader = family === 0x774f4646 ? 44 : 48
    if (
      header.byteLength < minHeader ||
      header.getUint32(8) !== file.size ||
      !header.getUint16(12) ||
      header.getUint32(16) > 64 * MiB ||
      header.getUint32(16) < 12
    ) {
      throw new Error(
        'Invalid WOFF header or expanded font exceeds 64 MiB / WOFFのヘッダーまたは展開サイズが無効です',
      )
    }
    return
  }
  if (
    ![0x00010000, 0x4f54544f, 0x74727565].includes(family) ||
    !header.getUint16(4) ||
    12 + 16 * header.getUint16(4) > file.size
  ) {
    throw new Error('Unsupported font format / フォント形式が非対応です')
  }
}

const json = (value: unknown) => new Blob([JSON.stringify(value)], { type: 'application/json' })
const invalid = (message: string): never => {
  throw new Error(message)
}

export async function makeAssetId(file: Blob): Promise<string> {
  if (file.size > STORAGE_LIMITS.singleAsset) throw new Error('Asset exceeds the 768 MiB limit')
  const known = cache.get(file)
  if (known) return known
  const hashing = (async () => {
    const hash = sha256.create()
    const reader = file.stream().getReader()
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) return bytesToHex(hash.digest())
        hash.update(value)
      }
    } finally {
      reader.releaseLock()
      hash.destroy()
    }
  })()
  cache.set(file, hashing)
  try {
    return await hashing
  } catch (error) {
    cache.delete(file)
    throw error
  }
}

function layerAssets(layer: Layer) {
  const ids = [layer.imageId, layer.material.textureId, layer.text.fontId].filter(
    (id): id is string => id != null,
  )
  if (ids.some((id) => !idPattern.test(id))) throw new Error('Invalid layer asset identifier')
  return ids
}

export function referenced(project: Project): string[] {
  const ids = new Set<string>()
  const add = (id: string | null | undefined) => {
    if (id == null) return
    if (!idPattern.test(id)) throw new Error('Invalid asset identifier')
    ids.add(id)
  }
  add(project.mediaId)
  add(project.background.imageId)
  for (const layer of project.layers) for (const id of layerAssets(layer)) ids.add(id)
  if (ids.size > STORAGE_LIMITS.assets) throw new Error('Too many referenced assets (maximum 128)')
  return [...ids]
}
export function retiredAssetIds(
  discarded: readonly Project[],
  retained: readonly Project[],
): Set<string> {
  const candidates = new Set(discarded.flatMap(referenced))
  if (candidates.size) for (const p of retained) for (const id of referenced(p)) candidates.delete(id)
  return candidates
}
export function missingAssetIds(project: Project, assets: Assets): string[] {
  return referenced(project).filter((id) => !assets.has(id))
}
export async function relinkAsset(project: Project, assets: Assets, file: File): Promise<Assets> {
  const id = await makeAssetId(file)
  if (!missingAssetIds(project, assets).includes(id))
    throw new Error('The selected file does not match a missing asset')
  if (imageIds(project).has(id)) await validateImage(file)
  if (project.layers.some((layer) => layer.text.fontId === id)) await validateFont(file)
  return new Map(assets).set(id, file)
}

async function readJson(blob: Blob): Promise<unknown> {
  if (blob.size > STORAGE_LIMITS.json) throw new Error('Project settings exceed the 4 MiB limit')
  return JSON.parse(await blob.text())
}
function settingsBlob(value: unknown): Blob {
  const blob = json(value)
  if (blob.size > STORAGE_LIMITS.json) throw new Error('Project settings exceed the 4 MiB limit')
  return blob
}
export function savePreset(project: Project): Blob {
  const clean = parseProject(project)
  referenced(clean)
  return settingsBlob(clean)
}
export async function loadPreset(file: Blob): Promise<Project> {
  const project = parseProject(await readJson(file))
  referenced(project)
  return project
}
export function saveLayerPreset(layer: Layer): Blob {
  const clean = parseLayer({ ...layer, parentId: null })
  layerAssets(clean)
  return settingsBlob({ version: 1, kind: 'object', layer: clean })
}
export async function loadLayerPreset(blob: Blob): Promise<Layer> {
  const data = await readJson(blob)
  if (!isRecord(data) || data.version !== 1 || data.kind !== 'object')
    throw new Error('Unsupported object preset')
  const clean = parseLayer(data.layer)
  layerAssets(clean)
  return { ...clean, id: crypto.randomUUID(), parentId: null }
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
const safeName = (s: string) =>
  s.length > 0 && s.length <= 255 && s !== '.' && s !== '..' && !/[\\/\u0000-\u001f\u007f]/u.test(s)
function metadata(id: string, file: File): AssetRecord {
  if (!safeName(file.name)) throw new Error('Asset filename is unsafe or too long')
  return { id, name: file.name, size: file.size, type: file.type }
}
function imageIds(project: Project): Set<string | null> {
  return new Set([
    project.background.imageId,
    ...project.layers.flatMap((layer) => [layer.imageId, layer.material.textureId]),
  ])
}
export async function saveProject(project: Project, assets: Assets): Promise<Blob> {
  const clean = parseProject(project)
  const ids = referenced(clean)
  const records: AssetRecord[] = []
  let size = 0
  for (const id of ids) {
    const file = assets.get(id)
    if (!file) throw new Error('Relink every missing asset before saving the complete project')
    size += file.size
    if (size + STORAGE_LIMITS.json + MiB > STORAGE_LIMITS.archive)
      throw new Error('Project exceeds the 1 GiB archive limit')
    if ((await makeAssetId(file)) !== id) throw new Error('Asset content does not match its identifier')
    records.push(metadata(id, file))
  }
  const manifest = settingsBlob({ version: 1, format: 'avproj', project: clean, assets: records })
  const writer = new ZipWriter(new BlobWriter('application/zip'), {
    level: 0,
    useWebWorkers: false,
    zip64: false,
  })
  await writer.add('manifest.json', new BlobReader(manifest))
  for (const { id } of records) await writer.add('assets/' + id, new BlobReader(assets.get(id)!))
  return writer.close()
}

// This application writes single-disk ZIP32. Bound central-directory metadata before asking a
// general ZIP reader to enumerate it, including when a forged directory claims a huge size.
async function checkDirectory(file: Blob) {
  if (file.size > STORAGE_LIMITS.archive || file.size < 22)
    throw new Error('Invalid or oversized project archive')
  const tail = new DataView(await file.slice(-65557).arrayBuffer())
  for (let i = tail.byteLength - 22; i >= 0; --i) {
    if (
      tail.getUint32(i, true) !== 0x06054b50 ||
      i + 22 + tail.getUint16(i + 20, true) !== tail.byteLength
    )
      continue
    const count = tail.getUint16(i + 10, true)
    const bytes = tail.getUint32(i + 12, true)
    const offset = tail.getUint32(i + 16, true)
    if (
      count > STORAGE_LIMITS.assets + 1 ||
      count < 1 ||
      bytes > MiB ||
      tail.getUint32(i + 4, true) !== 0 ||
      tail.getUint16(i + 8, true) !== count ||
      offset + bytes !== file.size - tail.byteLength + i
    ) {
      throw new Error('Unsupported ZIP directory size or structure')
    }
    return
  }
  throw new Error('Invalid project ZIP directory')
}

async function unpack(entry: FileEntry, limit: number): Promise<Blob> {
  let actual = 0
  if (entry.uncompressedSize > limit) throw new Error('Oversized ZIP entry')
  const parts: Blob[] = []
  await entry.getData(
    new WritableStream<Uint8Array>({
      write(chunk) {
        actual += chunk.byteLength
        if (actual > limit || actual > entry.uncompressedSize)
          throw new Error('Invalid expanded ZIP length')
        parts.push(new Blob([new Uint8Array(chunk)]))
      },
    }),
    { checkCrc32: true, checkOverlappingEntry: true, useWebWorkers: false },
  )
  if (actual !== entry.uncompressedSize) throw new Error('Truncated ZIP entry')
  return new Blob(parts)
}
export async function loadProject(file: Blob): Promise<Snapshot> {
  await checkDirectory(file)
  const reader = new ZipReader(new BlobReader(file), {
    filenameValidation: 'strict',
    strictness: 'strict',
    useWebWorkers: false,
  })
  try {
    const entries = new Map<string, FileEntry>()
    let total = 0
    for await (const entry of reader.getEntriesGenerator()) {
      total += entry.uncompressedSize
      const name = entry.filename
      if (
        entry.directory ||
        entry.encrypted ||
        entry.symlink ||
        entries.has(name) ||
        (name !== 'manifest.json' && !/^assets\/[0-9a-f]{64}$/.test(name)) ||
        total > STORAGE_LIMITS.archive ||
        entry.uncompressedSize > STORAGE_LIMITS.singleAsset ||
        entries.size > STORAGE_LIMITS.assets
      )
        throw new Error('Unexpected or oversized ZIP entry')
      entries.set(name, entry)
    }
    const manifest = entries.get('manifest.json') ?? invalid('Missing project manifest')
    const data = await readJson(await unpack(manifest, STORAGE_LIMITS.json))
    if (!isRecord(data) || data.format !== 'avproj' || data.version !== 1 || !Array.isArray(data.assets))
      throw new Error('Unsupported project version')
    const project = parseProject(data.project)
    const ids = referenced(project)
    if (data.assets.length !== ids.length || entries.size !== ids.length + 1)
      throw new Error('Asset inventory mismatch')
    const assets: Assets = new Map()
    const images = imageIds(project)
    for (const record of data.assets) {
      if (
        !isRecord(record) ||
        typeof record.id !== 'string' ||
        !ids.includes(record.id) ||
        assets.has(record.id) ||
        typeof record.name !== 'string' ||
        !safeName(record.name) ||
        typeof record.type !== 'string' ||
        record.type.length > 128
      )
        throw new Error('Invalid asset record')
      const entry = entries.get('assets/' + record.id) ?? invalid('Missing archived asset')
      if (record.size !== entry.uncompressedSize) throw new Error('Asset size mismatch')
      const asset = new File([await unpack(entry, entry.uncompressedSize)], record.name, {
        type: record.type,
      })
      if ((await makeAssetId(asset)) !== record.id) throw new Error('Asset SHA-256 mismatch')
      if (images.has(record.id)) await validateImage(asset)
      if (project.layers.some((layer) => layer.text.fontId === record.id)) await validateFont(asset)
      assets.set(record.id, asset)
    }
    return { project, assets }
  } finally {
    await reader.close()
  }
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('av-studio-projects', 1)
    request.onupgradeneeded = () => {
      request.result.createObjectStore('assets')
      request.result.createObjectStore('project')
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}
function committed(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onabort = () =>
      reject(transaction.error ?? new Error('Local storage transaction aborted'))
  })
}
export async function saveAutosave(project: Project, assets: Assets): Promise<void> {
  const clean = parseProject(project)
  const active = new Set(referenced(clean))
  const db = await openDB()
  try {
    const tx = db.transaction(['project', 'assets'], 'readwrite')
    const settled = committed(tx)
    const store = tx.objectStore('assets')
    const keys = store.getAllKeys()
    keys.onsuccess = () => {
      const previous = new Set(keys.result)
      for (const id of previous) if (!active.has(String(id))) store.delete(id)
      for (const id of active) {
        const file = assets.get(id)
        if (file && !previous.has(id)) store.put(file, id)
      }
      tx.objectStore('project').put(clean, 'current')
    }
    await settled
  } finally {
    db.close()
  }
}
export async function restoreAutosave(): Promise<Snapshot | null> {
  const db = await openDB()
  try {
    const tx = db.transaction(['assets', 'project'])
    const stored = tx.objectStore('project').get('current')
    const assets: Assets = new Map()
    const cursor = tx.objectStore('assets').openCursor()
    cursor.onsuccess = () => {
      const item = cursor.result
      if (item) {
        assets.set(String(item.key), item.value)
        item.continue()
      }
    }
    await committed(tx)
    if (!stored.result) return null
    const project = parseProject(stored.result)
    referenced(project)
    return { project, assets }
  } finally {
    db.close()
  }
}
export async function clearAutosave(): Promise<void> {
  const db = await openDB()
  try {
    const tx = db.transaction(['assets', 'project'], 'readwrite')
    for (const name of ['assets', 'project']) tx.objectStore(name).clear()
    await committed(tx)
  } finally {
    db.close()
  }
}
export async function storageUsage(): Promise<StorageEstimate> {
  return (await navigator.storage?.estimate?.()) ?? {}
}
