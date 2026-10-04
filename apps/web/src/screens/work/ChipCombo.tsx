import { Combobox, Icon, type ComboOption } from '@console/ui'
import { useEffect, useId, useState } from 'react'

/**
 * Фильтр-чип с поиском: вид `FilterChip` («Выполняет: все ▾»); по нажатию чип становится полем
 * `Combobox` с открытым списком, после выбора или ухода фокуса — снова чипом. Для длинных списков
 * (люди, агенты, типы работ); короткие закрытые — `ChipSelect`. `value: ''` — «все» (вариант
 * `allLabel`, значение null у Combobox).
 */
export function ChipCombo({ label, value, allLabel, options, onChange }: { label: string, value: string, allLabel: string, options: ComboOption[], onChange: (value: string) => void }) {
  const [editing, setEditing] = useState(false)
  const id = useId()
  const current = value === '' ? allLabel : options.find(o => o.value === value)?.label ?? value
  useEffect(() => { if (editing) document.getElementById(id)?.focus() }, [editing, id])
  if (!editing) {
    return (
      <button type="button" className="tc-chipbtn work-chipcombo" aria-haspopup="listbox" aria-label={`${label}: ${current}`} onClick={() => setEditing(true)}>
        <span aria-hidden="true">{`${label}: `}<b>{current}</b></span>
        <Icon name="chevronDown" />
      </button>
    )
  }
  return (
    // Esc при закрытом списке (открытый закрывает сам Combobox) — обратно в чип.
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions -- обёртка слушает Esc и уход фокуса из поля; клавиатура и фокус — у самого Combobox
    <span className="work-chipcombo-edit" onKeyDown={(e) => { if (e.key === 'Escape') setEditing(false) }}
      onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setEditing(false) }}>
      <Combobox id={id} label={label} value={value === '' ? null : value} options={options} clearLabel={allLabel} placeholder={label}
        onChange={(v) => { onChange(v ?? ''); setEditing(false) }} />
    </span>
  )
}
