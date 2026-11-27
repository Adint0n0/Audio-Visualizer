import { describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'
import { BlobReader, BlobWriter, ZipWriter } from '@zip.js/zip.js/index-native.js'
import { createProject } from '../src/model'
import {
  loadLayerPreset,
  loadPreset,
  loadProject,
  makeAssetId,
  missingAssetIds,
  relinkAsset,
  saveLayerPreset,
  savePreset,
  saveProject,
  validateFont,
  validateImage,
} from '../src/storage'

async function archive(files: Record<string, Blob>) {
  const writer = new ZipWriter(new BlobWriter(), { level: 0, useWebWorkers: false, zip64: false })
  for (const [name, file] of Object.entries(files)) await writer.add(name, new BlobReader(file))
  return writer.close()
}

describe('local project format', () => {
  it('round-trips settings and verifies content-addressed media', async () => {
    const p = createProject('日本語 \u266a')
    const media = new File(['a test recording'], '曲.wav', { type: 'audio/wav' })
    p.mediaId = await makeAssetId(media)
    const archive = await saveProject(p, new Map([[p.mediaId, media]]))
    const recovered = await loadProject(archive)
    expect(recovered.project).toEqual(p)
    const file = recovered.assets.get(p.mediaId)!
    expect([file.name, file.type, await file.text()]).toEqual(['曲.wav', 'audio/wav', await media.text()])
  })
  it('exports a scene without media and assigns new identifiers to imported objects', async () => {
    const p = createProject()
    expect(await loadPreset(savePreset(p))).toEqual(p)
    expect((await loadProject(await saveProject(p, new Map()))).project).toEqual(p)
    const layer = await loadLayerPreset(saveLayerPreset(p.layers[0]))
    expect(layer.id).not.toBe(p.layers[0].id)
    expect({ ...layer, id: p.layers[0].id }).toEqual(p.layers[0])
  })
  it('relinks only byte-identical files and rejects incomplete bundles', async () => {
    const project = createProject()
    const file = new File(['a'], 'song.mp3')
    project.mediaId = await makeAssetId(file)
    expect(missingAssetIds(project, new Map())).toEqual([project.mediaId])
    await expect(saveProject(project, new Map())).rejects.toThrow(/Relink/)
    await expect(relinkAsset(project, new Map(), new File(['b'], 'song.mp3'))).rejects.toThrow(/match/)
    expect((await relinkAsset(project, new Map(), file)).get(project.mediaId)).toBe(file)
  })
  it('rejects tampering even when the ZIP checksum is valid', async () => {
    const project = createProject()
    const id = (project.mediaId = '0'.repeat(64))
    const manifest = new Blob([
      JSON.stringify({
        version: 1,
        format: 'avproj',
        project,
        assets: [{ id, name: 'a.mp3', size: 1, type: 'audio/mpeg' }],
      }),
    ])
    const data = await archive({ 'manifest.json': manifest, ['assets/' + id]: new Blob(['a']) })
    await expect(loadProject(data)).rejects.toThrow(/SHA-256/)
  })
  it('rejects corrupt ZIP, invalid paths, malformed or wrong-version JSON', async () => {
    await expect(loadProject(new Blob(['bad']))).rejects.toThrow()
    const malformed = await archive({ 'not-allowed.txt': new Blob(['bogus']) })
    await expect(loadProject(malformed)).rejects.toThrow(/unexpected/i)
    await expect(loadPreset(new Blob(['{']))).rejects.toThrow()
    await expect(loadPreset(new Blob(['{"version":99}']))).rejects.toThrow()
  })
  it('rejects dangling malformed identifiers before a layer reaches the editor', async () => {
    const layer = createProject().layers[0]
    layer.material.textureId = 'unhashed'
    const preset = new Blob([JSON.stringify({ version: 1, kind: 'object', layer })])
    await expect(loadLayerPreset(preset)).rejects.toThrow(/asset identifier/)
  })
  it('round-trips a bundled font and checks WOFF expanded length before decode', async () => {
    const source = await readFile(
      'node_modules/@fontsource-variable/dm-sans/files/dm-sans-latin-wght-normal.woff2',
    )
    const font = new File([new Uint8Array(source)], 'caption.woff2', { type: 'font/woff2' })
    await validateFont(font)
    const project = createProject()
    const id = await makeAssetId(font)
    project.layers[0].text.fontId = id
    const result = await loadProject(await saveProject(project, new Map([[id, font]])))
    expect(await makeAssetId(result.assets.get(id)!)).toBe(id)
    const inflated = new Uint8Array(source)
    new DataView(inflated.buffer).setUint32(16, 128 * 1024 * 1024)
    await expect(validateFont(new Blob([inflated]))).rejects.toThrow(/64 MiB/)
  })
  it('detects oversized images before decoding and rejects a bogus image MIME', async () => {
    const png = new Uint8Array(24)
    png.set([137, 80, 78, 71, 13, 10, 26, 10], 0)
    png.set([73, 72, 68, 82], 12)
    const header = new DataView(png.buffer)
    header.setUint32(16, 16000)
    header.setUint32(20, 16000)
    await expect(validateImage(new Blob([png]))).rejects.toThrow(/dimensions/)
    await expect(validateImage(new Blob(['xxx'], { type: 'image/png' }))).rejects.toThrow()
  })
})
