import { Button, Field } from '@console/ui'
import { t } from '@lingui/core/macro'
import { useId, type ReactNode } from 'react'
import './forms.css'
import {
  defaultsOf, describe, enumOptions, fieldAt, getIn, pathKey, ruleState, scopePath, setIn, typeOf,
  type ErrorCode, type Errors, type FieldSchema, type FormSchema, type Path, type UiElement, type Values,
} from './schema.ts'

/**
 * Форма по JSON Schema и uischema (forms/schema.ts) на компонентах дизайн-системы: `Field` и
 * классы `tc-input`, `tc-select`, `tc-textarea`. Перечисление до четырёх вариантов —
 * переключатели (видно все варианты сразу), больше — список. Вложенный объект — группа полей,
 * список вариантов — флажки, список значений или объектов — элементы с «Добавить» и «Удалить».
 * Ошибка — под полем и связана с ним (`aria-describedby`, `aria-invalid`).
 */

function errorText(error: ErrorCode, field: FieldSchema): string {
  switch (error) {
    case 'required': return t`Required`
    case 'type': return t`Enter a number`
    case 'minimum': { const n = field.minimum ?? 0; return t`At least ${n}` }
    case 'maximum': { const n = field.maximum ?? 0; return t`At most ${n}` }
    case 'minLength': { const n = field.minLength ?? 0; return t`At least ${n} characters` }
    case 'maxLength': { const n = field.maxLength ?? 0; return t`At most ${n} characters` }
    case 'minItems': { const n = field.minItems ?? 0; return t`Add at least ${n}` }
    case 'maxItems': { const n = field.maxItems ?? 0; return t`At most ${n} items` }
    case 'pattern': return t`Does not match the expected format`
    default: return t`Choose one of the options`
  }
}

export interface RefControlProps { name: string, field: FieldSchema, label: string, value: unknown, disabled: boolean, invalid: boolean, describedBy: string | undefined, onChange: (v: unknown) => void }

interface Props {
  schema: FormSchema
  ui: UiElement
  values: Values
  errors: Errors
  disabled?: boolean
  /** Изменилось поле верхнего уровня (вложенное — новым значением всего поля). */
  onChange: (key: string, value: unknown) => void
  /** Ошибки ядра по полю (`422 settings_invalid`), словами — поверх проверки консоли; ключ — путь. */
  serverErrors?: Record<string, string>
  /** Подпись под полем верхнего уровня: «по умолчанию», «сохранено» и т. п. */
  hints?: Record<string, ReactNode>
  /** Поле со ссылкой на объект платформы (`x-ref`) — выбор поиском. Нет — текстом. */
  renderRef?: (props: RefControlProps) => ReactNode
}

export function SchemaForm(props: Props) {
  return <div className="tc-form sf-form">{render(props.ui, props, true)}</div>
}

function render(el: UiElement, p: Props, enabledAbove: boolean): ReactNode {
  const { visible, enabled } = ruleState(el.rule, p.values)
  if (!visible) return null
  const on = enabledAbove && enabled
  switch (el.type) {
    case 'VerticalLayout': return <>{(el.elements ?? []).map((c, i) => <Wrap key={i}>{render(c, p, on)}</Wrap>)}</>
    case 'HorizontalLayout': return <div className="sf-row">{(el.elements ?? []).map((c, i) => <Wrap key={i}>{render(c, p, on)}</Wrap>)}</div>
    case 'Group': return <fieldset className="sf-group"><legend>{typeof el.label === 'string' ? el.label : ''}</legend>{(el.elements ?? []).map((c, i) => <Wrap key={i}>{render(c, p, on)}</Wrap>)}</fieldset>
    case 'Label': return <p className="sf-label">{el.text}</p>
    case 'Control': {
      const path = scopePath(el.scope)
      const field = path !== undefined ? fieldAt(p.schema, path) : undefined
      if (path === undefined || field === undefined) return null
      const parent = path.length > 1 ? fieldAt(p.schema, path.slice(0, -1)) : p.schema
      return <Node path={path} field={field} el={el} required={(parent?.required ?? []).includes(String(path.at(-1)))} p={p} disabled={p.disabled === true || !on} />
    }
    default: return null
  }
}

const Wrap = ({ children }: { children: ReactNode }) => <>{children}</>

