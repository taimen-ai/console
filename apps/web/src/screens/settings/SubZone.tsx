import type { ReactNode } from 'react'

/**
 * Подраздел внутри раздела «Настроек»: заголовок и счётчик без второй рамки — раздел уже
 * в `Zone`, вложенная `Zone` на узком экране съедала ширину двумя рамками.
 */
export function SubZone({ title, count, children }: { title: string, count?: number, children: ReactNode }) {
  return (
    <section className="st-sub" aria-label={title}>
      <h3 className="st-sub-h">{title}{count !== undefined ? <span className="st-sub-count">{count}</span> : null}</h3>
      {children}
    </section>
  )
}
