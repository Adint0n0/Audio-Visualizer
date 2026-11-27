import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Box,
  Check,
  CheckCheck,
  ChevronDown,
  CircleHelp,
  Download,
  FileJson,
  FolderOpen,
  Globe2,
  HardDrive,
  Layers as LayersIcon,
  LayoutGrid,
  LoaderCircle,
  Pencil,
  Redo2,
  Save,
  SlidersHorizontal,
  Undo2,
  Upload,
  X,
} from 'lucide-react'
import { AnalysisPanel } from './AnalysisPanel'
import { ExportDialog } from './ExportDialog'
import { OfflineStatus } from './OfflineStatus'
import { Layers } from './Layers'
import { Inspector } from './Inspector'
import { SceneRenderer } from './scene'
import { silentFrame } from './analysis'
import { resolveRange, type Project } from './model'
import {
  clearAutosave,
  loadPreset,
  loadProject,
  missingAssetIds,
  relinkAsset,
  savePreset,
  saveProject,
  storageUsage,
} from './storage'
import { templates, type Colorway } from './templates'
import { Dialog } from './studio/Dialog'
import { Library, type SceneTemplate } from './studio/Library'
import { Timeline } from './studio/Timeline'
import { Viewport } from './studio/Viewport'
import { useStudio, errorText, type Lang } from './studio/hooks'