/** Поле по пути: значение — из корня значений, изменение — новым значением поля верхнего уровня. */
function Node({ path, field, el, required, p, disabled }: { path: Path, field: FieldSchema, el?: UiElement, required: boolean, p: Props, disabled: boolean }) {
  const key = pathKey(path)
  const value = getIn(p.values, path)
  const top = String(path[0])
  const onChange = (v: unknown): void => p.onChange(top, path.length === 1 ? v : setIn(p.values[top], path.slice(1), v))
  const label = (el !== undefined && typeof el.label === 'string' ? el.label : field.title ?? String(path.at(-1))) + (required ? ' *' : '')
  const common = { path, field, label, value, onChange, disabled, error: p.errors[key], serverError: p.serverErrors?.[key], hint: path.length === 1 ? p.hints?.[top] : undefined, p }
  const type = typeOf(field)
  if (type === 'object' && field.properties !== undefined && field['x-ref'] === undefined) return <ObjectNode {...common} />
  if (type === 'array' && field.items !== undefined) return <ArrayNode {...common} />
  return <Control name={key} field={field} el={el} label={label} required={required} value={value} error={common.error} serverError={common.serverError} hint={common.hint} renderRef={p.renderRef} disabled={disabled} onChange={onChange} />
}

interface NodeProps { path: Path, field: FieldSchema, label: string, value: unknown, onChange: (v: unknown) => void, disabled: boolean, error: ErrorCode | undefined, serverError: string | undefined, hint: ReactNode, p: Props }

function Messages({ id, field, error, serverError, hint }: { id: string, field: FieldSchema, error: ErrorCode | undefined, serverError: string | undefined, hint: ReactNode }) {
  return (
    <>
      {error !== undefined || serverError !== undefined ? <span className="sf-error" id={id} role="alert">{error !== undefined ? errorText(error, field) : serverError}</span> : null}
      {hint !== undefined && hint !== null ? <span className="sf-hint">{hint}</span> : null}
    </>
  )
}

/** Вложенный объект — группа его полей. */
function ObjectNode({ path, field, label, disabled, error, serverError, hint, p }: NodeProps) {
  const id = useId()
  const required = new Set(field.required ?? [])
  const help = describe(field)
  return (
    <fieldset className="sf-group sf-nested" disabled={disabled}>
      <legend>{label}</legend>
      {help !== undefined ? <span className="tc-field-help">{help}</span> : null}
      {Object.entries(field.properties ?? {}).map(([k, f]) => <Node key={k} path={[...path, k]} field={f} required={required.has(k)} p={p} disabled={disabled} />)}
      <Messages id={`${id}-err`} field={field} error={error} serverError={serverError} hint={hint} />
    </fieldset>
  )
}

/** Список: варианты перечисления — флажками; значения и объекты — элементами с «Добавить» и «Удалить». */
function ArrayNode({ path, field, label, value, onChange, disabled, error, serverError, hint, p }: NodeProps) {
  const id = useId()
  const items = Array.isArray(value) ? value : []
  const item = field.items!
  const help = describe(field)
  const invalid = error !== undefined || serverError !== undefined
  const full = field.maxItems !== undefined && items.length >= field.maxItems

  if (item.enum !== undefined || item.oneOf !== undefined) {
    const options = enumOptions(item)
    return (
      <fieldset className="sf-choice" disabled={disabled} aria-describedby={invalid ? `${id}-err` : undefined}>
        <legend className="tc-field-label">{label}</legend>
        {help !== undefined ? <span className="tc-field-help">{help}</span> : null}
        {options.map(o => (
          <label key={String(o.value)} className="sf-option">
            <input type="checkbox" checked={items.includes(o.value)}
              onChange={e => onChange(e.target.checked ? [...items, o.value] : items.filter(x => x !== o.value))} />
            <span>{o.label}</span>
          </label>
        ))}
        <Messages id={`${id}-err`} field={field} error={error} serverError={serverError} hint={hint} />
      </fieldset>
    )
  }

  const objects = typeOf(item) === 'object'
  return (
    <fieldset className="sf-group sf-list" disabled={disabled} aria-describedby={invalid ? `${id}-err` : undefined}>
      <legend>{label}</legend>
      {help !== undefined ? <span className="tc-field-help">{help}</span> : null}
      {items.length === 0 ? <p className="tc-muted sf-list-empty">{t`The list is empty.`}</p> : null}
      {items.map((_, i) => {
        const n = i + 1
        return (
          <div key={i} className={objects ? 'sf-list-item sf-list-object' : 'sf-list-item'}>
            <div className="sf-list-body">
              <Node path={[...path, i]} field={{ ...item, title: objects ? t`${label} — ${n}` : item.title ?? t`Item ${n}` }} required={false} p={p} disabled={disabled} />
            </div>
            <Button variant="ghost" size="sm" aria-label={t`Remove item ${n}`} disabled={disabled} onClick={() => onChange(items.filter((__, j) => j !== i))}>{t`Remove`}</Button>
          </div>
        )
      })}
      <div><Button variant="secondary" size="sm" disabled={disabled || full} onClick={() => onChange([...items, defaultsOf(item) ?? (typeOf(item) === 'string' ? '' : undefined)])}>{t`Add`}</Button></div>
      <Messages id={`${id}-err`} field={field} error={error} serverError={serverError} hint={hint} />
    </fieldset>
  )
}

