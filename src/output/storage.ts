import { StreamTarget, type StreamTargetChunk } from 'mediabunny'

const PAGE = 1024 * 1024
const RAM_LIMIT = 96 * PAGE

export interface ExportStorage {
  target: StreamTarget
  finish(mime: string): Promise<Blob>
  dispose(): Promise<void>
}

/** OPFS accepts positional writes, including the final MP4 and WebM seek table patches. */
export async function openExportStorage(estimatedBytes: number): Promise<ExportStorage> {
  const estimate = await navigator.storage?.estimate?.().catch(() => undefined)
  if (
    estimate?.quota !== undefined &&
    estimate.usage !== undefined &&
    estimate.quota - estimate.usage < estimatedBytes * 1.2
  ) {
    throw new Error('Insufficient storage / 空き容量が不足しています')
  }
  let directory: FileSystemDirectoryHandle | undefined
  try {
    directory = await navigator.storage?.getDirectory?.()
  } catch {
    /* bounded RAM fallback */
  }
  if (directory) {
    const name = 'formant-export-' + crypto.randomUUID()
    const handle = await directory.getFileHandle(name, { create: true })
    try {
      const writable = await handle.createWritable()
      return {
        target: new StreamTarget(writable, { chunked: true, chunkSize: PAGE }),
        async finish(mime) {
          const file = await handle.getFile()
          return file.slice(0, file.size, mime)
        },
        async dispose() {
          try {
            await writable.abort()
          } catch {
            /* muxer already closed the stream */
          }
          await directory.removeEntry(name).catch((error) => {
            if (!(error instanceof DOMException && error.name === 'NotFoundError')) throw error
          })
        },
      }
    } catch (error) {
      await directory.removeEntry(name)
      if (!(
        error instanceof TypeError ||
        (error instanceof DOMException && error.name === 'NotSupportedError')
      ))
        throw error
    }
  }
  if (estimatedBytes > RAM_LIMIT)
    throw new Error(
      'Disk-backed export unavailable; reduce range or bitrate / 保存領域が使えません。範囲かビットレートを下げてください',
    )
  const pages: Uint8Array<ArrayBuffer>[] = []
  let length = 0
  const stream = new WritableStream<StreamTargetChunk>({
    write({ position, data }) {
      const end = position + data.length
      if (end > RAM_LIMIT) throw new Error('Memory export limit / メモリ書き出しの上限を超えました')
      for (let offset = 0; offset < data.length;) {
        const page = Math.floor((position + offset) / PAGE)
        const inside = (position + offset) % PAGE
        const count = Math.min(PAGE - inside, data.length - offset)
        while (pages.length <= page) pages.push(new Uint8Array(PAGE))
        pages[page].set(data.subarray(offset, offset + count), inside)
        offset += count
      }
      length = Math.max(length, end)
    },
  })
  return {
    target: new StreamTarget(stream, { chunked: true, chunkSize: PAGE }),
    async finish(mime) {
      return new Blob(pages, { type: mime }).slice(0, length, mime)
    },
    async dispose() {
      pages.length = 0
    },
  }
}