const mediaAccept = 'audio/*,video/*,.wav,.mp3,.flac,.aac,.m4a,.oga,.ogg,.opus,.mp4,.m4v,.webm,.mov'
function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob),
    a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 60000)
}
export default function App() {
  const [lang, setLang] = useState<Lang>(() => {
    try {
      const l = localStorage.getItem('formant-lang')
      if (l === 'en' || l === 'ja') return l
    } catch {
      /* use locale */
    }
    return navigator.language.startsWith('ja') ? 'ja' : 'en'
  })
  const ja = lang === 'ja',
    t = (en: string, jp: string) => (ja ? jp : en)
  const [message, notify] = useState(''),
    [fileDialog, setFileDialog] = useState(false),
    [help, setHelp] = useState(false),
    [exporting, setExporting] = useState(false)
  const studio = useStudio(notify)
  const { project, media, edit, assets, setAssets, images, progress, history } = studio
  const [selection, select] = useState<string[]>(() => [project.layers[0]?.id].filter(Boolean))
  const [libraryTab, setLibraryTab] = useState<'library' | 'layers'>('library'),
    [mobile, setMobile] = useState<'stage' | 'library' | 'layers' | 'inspector'>('stage'),
    [sheetTall, setSheetTall] = useState(false),
    [advanced, setAdvanced] = useState(false)
  const [activeTemplate, setActiveTemplate] = useState(templates[0].id),
    [transient, setTransient] = useState<Project | null>(null)
  const range = useMemo(
    () => resolveRange(project.range, media?.duration || 0),
    [project.range, media?.duration],
  )
  const [time, setTime] = useState(0),
    [playing, setPlaying] = useState(false),
    [loop, setLoop] = useState(false),
    [mute, setMute] = useState(false)
  const [quota, setQuota] = useState<StorageEstimate>({}),
    [busy, setBusy] = useState(false),
    [cleared, setCleared] = useState(false)
  const mediaInput = useRef<HTMLInputElement>(null),
    openInput = useRef<HTMLInputElement>(null),
    linkInput = useRef<HTMLInputElement>(null),
    video = useRef<HTMLVideoElement>(null)
  const app = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const viewport = window.visualViewport
    if (!viewport) return
    const resize = () => {
      if (!app.current) return
      if (viewport.scale !== 1) {
        app.current.style.removeProperty('--visible-height')
        return
      }
      app.current.style.setProperty('--visible-height', Math.round(viewport.height) + 'px')
      const keyboard = innerHeight - viewport.height > 100
      app.current.classList.toggle('keyboard-inset', keyboard)
      if (keyboard)
        requestAnimationFrame(() => {
          const input = document.activeElement
          if (!(input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement)) return
          const scroll = input.closest<HTMLElement>('.dock-scroll, dialog, .export-modal')
          if (!scroll) return
          const area = scroll.getBoundingClientRect()
          const control = input.getBoundingClientRect()
          const bottom = Math.min(area.bottom, viewport.height + viewport.offsetTop) - 12
          if (control.bottom > bottom) scroll.scrollTop += control.bottom - bottom
          else if (control.top < area.top + 12) scroll.scrollTop -= area.top + 12 - control.top
        })
    }
    resize()
    viewport.addEventListener('resize', resize)
    return () => viewport.removeEventListener('resize', resize)
  }, [])
  const current = useRef(project)
  current.current = project
  const [dragRange, previewRange] = useState<[number, number] | null>(null)
  const display = transient || project
  const setProject = useCallback(
    (next: Project) => {
      setTransient(null)
      setCleared(false)
      edit(next)
    },
    [edit],
  )
  useEffect(() => {
    setTransient(null)
    setCleared(false)
    select((ids) => {
      if (!ids.length) return ids
      const retained = ids.filter((id) => project.layers.some((l) => l.id === id))
      return retained.length ? retained : project.layers.slice(0, 1).map((l) => l.id)
    })
  }, [project])
  useEffect(() => {
    document.documentElement.lang = lang
    try {
      localStorage.setItem('formant-lang', lang)
    } catch {
      /* use current language */
    }
  }, [lang])
  useEffect(() => {
    if (fileDialog)
      storageUsage()
        .then(setQuota)
        .catch((e) => notify(errorText(e)))
  }, [fileDialog])
  useEffect(() => {
    setTime(0)
    setPlaying(false)
    if (media?.isHDR) notify('HDR → SDR / SDR プレビュー・出力')
    if (media && !media.hasAudio) notify('Silent video · 音声トラックがありません')
  }, [media])
  const clock = useRef({ url: '', offset: 0, calibrating: false, pending: 0 })
  const earlySeek = useRef<{ url: string; time: number } | null>(null)
  const nativeOffset = () => (clock.current.url === media?.url ? clock.current.offset : 0)
  const sourceTime = (el: HTMLVideoElement) =>
    Math.max(0, Math.min(media?.duration ?? 0, el.currentTime - nativeOffset()))
  const calibrate = (el: HTMLVideoElement) => {
    if (!media || el.currentSrc !== media.url || clock.current.url === media.url) return
    const probe = media.startTimestamp > 0
    const pending = earlySeek.current?.url === media.url ? earlySeek.current.time : 0
    earlySeek.current = null
    clock.current = { url: media.url, offset: 0, calibrating: probe, pending }
    // Native containers can expose either normalized time or their original positive PTS.
    // A seek to the beginning reveals the earliest playable timestamp on this browser.
    if (probe) el.currentTime = 0
    else if (pending > 0) el.currentTime = pending
  }
  const finishSeek = (el: HTMLVideoElement) => {
    if (!media || el.currentSrc !== media.url) return
    const c = clock.current
    if (c.url === media.url && c.calibrating) {
      c.calibrating = false
      const nativePts = Math.abs(el.currentTime - media.startTimestamp) < Math.abs(el.currentTime)
      c.offset = nativePts ? media.startTimestamp : 0
      if (c.pending > 0) {
        el.currentTime = c.offset + c.pending
        return
      }
    }
    setTime(sourceTime(el))
  }
  const seek = (value: number) => {
    const next = Math.max(0, Math.min(media?.duration || 0, value)),
      el = video.current
    if (el && media) {
      if (clock.current.url !== media.url) earlySeek.current = { url: media.url, time: next }
      else if (clock.current.calibrating) clock.current.pending = next
      else
        try {
          el.currentTime = nativeOffset() + next
        } catch (e) {
          notify(errorText(e))
        }
    }
    setTime(next)
  }
  const toggle = () => {
    const el = video.current
    if (!el || !media) return
    if (!el.paused) {
      el.pause()
      return
    }
    const at = sourceTime(el)
    if (at < range[0] || at >= range[1] - 0.001) seek(range[0])
    el.play().catch((e) => notify(errorText(e)))
  }
  useEffect(() => {
    if (!playing || !video.current || !media) return
    const el = video.current
    let id = 0,
      last = 0
    const tick = (now: number) => {
      if (now - last >= 1000 / 60 && !clock.current.calibrating) {
        last = now
        const offset = clock.current.url === media.url ? clock.current.offset : 0
        const t = el.currentTime - offset
        if (t >= range[1]) {
          if (loop) {
            el.currentTime = offset + range[0]
            void el.play().catch((e) => notify(errorText(e)))
          } else {
            el.pause()
            el.currentTime = offset + range[1]
          }
        }
        setTime(Math.max(0, Math.min(media.duration, el.currentTime - offset)))
      }
      id = requestAnimationFrame(tick)
    }
    id = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(id)
  }, [playing, loop, range, media])
  async function run(fn: () => Promise<void>) {
    setBusy(true)
    try {
      await fn()
    } catch (e) {
      notify(errorText(e))
    } finally {
      setBusy(false)
    }
  }
  const importSource = studio.importMedia
  async function openFile(file: File) {
    const restored = /\.json$/i.test(file.name)
      ? { project: await loadPreset(file), assets }
      : await loadProject(file)
    setAssets((old) => new Map([...old, ...restored.assets]))
    setProject(restored.project)
    setActiveTemplate('')
    setFileDialog(false)
    setMobile('stage')
    if (missingAssetIds(restored.project, restored.assets).length)
      notify(
        t(
          'Open Project files to relink the original assets.',
          'プロジェクトメニューから元の素材を再リンクしてください。',
        ),
      )
  }
  function apply(item: SceneTemplate, append: boolean, colorway?: Colorway) {
    const scene = item.create(colorway)
    if (append && project.layers.length + scene.layers.length > 128) {
      notify(t('A scene supports up to 128 layers.', 'レイヤーは128個まで追加できます。'))
      return
    }
    // Fresh identities keep repeated inserts and internal parent references independent.
    const ids = new Map(scene.layers.map((l) => [l.id, crypto.randomUUID()]))
    const layers = scene.layers.map((l) => ({
      ...l,
      id: ids.get(l.id)!,
      parentId: l.parentId ? ids.get(l.parentId) || null : null,
    }))
    setProject(
      append
        ? { ...project, layers: [...project.layers, ...layers] }
        : {
            ...scene,
            mediaId: project.mediaId,
            analysis: project.analysis,
            range: project.range,
            output: project.output,
            layers,
          },
    )
    select(layers[0] ? [layers[0].id] : [])
    setActiveTemplate(append ? '' : item.id)
    setMobile('stage')
  }
  const saveFull = () =>
    run(async () => {
      download(await saveProject(project, assets), project.name + '.avproj')
    })
  useEffect(() => {
    const handle = (e: KeyboardEvent) => {
      if (e.defaultPrevented || fileDialog || help || exporting || document.querySelector('dialog[open]'))
        return
      const target = e.target as HTMLElement
      if (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        if (e.shiftKey) studio.redo()
        else studio.undo()
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault()
        void saveFull()
      } else if (e.code === 'Space' && target.tagName !== 'BUTTON') {
        e.preventDefault()
        toggle()
      }
    }
    window.addEventListener('keydown', handle)
    return () => window.removeEventListener('keydown', handle)
  })
  function createRenderer(width: number, height: number, times: Iterable<number>) {
    const canvas = document.createElement('canvas'),
      r = new SceneRenderer(canvas)
    r.resize(width, height)
    const frames = media?.hasVideo ? media.videoFrames(times) : undefined
    return {
      canvas,
      async renderFrame(t: number) {
        const decoded = await frames?.next()
        if (decoded?.done)
          throw Error('Video frame iterator ended early / 映像を最後までデコードできませんでした')
        const background = frames ? (decoded?.value ?? null) : images.get(project.background.imageId || '')
        r.render(project, t, media?.frame(t) || silentFrame, { images, background, frameAt: media?.frame })
      },
      async dispose() {
        try {
          await frames?.return()
        } finally {
          r.dispose()
        }
      },
    }
  }
  const timing = useRef({ media, time })
  timing.current = { media, time }
  const getAudioFrame = useCallback(() => timing.current.media?.frame(timing.current.time), [])
  const library = useMemo(
    () => <Library lang={lang} active={activeTemplate} apply={apply} />,
    [lang, activeTemplate, project],
  )
  const inspector = useMemo(
    () => (
      <Inspector
        lang={lang}
        project={project}
        selection={selection}
        onSelect={select}
        onChange={setProject}
        advanced={advanced}
        getAudioFrame={getAudioFrame}
        onPreview={setTransient}
        onAsset={studio.registerAsset}
        backgroundIsVideo={media?.hasVideo}
        analysisPanel={
          <AnalysisPanel
            lang={lang}
            settings={project.analysis}
            busy={progress !== null}
            onApply={(analysis) => setProject({ ...project, analysis })}
          />
        }
      />
    ),
    [lang, project, selection, advanced, media?.hasVideo, progress, getAudioFrame, setProject],
  )
  const panel = { lang, project, selection, onSelect: select, onChange: setProject, advanced }
  const missing = missingAssetIds(project, assets)
  return (
    <div
      ref={app}
      className={
        'app mobile-' + mobile + (mobile === 'stage' ? '' : ' sheet-open') + (sheetTall ? ' sheet-tall' : '')
      }
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) e.preventDefault()
      }}
      onDrop={(e) => {
        const file = e.dataTransfer.files[0]
        if (!file) return
        e.preventDefault()
        void run(() => (/\.(json|avproj)$/i.test(file.name) ? openFile(file) : importSource(file)))
      }}
    >
      <header className="appbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            {[12, 22, 30, 18, 10].map((h, i) => (
              <i style={{ height: h }} key={i} />
            ))}
          </span>
          <span>
            Formant<span className="brand-period">.</span>
          </span>
        </div>
        <span className="brand-divider" />
        <button
          className="project-menu"
          aria-label={t('Project files', 'プロジェクト')}
          onClick={() => setFileDialog(true)}
        >
          <FolderOpen size={15} />
          <span>{project.name}</span>
          <ChevronDown size={12} />
        </button>
        <div className="bar-actions">
          <button
            className="icon-btn undo"
            disabled={!history.canUndo}
            title={t('Undo', '元に戻す')}
            onClick={studio.undo}
          >
            <Undo2 size={16} />
          </button>
          <button
            className="icon-btn undo"
            disabled={!history.canRedo}
            title={t('Redo', 'やり直す')}
            onClick={studio.redo}
          >
            <Redo2 size={16} />
          </button>
          <span className="bar-divider" />
          <button
            className="language"
            title={t('日本語に切り替え', 'Switch to English')}
            onClick={() => setLang(ja ? 'en' : 'ja')}
          >
            <Globe2 size={15} />
            {ja ? 'JA' : 'EN'}
          </button>
          <button
            className="btn import-btn"
            aria-label={t('Import media', '素材を読み込む')}
            onClick={() => mediaInput.current?.click()}
          >
            <Upload size={15} />
            <span>{t('Import media', '素材を読み込む')}</span>
          </button>
          <button
            className="btn primary export-btn"
            disabled={!media || busy || missing.length > 0 || !studio.visualAssetsReady}
            title={
              missing.length
                ? t(
                    'Relink missing project assets to export.',
                    '書き出す前に不足素材を再リンクしてください。',
                  )
                : undefined
            }
            onClick={() => {
              video.current?.pause()
              setExporting(true)
            }}
          >
            <Download size={15} />
            {t('Export', '書き出し')}
          </button>
        </div>
      </header>
      <main className="editor">
        <aside className="left-dock">
          <nav className="dock-tabs">
            <button
              className={libraryTab === 'library' ? 'selected' : ''}
              onClick={() => setLibraryTab('library')}
            >
              <LayoutGrid size={15} />
              {t('Library', 'ライブラリ')}
            </button>
            <button
              className={libraryTab === 'layers' ? 'selected' : ''}
              onClick={() => setLibraryTab('layers')}
            >
              <LayersIcon size={15} />
              {t('Layers', 'レイヤー')}
            </button>
          </nav>
          <div className="sheet-heading">
            <button className="sheet-size" onClick={() => setSheetTall(!sheetTall)} aria-expanded={sheetTall}>
              <ChevronDown size={17} />
              {sheetTall ? t('Shorter panel', 'パネルを縮める') : t('More room', 'パネルを広げる')}
            </button>
            <button
              className="icon-btn"
              aria-label={t('Close panel', 'パネルを閉じる')}
              onClick={() => setMobile('stage')}
            >
              <X size={19} />
            </button>
          </div>
          <div className="dock-scroll" key={libraryTab}>
            {libraryTab === 'library' ? library : <Layers {...panel} />}
          </div>
        </aside>
        <Viewport
          project={display}
          media={media}
          video={video}
          images={images}
          time={time}
          lang={lang}
          selection={selection}
          onSelect={select}
          edit={setProject}
          notify={notify}
          pauseRender={exporting}
          undo={studio.undo}
          redo={studio.redo}
          canUndo={history.canUndo}
          canRedo={history.canRedo}
        />
        <aside className="right-dock">
          <div className="inspector-top">
            <button className="sheet-size" onClick={() => setSheetTall(!sheetTall)} aria-expanded={sheetTall}>
              <ChevronDown size={16} />
              <span>{sheetTall ? t('Shorter', '縮小') : t('Expand', '拡張')}</span>
            </button>
            <h2>
              <SlidersHorizontal size={16} />
              {t('Inspector', 'プロパティ')}
            </h2>
            <button
              className={'advanced-btn ' + (advanced ? 'on' : '')}
              onClick={() => setAdvanced(!advanced)}
              aria-pressed={advanced}
            >
              <span className="mini-switch" />
              {t('Advanced', '詳細')}
            </button>
            <button
              className="icon-btn sheet-close"
              aria-label={t('Close panel', 'パネルを閉じる')}
              onClick={() => setMobile('stage')}
            >
              <X size={18} />
            </button>
          </div>
          <div className="dock-scroll">{inspector}</div>
        </aside>
      </main>
      <Timeline
        lang={lang}
        media={media}
        time={time}
        playing={playing}
        play={toggle}
        seek={seek}
        range={dragRange ?? range}
        previewRange={previewRange}
        setRange={(next) => {
          previewRange(null)
          setProject({ ...current.current, range: next })
        }}
        loop={loop}
        setLoop={setLoop}
        mute={mute}
        setMute={setMute}
        importFile={() => mediaInput.current?.click()}
      />
      <nav className="mobile-tabs" aria-label={t('Editor panels', '編集パネル')}>
        {(
          [
            ['library', LayoutGrid, t('Scenes', 'シーン')],
            ['layers', LayersIcon, t('Layers', 'レイヤー')],
            ['inspector', SlidersHorizontal, t('Edit', '編集')],
            ['stage', Box, t('Preview', 'プレビュー')],
          ] as const
        ).map(([id, Icon, label]) => (
          <button
            key={id}
            data-sheet={id}
            aria-pressed={mobile === id}
            onClick={() => {
              if (id === 'library' || id === 'layers') setLibraryTab(id)
              setMobile(mobile === id ? 'stage' : id)
            }}
          >
            <Icon size={17} />
            {label}
          </button>
        ))}
      </nav>
      <footer className="statusbar">
        <span>
          <i className="local-light" />
          {t('Local workspace', 'ローカルワークスペース')}
        </span>
        <span className="status-save">
          <CheckCheck size={12} />
          {cleared
            ? t('Local save cleared', '保存データを削除済み')
            : studio.saveState === 'saved'
              ? t('Autosaved', '自動保存済み')
              : studio.saveState === 'saving'
                ? t('Saving…', '保存中…')
                : t('Save failed', '保存失敗')}
        </span>
        <button onClick={() => setHelp(true)}>
          <CircleHelp size={13} />
          {t('Guide', 'ガイド')}
        </button>
      </footer>
      <video
        hidden
        playsInline
        preload="auto"
        ref={video}
        src={media?.url}
        muted={mute}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => {
          if (loop && video.current) {
            seek(range[0])
            void video.current.play().catch((e) => notify(errorText(e)))
          } else setTime(media?.duration || 0)
        }}
        onLoadedData={(e) => calibrate(e.currentTarget)}
        onSeeked={(e) => finishSeek(e.currentTarget)}
        onError={() => {
          if (media)
            notify(t('The browser could not play this source.', 'このブラウザでは素材を再生できません。'))
        }}
      />
      <input
        hidden
        type="file"
        ref={mediaInput}
        accept={mediaAccept}
        onChange={(e) => {
          const file = e.target.files?.[0]
          e.target.value = ''
          if (file) void run(() => importSource(file))
        }}
      />
      <input
        hidden
        type="file"
        ref={openInput}
        accept=".avproj,.json"
        onChange={(e) => {
          const f = e.target.files?.[0]
          e.target.value = ''
          if (f) void run(() => openFile(f))
        }}
      />
      <input
        hidden
        type="file"
        ref={linkInput}
        multiple
        onChange={(e) => {
          const files = Array.from(e.target.files || [])
          e.target.value = ''
          void run(async () => {
            let next = assets
            for (const f of files) next = await relinkAsset(project, next, f)
            setAssets(next)
          })
        }}
      />
      {(progress !== null || busy) && (
        <div className="job-status" role="status">
          <LoaderCircle className="spin" size={16} />
          {progress === null
            ? t('Processing…', '処理中…')
            : t('Analyzing audio', '音声解析中') + ' ' + Math.round(progress * 100) + '%'}
          {progress !== null && (
            <button className="icon-btn" title={t('Cancel', '中止')} onClick={studio.cancelAnalysis}>
              <X size={15} />
            </button>
          )}
        </div>
      )}
      {message && (
        <div className="notice" role="alert">
          {message}
          <button className="icon-btn" title={t('Dismiss', '閉じる')} onClick={() => notify('')}>
            <X size={14} />
          </button>
        </div>
      )}
      {fileDialog && (
        <Dialog title={t('Project files', 'プロジェクト')} lang={lang} close={() => setFileDialog(false)}>
          <label className="rename">
            <Pencil size={15} />
            <input
              key={project.name}
              aria-label={t('Project name', 'プロジェクト名')}
              defaultValue={project.name}
              maxLength={128}
              onBlur={(e) => {
                const name = e.target.value.trim()
                if (name && name !== project.name) setProject({ ...project, name })
              }}
            />
          </label>
          <div className="file-actions">
            <button onClick={() => openInput.current?.click()}>
              <FolderOpen />
              {t('Open project or scene preset', 'プロジェクト・シーン設定を開く')}
            </button>
            <button onClick={saveFull} disabled={busy || !!missing.length}>
              <Save />
              {t('Save project with assets (.avproj)', '素材を含めて保存 (.avproj)')}
            </button>
            <button onClick={() => download(savePreset(project), project.name + '.json')}>
              <FileJson />
              {t('Save scene settings (.json)', 'シーン設定を保存 (.json)')}
            </button>
            {missing.length > 0 && (
              <button onClick={() => linkInput.current?.click()}>
                <Upload />
                {t('Relink missing files', '不足素材を再リンク')} ({missing.length})
              </button>
            )}
          </div>
          <button
            className="btn project-guide"
            onClick={() => {
              setFileDialog(false)
              setHelp(true)
            }}
          >
            <CircleHelp size={16} />
            {t('Studio guide', '使い方')}
          </button>
          <p className="storage-info">
            <HardDrive size={14} />
            {t('Browser storage', 'ブラウザの保存領域')} · {((quota.usage || 0) / 1048576).toFixed(1)} MiB
          </p>
          <button
            className="text-btn"
            disabled={cleared || studio.saveState === 'saving'}
            onClick={() =>
              void run(async () => {
                await clearAutosave()
                setCleared(true)
              })
            }
          >
            {cleared ? <Check size={14} /> : null}
            {t('Clear local autosave', '自動保存データを削除')}
          </button>
        </Dialog>
      )}
      {help && (
        <Dialog title={t('Studio guide', '使い方')} lang={lang} close={() => setHelp(false)}>
          <OfflineStatus lang={lang} />
          <ol className="quick-guide">
            {[
              t(
                'Import a local song or video. Dragging a file into the studio also opens it.',
                '楽曲や動画を読み込みます。ファイルを画面にドロップしても開けます。',
              ),
              t(
                'Pick a library scene to preview it, then replace the scene or append its layers.',
                'ライブラリでプレビューし、シーンを置換するかレイヤーを追加します。',
              ),
              t(
                'Tap a layer, then drag to move it. Use two fingers to resize or twist. Open Edit to change color and sound response.',
                'レイヤーをタップしてドラッグで移動し、2本指で拡縮や回転ができます。「編集」から色や音への反応を変更できます。',
              ),
              t(
                'Play to check the motion. Set Range in the timeline, then open Export and choose a video format.',
                '再生して動きを確認します。タイムラインで範囲を選び、書き出し画面で動画の形式を指定します。',
              ),
              t(
                'Save a portable project from the project menu. Ctrl/Cmd+S saves it, and Ctrl/Cmd+Z undoes an edit.',
                'プロジェクトメニューまたは Ctrl/Cmd+S で素材ごと保存できます。Ctrl/Cmd+Z で編集を取り消します。',
              ),
            ].map((line, i) => (
              <li key={i}>{line}</li>
            ))}
          </ol>
        </Dialog>
      )}
      {exporting && (
        <ExportDialog
          lang={lang}
          name={project.name}
          media={media}
          duration={media?.duration || 0}
          sourceSize={media?.hasVideo ? [media.width, media.height] : undefined}
          initialRange={range}
          initialOutput={project.output}
          onSaveOutput={(output, range) => {
            const p = current.current
            if (
              JSON.stringify(output) !== JSON.stringify(p.output) ||
              JSON.stringify(range) !== JSON.stringify(p.range)
            )
              setProject({ ...p, output, range })
          }}
          createRenderer={createRenderer}
          onClose={() => setExporting(false)}
        />
      )}
    </div>
  )
}
