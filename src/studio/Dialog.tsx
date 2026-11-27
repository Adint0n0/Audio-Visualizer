import { useEffect, useId, useRef, type ReactNode } from 'react'
import { X } from 'lucide-react'
export function Dialog({
  title,
  close,
  children,
  wide = false,
  lang = 'en',
}: {
  title: string
  close: () => void
  children: ReactNode
  wide?: boolean
  lang?: string
}) {
  const titleId = useId()
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const el = ref.current
    el?.showModal()
    return () => el?.close()
  }, [])
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      className={'dialog ' + (wide ? 'wide' : '')}
      onCancel={close}
      onClick={(e) => {
        if (e.target === ref.current) close()
      }}
    >
      <div className="dialog-inner">
        <header>
          <h2 id={titleId}>{title}</h2>
          <button className="icon-btn" onClick={close} aria-label={lang === 'ja' ? '閉じる' : 'Close'}>
            <X size={18} />
          </button>
        </header>
        {children}
      </div>
    </dialog>
  )
}
