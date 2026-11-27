import { useCallback, useEffect, useRef, useState } from 'react'
import { ProjectHistory, type Project } from '../model'
import { templates } from '../templates'
import {
  makeAssetId,
  referenced,
  retiredAssetIds,
  restoreAutosave,
  saveAutosave,
  validateFont,
  validateImage,
  type Assets,
} from '../storage'
import { openMedia, type MediaSourceData } from '../media'
import { imageMime } from '../validateImage'

export type Lang = 'en' | 'ja'
export const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error))
export function useStudio(notify: (message: string) => void) {
  const [history] = useState(() => new ProjectHistory(templates[0].create()))
  const [project, setProject] = useState(history.current)
  const [assets, setAssets] = useState<Assets>(new Map())
  const [ready, setReady] = useState(false)
  const [media, setMedia] = useState<MediaSourceData | null>(null)
  const [progress, setProgress] = useState<number | null>(null)
  const [saveState, setSaveState] = useState<'saving' | 'saved' | 'failed'>('saving')
  const [loadedRefs, setLoadedRefs] = useState('')
  const [images, setImages] = useState<Map<string, HTMLImageElement>>(new Map())
  const abortMedia = useRef<AbortController | null>(null)
  const staged = useRef<{ file: File; data: MediaSourceData } | null>(null)
  const importJob = useRef<AbortController | null>(null)
  const activeMedia = useRef<MediaSourceData | null>(null)
  // A validated font/image can finish loading just before its layer edit commits.
  // Keep it out of history-based collection until that edit has acquired it.
  const pendingAssets = useRef(new Map<string, File>())
  const autosaves = useRef(Promise.resolve())
  const edit = useCallback(
    (next: Project) => {
      if (next === history.current) return
      let refs: string[]
      try {
        refs = referenced(next)
      } catch (error) {
        notify(
          'Asset limit or invalid reference / 素材の上限または参照に問題があります · ' + errorText(error),
        )
        return
      }
      const additions = new Map<string, File>()
      for (const id of refs) {
        const file = pendingAssets.current.get(id)
        if (file) {
          additions.set(id, file)
          pendingAssets.current.delete(id)
        }
      }
      let retired = new Set<string>()
      history.commit(next, (discarded, retained) => {
        retired = retiredAssetIds(discarded, retained)
      })
      if (additions.size || retired.size)
        setAssets((previous) => {
          const result = new Map(previous)
          for (const id of retired) result.delete(id)
          for (const [id, file] of additions) result.set(id, file)
          return result
        })
      setSaveState('saving')
      setProject(history.current)
    },
    [history, notify],
  )
  const undo = useCallback(() => {
    if (history.canUndo) {
      setSaveState('saving')
      history.undo()
      setProject(history.current)
    }
  }, [history])
  const redo = useCallback(() => {
    if (history.canRedo) {
      setSaveState('saving')
      history.redo()
      setProject(history.current)
    }
  }, [history])
  const registerAsset = async (file: File, kind: 'image' | 'font', attach: (id: string) => void) => {
    if (kind === 'image') await validateImage(file)
    else await validateFont(file)
    const id = await makeAssetId(file)
    if (kind === 'font') {
      const face = new FontFace('asset-' + id, await file.arrayBuffer())
      await face.load()
      // Validate before assigning the asset. The effect below owns registration and cleanup.
    }
    pendingAssets.current.set(id, file)
    // Keep acquisition and the synchronous scene edit together. A discarded
    // layer selection or a rejected edit never retains the import.
    try {
      attach(id)
    } finally {
      pendingAssets.current.delete(id)
    }
  }
  useEffect(() => {
    let live = true
    const boot = async () => {
      let saved: Awaited<ReturnType<typeof restoreAutosave>> = null
      try {
        saved = await restoreAutosave()
      } catch (e) {
        notify(errorText(e))
      }
      if (!live) return
      if (saved) {
        setAssets(saved.assets)
        history.current = saved.project
        setProject(saved.project)
      } else {
        const response = await fetch('/demo/phase-drift.wav')
        if (!response.ok) throw Error('Demo audio ' + response.status)
        const file = new File([await response.blob()], 'Phase Drift.wav', { type: 'audio/wav' })
        const id = await makeAssetId(file)
        if (!live) return
        setAssets(new Map([[id, file]]))
        history.current = { ...history.current, mediaId: id }
        setProject(history.current)
      }
    }
    boot()
      .catch((e) => notify(errorText(e)))
      .finally(() => {
        if (live) setReady(true)
      })
    return () => {
      live = false
    }
  }, [history, edit, notify])
  const analysisKey = JSON.stringify(project.analysis)
  const source = project.mediaId ? assets.get(project.mediaId) : undefined
  useEffect(() => {
    const controller = new AbortController()
    abortMedia.current = controller
    activeMedia.current?.dispose()
    activeMedia.current = null
    setMedia(null)
    if (!source) {
      setProgress(null)
      return
    }
    if (staged.current?.file === source) {
      const data = staged.current.data
      staged.current = null
      activeMedia.current = data
      setMedia(data)
      setProgress(null)
      return
    }
    setProgress(0)
    openMedia(source, {
      signal: controller.signal,
      onProgress: (v) => {
        if (!controller.signal.aborted) setProgress(v)
      },
      analysis: JSON.parse(analysisKey),
    })
      .then((data) => {
        if (controller.signal.aborted) {
          data.dispose()
          return
        }
        activeMedia.current = data
        setMedia(data)
      })
      .catch((e) => {
        if (!controller.signal.aborted) notify(errorText(e))
      })
      .finally(() => {
        if (!controller.signal.aborted) setProgress(null)
      })
    return () => {
      controller.abort()
    }
  }, [source, analysisKey, notify])
  useEffect(
    () => () => {
      activeMedia.current?.dispose()
    },
    [],
  )
  useEffect(() => {
    if (!ready) return
    setSaveState('saving')
    let live = true
    const timer = setTimeout(() => {
      autosaves.current = autosaves.current
        .catch(() => {})
        .then(async () => {
          if (!live) return
          await saveAutosave(project, assets)
          if (live && history.current === project) setSaveState('saved')
        })
        .catch((e) => {
          if (live) {
            setSaveState('failed')
            notify(errorText(e))
          }
        })
    }, 600)
    return () => {
      live = false
      clearTimeout(timer)
    }
  }, [assets, project, ready, notify])
  // Asset references are SHA-256 IDs. Re-linking accepts renamed files without MIME metadata.
  const imageRefs = [
    ...new Set([
      project.background.imageId,
      ...project.layers.flatMap((layer) => [layer.imageId, layer.material.textureId]),
    ]),
  ]
    .filter(Boolean)
    .sort()
    .join(',')
  const fontRefs = [...new Set(project.layers.map((layer) => layer.text.fontId))]
    .filter(Boolean)
    .sort()
    .join(',')
  useEffect(() => {
    let live = true
    setLoadedRefs('')
    const imageIds = new Set(imageRefs.split(',')),
      fontIds = new Set(fontRefs.split(','))
    const urls: string[] = []
    const faces: FontFace[] = []
    const load = async () => {
      const next = new Map<string, HTMLImageElement>()
      for (const [id, file] of assets) {
        if (!live) return
        if (imageIds.has(id)) {
          const mime = await imageMime(file)
          if (!live) return
          const url = URL.createObjectURL(file.type === mime ? file : file.slice(0, file.size, mime))
          urls.push(url)
          const image = new Image()
          image.src = url
          await image.decode()
          next.set(id, image)
        } else if (fontIds.has(id)) {
          await validateFont(file)
          if (!live) return
          const face = await new FontFace('asset-' + id, await file.arrayBuffer()).load()
          if (live) {
            document.fonts.add(face)
            faces.push(face)
          }
        }
      }
      if (live) {
        setImages(next)
        setLoadedRefs(imageRefs + '|' + fontRefs)
      }
    }
    load().catch((e) => {
      if (live) notify(errorText(e))
    })
    return () => {
      live = false
      urls.forEach((url) => URL.revokeObjectURL(url))
      faces.forEach((face) => document.fonts.delete(face))
    }
  }, [assets, imageRefs, fontRefs, notify])
  async function importMedia(file: File) {
    importJob.current?.abort()
    const job = new AbortController()
    importJob.current = job
    setProgress(0)
    try {
      const data = await openMedia(file, {
        signal: job.signal,
        analysis: history.current.analysis,
        onProgress: (v) => {
          if (!job.signal.aborted) setProgress(v)
        },
      })
      try {
        const id = await makeAssetId(file)
        job.signal.throwIfAborted()
        if (source === file && history.current.mediaId === id) {
          data.dispose()
          return
        }
        const replacement = { ...history.current, mediaId: id, range: null }
        referenced(replacement)
        staged.current?.data.dispose()
        staged.current = { file, data }
        setAssets((old) => new Map(old).set(id, file))
        edit(replacement)
      } catch (e) {
        data.dispose()
        throw e
      }
    } finally {
      if (importJob.current === job) {
        importJob.current = null
        setProgress(null)
      }
    }
  }
  return {
    visualAssetsReady: (!imageRefs && !fontRefs) || loadedRefs === imageRefs + '|' + fontRefs,
    importMedia,
    history,
    project,
    edit,
    undo,
    redo,
    assets,
    setAssets,
    ready,
    media,
    progress,
    images,
    saveState,
    registerAsset,
    cancelAnalysis: () => {
      if (importJob.current) importJob.current.abort()
      else abortMedia.current?.abort()
      setProgress(null)
    },
  }
}
