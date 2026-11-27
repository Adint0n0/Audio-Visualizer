import { useState } from 'react'
import { ChevronDown, Heart, Search, X, Plus, Replace, SlidersHorizontal } from 'lucide-react'
import { templates, categories, type Category } from '../templates'
import { Dialog } from './Dialog'
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
  apply: (item: SceneTemplate, append: boolean) => void
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
  const groups = [...new Set(templates.map((t) => t.category))]
  const displayCategory = (c: Category) => categories[c][lang]
  const featured = [
    'prism-current',
    'afterimage',
    'fault-lines',
    'transit-tube',
    'crystal-organ',
    'binary-stars',
    'laser-harp',
    'block-district',
  ]
  const rank = (id: string) => (featured.includes(id) ? featured.indexOf(id) : featured.length)
  const ordered = [...templates].sort(
    (a, b) =>
      rank(a.id) - rank(b.id) ||
      templates.filter((t) => t.category === a.category).indexOf(a) -
        templates.filter((t) => t.category === b.category).indexOf(b),
  )
  const items = ordered.filter(
    (t) =>
      (category === 'all' || category === t.category) &&
      (!onlyStars || favorites.includes(t.id)) &&
      (t.name.en + t.name.ja + t.category).toLowerCase().includes(query.toLowerCase()),
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
        <span className="count">{templates.length}</span>
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
      <div className="cards">
        {items.map((t) => (
          <article key={t.id} className={'template-card ' + (active === t.id ? 'active' : '')}>
            <button className="template-pick" onClick={() => setPreview(t)}>
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
      {preview && (
        <Dialog title={preview.name[lang]} close={() => setPreview(null)} lang={lang}>
          <img className="template-sample" src={thumb(preview.id)} alt={preview.name[lang]} />
          <div className="template-detail">
            <span>{displayCategory(preview.category)}</span>
            <span>
              {preview.create().layers.length} {ja ? 'レイヤー' : 'layers'}
            </span>
          </div>
          <div className="dialog-actions">
            <button
              className="btn"
              onClick={() => {
                apply(preview, true)
                setPreview(null)
              }}
            >
              <Plus size={15} />
              {ja ? 'レイヤーを追加' : 'Append layers'}
            </button>
            <button
              className="btn primary"
              onClick={() => {
                apply(preview, false)
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
