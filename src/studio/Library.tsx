import { useMemo, useState } from 'react'
import { ChevronDown, Heart, Search, X, Plus, Replace, SlidersHorizontal } from 'lucide-react'
import {
  templates,
  categories,
  colorways,
  families,
  featuredIds,
  type Category,
  type Colorway,
} from '../templates'
import { Dialog } from './Dialog'
import { TemplatePreview } from './TemplatePreview'
import type { Lang } from './hooks'
export type SceneTemplate = (typeof templates)[number]
export function thumb(id: string) {
  return '/templates/' + encodeURIComponent(id) + '.webp'
}
export function Library({
  lang,
  active,
  apply,
}: {
  lang: Lang
  active: string
  apply: (item: SceneTemplate, append: boolean, colorway?: Colorway) => void
}) {
  const ja = lang === 'ja'
  const [query, setQuery] = useState(''),
    [category, setCategory] = useState('all'),
    [favorites, setFavorites] = useState<string[]>(() => {
      try {
        const value = JSON.parse(localStorage.getItem('formant-stars') || '[]')
        return Array.isArray(value) ? value : []
      } catch {
        return []
      }
    }),
    [onlyStars, setOnlyStars] = useState(false),
    [preview, setPreview] = useState<SceneTemplate | null>(null)
  const [mood, setMood] = useState('all'),
    [cost, setCost] = useState('all'),
    [family, setFamily] = useState('all'),
    [space, setSpace] = useState('all')
  const [showFilters, setShowFilters] = useState(false)
  const [colorway, setColorway] = useState<Colorway>('original')
  const previewProject = useMemo(() => preview?.create(colorway), [preview, colorway])
  const groups = [...new Set(templates.map((t) => t.category))]
  const displayCategory = (c: Category) => categories[c][lang]
  const t = (en: string, jp: string) => (ja ? jp : en)
  const rank = (id: string) => (featuredIds.includes(id) ? featuredIds.indexOf(id) : featuredIds.length)
  const ordered = [...templates].sort((a, b) => rank(a.id) - rank(b.id))
  const items = ordered.filter(
    (item) =>
      (category === 'all' || category === item.category) &&
      (family === 'all' || family === item.family) &&
      (mood === 'all' || mood === item.mood) &&
      (cost === 'all' || cost === item.cost) &&
      (space === 'all' || space === item.dimensions) &&
      (!onlyStars || favorites.includes(item.id)) &&
      (
        item.name.en +
        ' ' +
        item.name.ja +
        ' ' +
        displayCategory(item.category) +
        ' ' +
        item.description[lang]
      )
        .toLowerCase()
        .includes(query.trim().toLowerCase()),
  )
  function toggle(id: string) {
    const next = favorites.includes(id) ? favorites.filter((i) => i !== id) : [...favorites, id]
    setFavorites(next)
    try {
      localStorage.setItem('formant-stars', JSON.stringify(next))
    } catch {
      /* Private browsing can disable favorites persistence. */
    }
  }
  return (
    <section className="library">
      <div className="library-heading">
        <h2>{ja ? 'テンプレート' : 'Scene library'}</h2>
        <span className="count">{items.length}</span>
      </div>
      <label className="search-box">
        <Search size={15} />
        <input
          aria-label={ja ? 'テンプレート検索' : 'Search templates'}
          placeholder={ja ? 'テンプレートを検索…' : 'Search templates…'}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {query && (
          <button className="icon-btn" onClick={() => setQuery('')} aria-label={ja ? 'クリア' : 'Clear'}>
            <X size={14} />
          </button>
        )}
      </label>
      <div className="library-filters">
        <label className="category">
          <SlidersHorizontal size={13} />
          <select
            aria-label={ja ? 'カテゴリー' : 'Category'}
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          >
            <option value="all">{ja ? 'すべてのカテゴリー' : 'All categories'}</option>
            {groups.map((c) => (
              <option key={c} value={c}>
                {displayCategory(c)}
              </option>
            ))}
          </select>
          <ChevronDown size={13} />
        </label>
        <button
          className={'icon-btn ' + (onlyStars ? 'on' : '')}
          aria-label={ja ? 'お気に入りのみ' : 'Favorites only'}
          aria-pressed={onlyStars}
          onClick={() => setOnlyStars(!onlyStars)}
        >
          <Heart size={15} />
        </button>
      </div>
      <button
        className="library-filter-toggle btn"
        aria-expanded={showFilters}
        onClick={() => setShowFilters(!showFilters)}
      >
        <SlidersHorizontal size={15} />
        {t('Style and performance', 'スタイルと描画負荷')}
      </button>
      {showFilters && (
        <div className="extra-library-filters">
          <label>
            {t('Visual family', '表現ファミリー')}
            <select value={family} onChange={(e) => setFamily(e.target.value)}>
              <option value="all">{t('All families', 'すべてのファミリー')}</option>
              {Object.entries(families).map(([id, group]) => (
                <option key={id} value={id}>
                  {group[lang]}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t('Mood', '雰囲気')}
            <select value={mood} onChange={(e) => setMood(e.target.value)}>
              {[
                ['all', 'All', 'すべて'],
                ['ambient', 'Ambient', 'アンビエント'],
                ['rhythmic', 'Electronic', 'エレクトロニック'],
                ['cinematic', 'Cinematic', 'シネマティック'],
              ].map(([id, en, jp]) => (
                <option key={id} value={id}>
                  {t(en, jp)}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t('Space', '次元')}
            <select value={space} onChange={(e) => setSpace(e.target.value)}>
              {[
                ['all', 'All', 'すべて'],
                ['2d', '2D', '2D'],
                ['3d', '3D', '3D'],
              ].map(([id, en, jp]) => (
                <option key={id} value={id}>
                  {t(en, jp)}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t('Render load', '描画負荷')}
            <select value={cost} onChange={(e) => setCost(e.target.value)}>
              {[
                ['all', 'All', 'すべて'],
                ['light', 'Light', '軽量'],
                ['medium', 'Medium', '標準'],
                ['high', 'High', '高負荷'],
              ].map(([id, en, jp]) => (
                <option key={id} value={id}>
                  {t(en, jp)}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}
      <div className="cards">
        {items.map((t) => (
          <article key={t.id} className={'template-card ' + (active === t.id ? 'active' : '')}>
            <button
              className="template-pick"
              onClick={() => {
                setPreview(t)
                setColorway('original')
              }}
            >
              <span className="thumb">
                <img src={thumb(t.id)} loading="lazy" alt="" />
                {active === t.id && <span className="selected-dot" />}
              </span>
              <span className="template-name">{t.name[lang]}</span>
            </button>
            <button
              className={'star ' + (favorites.includes(t.id) ? 'starred' : '')}
              aria-label={(ja ? 'お気に入り ' : 'Favorite ') + t.name[lang]}
              aria-pressed={favorites.includes(t.id)}
              onClick={() => toggle(t.id)}
            >
              <Heart size={12} />
            </button>
          </article>
        ))}
      </div>
      {!items.length && (
        <p className="subtle">{ja ? '一致するテンプレートがありません。' : 'No matching scenes.'}</p>
      )}
      {preview && previewProject && (
        <Dialog title={preview.name[lang]} close={() => setPreview(null)} lang={lang}>
          <TemplatePreview
            project={previewProject}
            poster={thumb(preview.id)}
            lang={lang}
            renderStill={colorway !== 'original'}
          />
          <p className="template-description">{preview.description[lang]}</p>
          <label className="template-colors">
            {t('Palette', '配色')}{' '}
            <select value={colorway} onChange={(e) => setColorway(e.target.value as Colorway)}>
              {preview.colorways.map((id) => (
                <option value={id} key={id}>
                  {colorways[id][lang]}
                </option>
              ))}
            </select>
            <span className="swatches" aria-hidden="true">
              {(colorway === 'original' ? preview.palette : colorways[colorway].swatches).map((color, i) => (
                <i key={i} style={{ background: color }} />
              ))}
            </span>
          </label>
          <div className="template-detail">
            <span>{families[preview.family][lang]}</span>
            <span>
              {previewProject.layers.length} {ja ? 'レイヤー' : 'layers'}
            </span>
          </div>
          <p className="template-description">
            {t(
              'Append keeps your scene. You can undo a replacement.',
              '追加は現在のシーンを保持します。置換も元に戻せます。',
            )}
          </p>
          <div className="dialog-actions">
            <button
              className="btn"
              onClick={() => {
                apply(preview, true, colorway)
                setPreview(null)
              }}
            >
              <Plus size={15} />
              {ja ? 'レイヤーを追加' : 'Append layers'}
            </button>
            <button
              className="btn primary"
              onClick={() => {
                apply(preview, false, colorway)
                setPreview(null)
              }}
            >
              <Replace size={15} />
              {ja ? 'シーンを置換' : 'Replace scene'}
            </button>
          </div>
        </Dialog>
      )}
    </section>
  )
}
