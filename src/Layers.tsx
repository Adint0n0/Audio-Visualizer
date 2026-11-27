import { useRef, useState } from 'react'
import {
  Activity,
  ArrowDown,
  ArrowUp,
  Box,
  Check,
  ChevronDown,
  Copy,
  Eye,
  EyeOff,
  Folder,
  Group,
  Image as ImageIcon,
  Layers as LayersIcon,
  Lock,
  MoreHorizontal,
  Plus,
  SquareCheck,
  Trash2,
  Type,
  Unlock,
} from 'lucide-react'
import {
  alignLayers,
  createLayer,
  distributeLayers,
  duplicateLayers,
  groupLayers,
  moveLayers,
  removeLayers,
} from './model'
import type { Layer, LayerKind, Project } from './model'
import type { Language } from './InspectorFields'
import { translator } from './InspectorFields'
import { term } from './panelLanguage'
import './panels.css'

export interface PanelProps {
  project: Project
  selection: string[]
  onSelect(ids: string[]): void
  onChange(project: Project): void
  lang: Language
  advanced?: boolean
}

const kindIcons = {
  visualizer: Activity,
  image: ImageIcon,
  text: Type,
  group: Folder,
}

export function Layers({ project, selection, onSelect, onChange, lang }: PanelProps) {
  const [addMode, setAddMode] = useState(false)
  const [tools, setTools] = useState(false)
  const [multi, setMulti] = useState(false)
  const [axis, setAxis] = useState<0 | 1 | 2>(0)
  const dragged = useRef<string | null>(null)
  const t = translator(lang)
  const editable = project.layers.filter((l) => selection.includes(l.id) && !l.locked).map((l) => l.id)
  const family = new Set(editable)
  for (const layer of project.layers) {
    let ancestor: Layer | undefined = layer
    while (ancestor) {
      if (family.has(ancestor.id)) {
        family.add(layer.id)
        break
      }
      ancestor = project.layers.find((p) => p.id === ancestor?.parentId)
    }
  }
  const first = project.layers.find((l) => l.id === editable[0])
  const canGroup =
    editable.length > 0 &&
    project.layers.length < 128 &&
    project.layers.every(
      (l) =>
        !editable.includes(l.id) || (l.screenSpace === first?.screenSpace && l.parentId === first?.parentId),
    )
  function apply(next: Project, ids: string[] = selection) {
    onChange(next)
    onSelect(ids.filter((id) => next.layers.some((l) => l.id === id)))
  }
  function add(kind: LayerKind) {
    const layer = createLayer(kind)
    layer.name = term(lang, kind === 'visualizer' ? layer.style : kind)
    apply({ ...project, layers: [...project.layers, layer] }, [layer.id])
    setAddMode(false)
  }
  function patch(layer: Layer, delta: Partial<Layer>) {
    onChange({
      ...project,
      layers: project.layers.map((l) => (l.id === layer.id ? { ...layer, ...delta } : l)),
    })
  }
  function operation(create: (p: Project, ids: string[]) => Project) {
    const next = create(project, editable)
    const added = next.layers.filter((l) => !project.layers.some((old) => old.id === l.id))
    apply(next, added.length ? added.map((l) => l.id) : selection)
  }
  function select(id: string, toggle: boolean) {
    onSelect(
      toggle ? (selection.includes(id) ? selection.filter((s) => s !== id) : [...selection, id]) : [id],
    )
  }
  function drop(target: string) {
    const id = dragged.current
    dragged.current = null
    if (!id || id === target) return
    const layers = [...project.layers]
    const sourceIndex = layers.findIndex((l) => l.id === id)
    const targetIndex = layers.findIndex((l) => l.id === target)
    if (sourceIndex < 0 || targetIndex < 0 || layers[sourceIndex].locked) return
    const [layer] = layers.splice(sourceIndex, 1)
    layers.splice(targetIndex, 0, layer)
    onChange({ ...project, layers })
  }
  const duplicate = () => operation(duplicateLayers)
  const icon = (label: string, action: () => void, child: React.ReactNode, disabled = false) => (
    <button
      type="button"
      className="ip-icon-btn"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={action}
    >
      {child}
    </button>
  )
  return (
    <section className="ly-panel" aria-label={t('Layers', 'レイヤー')}>
      <header className="ip-heading">
        <h2>
          <LayersIcon size={16} />
          {t('Layers', 'レイヤー')} <span className="ip-count">{project.layers.length}</span>
        </h2>
        <div className="ip-inline">
          {icon(
            t('Select multiple', '複数選択'),
            () => setMulti(!multi),
            <SquareCheck size={16} className={multi ? 'ip-accent' : ''} />,
          )}
          {icon(t('Layer tools', 'レイヤー操作'), () => setTools(!tools), <MoreHorizontal size={18} />)}
        </div>
      </header>
      <ul className="ly-list">
        {[...project.layers].reverse().map((layer) => {
          const Icon = kindIcons[layer.kind]
          const selected = selection.includes(layer.id)
          const group = project.layers.find((l) => l.id === layer.parentId)
          return (
            <li
              key={layer.id}
              className={'ly-row' + (selected ? ' is-selected' : '') + (layer.visible ? '' : ' is-hidden')}
              draggable={!layer.locked}
              onDragStart={(e) => {
                dragged.current = layer.id
                e.dataTransfer.setData('text/plain', layer.id)
                e.dataTransfer.effectAllowed = 'move'
              }}
              onDragEnd={() => {
                dragged.current = null
              }}
              onDragOver={(e) => {
                if (dragged.current) e.preventDefault()
              }}
              onDrop={(e) => {
                e.preventDefault()
                drop(layer.id)
              }}
            >
              <button
                type="button"
                className="ly-select"
                aria-pressed={selected}
                onClick={(e) => select(layer.id, multi || e.ctrlKey || e.metaKey || e.shiftKey)}
              >
                {multi && (
                  <span className={'ly-check' + (selected ? ' is-on' : '')}>
                    {selected && <Check size={11} />}
                  </span>
                )}
                <span className={'ly-icon ly-' + layer.kind}>
                  {layer.kind === 'visualizer' &&
                  ['orb', 'terrain', 'tunnel', 'waterfall'].includes(layer.style) ? (
                    <Box size={16} />
                  ) : (
                    <Icon size={16} />
                  )}
                </span>
                <span className="ly-info">
                  <strong>{layer.name}</strong>
                  <small>
                    {group ? group.name + ' / ' : ''}
                    {term(lang, layer.kind === 'visualizer' ? layer.style : layer.kind)}
                  </small>
                </span>
              </button>
              {layer.locked &&
                icon(
                  t('Unlock layer', 'ロック解除'),
                  () => patch(layer, { locked: false }),
                  <Lock size={13} />,
                )}
              {icon(
                layer.visible ? t('Hide layer', 'レイヤーを隠す') : t('Show layer', 'レイヤーを表示'),
                () => patch(layer, { visible: !layer.visible }),
                layer.visible ? <Eye size={15} /> : <EyeOff size={15} />,
                layer.locked,
              )}
            </li>
          )
        })}
      </ul>
      <div className="ly-footer">
        <button
          className="ly-add"
          disabled={project.layers.length >= 128}
          onClick={() => setAddMode(!addMode)}
          aria-expanded={addMode}
        >
          <Plus size={15} />
          {t('Add layer', 'レイヤーを追加')}
          <ChevronDown size={14} />
        </button>
        {addMode && (
          <div className="ly-add-options">
            {(['visualizer', 'text', 'image', 'group'] as const).map((kind) => (
              <button key={kind} onClick={() => add(kind)}>
                {term(lang, kind)}
              </button>
            ))}
          </div>
        )}
        {tools && (
          <div className="ly-tools">
            <div className="ip-inline">
              {icon(
                t('Move up', '前面に移動'),
                () => apply(moveLayers(project, editable, 1)),
                <ArrowUp size={16} />,
                !editable.length,
              )}
              {icon(
                t('Move down', '背面に移動'),
                () => apply(moveLayers(project, editable, -1)),
                <ArrowDown size={16} />,
                !editable.length,
              )}
              {icon(
                t('Duplicate', '複製'),
                duplicate,
                <Copy size={15} />,
                !editable.length || project.layers.length + family.size > 128,
              )}
              {icon(
                t('Group selected', '選択項目をグループ化'),
                () => operation(groupLayers),
                <Group size={16} />,
                !canGroup,
              )}
              {icon(
                t('Toggle layer locks', '選択レイヤーのロック切替'),
                () =>
                  onChange({
                    ...project,
                    layers: project.layers.map((l) =>
                      selection.includes(l.id) ? { ...l, locked: editable.length > 0 } : l,
                    ),
                  }),
                editable.length ? <Lock size={15} /> : <Unlock size={15} />,
                !selection.length,
              )}
              {icon(
                t('Delete', '削除'),
                () => operation(removeLayers),
                <Trash2 size={15} />,
                !editable.length || project.layers.some((l) => l.locked && family.has(l.id)),
              )}
            </div>
            <div className="ip-inline">
              <select
                aria-label={t('Alignment axis', '整列軸')}
                value={axis}
                onChange={(e) => setAxis(Number(e.target.value) as 0 | 1 | 2)}
              >
                {['X', 'Y', 'Z'].map((s, i) => (
                  <option value={i} key={s}>
                    {s}
                  </option>
                ))}
              </select>
              <button
                disabled={editable.length < 2}
                onClick={() => apply(alignLayers(project, editable, axis))}
              >
                {t('Align', '整列')}
              </button>
              <button
                disabled={editable.length < 3}
                onClick={() => apply(distributeLayers(project, editable, axis))}
              >
                {t('Distribute', '等間隔')}
              </button>
            </div>
          </div>
        )}
      </div>
    </section>
  )
}
