import { Icon } from '@console/ui'

/**
 * Фильтр-чип со списком значений: вид `FilterChip` («Тип работы: все ▾»), выбор — родной
 * `<select>` поверх чипа. Клавиатура, экранный диктор и мобильный выбор — от браузера.
 */
export function ChipSelect({ label, value, options, onChange }: { label: string, value: string, options: { value: string, label: string }[], onChange: (value: string) => void }) {
  const current = options.find(o => o.value === value)?.label ?? options[0]?.label ?? ''
  return (
    <label className="tc-chipbtn work-chipselect">
      <span aria-hidden="true">{`${label}: `}<b>{current}</b></span>
      <Icon name="chevronDown" />
      <select value={value} onChange={e => onChange(e.target.value)} aria-label={label}>
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  )
}