function Control({ name, field, el, label, required, value, error, serverError, hint, renderRef, disabled, onChange }: { name: string, field: FieldSchema, el?: UiElement | undefined, label: string, required: boolean, value: unknown, error: ErrorCode | undefined, serverError?: string | undefined, hint?: ReactNode, renderRef?: ((props: RefControlProps) => ReactNode) | undefined, disabled: boolean, onChange: (v: unknown) => void }) {
  const id = useId()
  const errId = `${id}-err`
  const help = describe(field)
  const type = typeOf(field)
  const invalid = error !== undefined || serverError !== undefined
  const aria = { 'aria-invalid': invalid ? true : undefined, 'aria-describedby': invalid ? errId : undefined, 'aria-required': required || undefined }
  const err = <Messages id={errId} field={field} error={error} serverError={serverError} hint={hint} />

  if (field['x-ref'] !== undefined && renderRef !== undefined) {
    return (
      <Field label={label} {...(help !== undefined ? { help } : {})}>
        {renderRef({ name, field, label, value, disabled, invalid, describedBy: invalid ? errId : undefined, onChange })}
        {err}
      </Field>
    )
  }

  if (field.enum !== undefined || field.oneOf !== undefined) {
    const options = enumOptions(field)
    if (options.length <= 4) {
      return (
        <fieldset className="sf-choice" role="radiogroup" aria-labelledby={`${id}-label`} disabled={disabled} {...aria}>
          <legend className="tc-field-label" id={`${id}-label`}>{label}</legend>
          {help !== undefined ? <span className="tc-field-help">{help}</span> : null}
          {options.map(o => (
            <label key={String(o.value)} className="sf-option">
              <input type="radio" name={`${id}-${name}`} checked={value === o.value} onChange={() => onChange(o.value)} />
              <span>{o.label}</span>
            </label>
          ))}
          {err}
        </fieldset>
      )
    }
    return (
      <Field label={label} {...(help !== undefined ? { help } : {})}>
        <select className="tc-select" value={value === undefined ? '' : String(value)} disabled={disabled} {...aria}
          onChange={(e) => { const o = options.find(x => String(x.value) === e.target.value); onChange(o?.value) }}>
          <option value="">{t`choose…`}</option>
          {options.map(o => <option key={String(o.value)} value={String(o.value)}>{o.label}</option>)}
        </select>
        {err}
      </Field>
    )
  }
  if (type === 'boolean') {
    return (
      <label className="sf-check">
        <input type="checkbox" checked={value === true} disabled={disabled} onChange={e => onChange(e.target.checked)} {...aria} />
        <span>{label}</span>
        {help !== undefined ? <span className="tc-field-help">{help}</span> : null}
        {err}
      </label>
    )
  }
  if (type === 'number' || type === 'integer') {
    return (
      <Field label={label} {...(help !== undefined ? { help } : {})}>
        <input className="tc-input" type="number" inputMode="decimal" step={type === 'integer' ? 1 : 'any'} disabled={disabled} {...aria}
          {...(field.minimum !== undefined ? { min: field.minimum } : {})} {...(field.maximum !== undefined ? { max: field.maximum } : {})}
          value={typeof value === 'number' ? value : ''} onChange={e => onChange(e.target.value === '' ? undefined : Number(e.target.value))} />
        {err}
      </Field>
    )
  }
  const multi = el?.options?.multi === true || (field.maxLength ?? 0) > 200
  const inputType = field.format === 'date' ? 'date' : field.format === 'date-time' ? 'datetime-local' : field.format === 'email' ? 'email' : 'text'
  return (
    <Field label={label} wide={multi} {...(help !== undefined ? { help } : {})}>
      {multi
        ? <textarea className="tc-textarea" rows={3} disabled={disabled} {...aria} {...(field.maxLength !== undefined ? { maxLength: field.maxLength } : {})} value={typeof value === 'string' ? value : ''} onChange={e => onChange(e.target.value)} />
        : <input className="tc-input" type={inputType} disabled={disabled} {...aria} {...(field.maxLength !== undefined ? { maxLength: field.maxLength } : {})} value={typeof value === 'string' ? value : ''} onChange={e => onChange(e.target.value)} />}
      {err}
    </Field>
  )
}
