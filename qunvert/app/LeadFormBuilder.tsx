'use client'

import { Icon } from '@iconify/react'
import { useMemo, useState, type DragEvent } from 'react'
import {
  BUILTIN_LEAD_FIELDS,
  customLeadField,
  leadFlowReady,
  leadFormHash,
  type LeadField,
  type LeadFormConfig,
} from '@/lib/leadForm'

const FIELD_ICONS: Record<string, string> = {
  customer_name: 'solar:user-rounded-linear',
  customer_phone: 'solar:phone-linear',
  customer_address: 'solar:map-point-linear',
  customer_city: 'solar:city-linear',
  customer_province: 'solar:map-linear',
}

type DragPayload = { source: 'palette'; key: string } | { source: 'form'; index: number }

function readPayload(event: DragEvent): DragPayload | null {
  try {
    const raw = event.dataTransfer.getData('application/x-qunvert-field') || event.dataTransfer.getData('text/plain')
    const parsed = JSON.parse(raw)
    if (parsed?.source === 'palette' && typeof parsed.key === 'string') return parsed
    if (parsed?.source === 'form' && typeof parsed.index === 'number') return parsed
  } catch {
    // ignore
  }
  return null
}

function writePayload(event: DragEvent, payload: DragPayload) {
  const raw = JSON.stringify(payload)
  event.dataTransfer.setData('application/x-qunvert-field', raw)
  event.dataTransfer.setData('text/plain', raw)
  event.dataTransfer.effectAllowed = 'move'
}

function fieldIcon(field: LeadField) {
  return FIELD_ICONS[field.key] || 'solar:pen-new-square-linear'
}

function typeLabel(type: LeadField['type']) {
  if (type === 'phone') return 'Phone'
  if (type === 'textarea') return 'Long text'
  return 'Text'
}

export default function LeadFormBuilder({
  value,
  onChange,
  inputClass,
}: {
  value: LeadFormConfig
  onChange: (next: LeadFormConfig) => void
  inputClass: string
}) {
  const [customLabel, setCustomLabel] = useState('')
  const [customType, setCustomType] = useState<LeadField['type']>('text')
  const [dragging, setDragging] = useState<DragPayload | null>(null)
  const [overIndex, setOverIndex] = useState<number | null>(null)

  const inForm = useMemo(() => new Set(value.fields.map((field) => field.key)), [value.fields])
  const palette = BUILTIN_LEAD_FIELDS.filter((field) => !inForm.has(field.key))

  const setFields = (fields: LeadField[]) => onChange({ ...value, fields })

  const insertField = (field: LeadField, at: number | null) => {
    if (inForm.has(field.key)) return
    const next = [...value.fields]
    next.splice(at == null ? next.length : Math.max(0, Math.min(at, next.length)), 0, field)
    setFields(next)
  }

  const moveField = (from: number, to: number) => {
    if (from === to || from + 1 === to) return
    const next = [...value.fields]
    const [moved] = next.splice(from, 1)
    next.splice(from < to ? to - 1 : to, 0, moved)
    setFields(next)
  }

  const removeField = (key: string) => setFields(value.fields.filter((field) => field.key !== key))

  const updateField = (key: string, patch: Partial<LeadField>) =>
    setFields(value.fields.map((field) => (field.key === key ? { ...field, ...patch } : field)))

  const addCustom = () => {
    const field = customLeadField(customLabel, customType)
    if (!field) return
    insertField(field, null)
    setCustomLabel('')
    setCustomType('text')
  }

  const dropAt = (event: DragEvent, index: number | null) => {
    event.preventDefault()
    const payload = readPayload(event) || dragging
    setOverIndex(null)
    setDragging(null)
    if (!payload) return
    if (payload.source === 'palette') {
      const field = BUILTIN_LEAD_FIELDS.find((item) => item.key === payload.key)
      if (field) insertField({ ...field }, index)
      return
    }
    moveField(payload.index, index == null ? value.fields.length : index)
  }

  const allowDrop = (event: DragEvent, index: number | null) => {
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
    if (index == null) {
      setOverIndex(value.fields.length)
      return
    }
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
    const before = event.clientY < rect.top + rect.height / 2
    setOverIndex(before ? index : index + 1)
  }

  const ready = leadFlowReady(value)
  const hashChanged = value.flowHash !== leadFormHash(value)
  const status = !value.fields.length
    ? { tone: 'rose', icon: 'solar:danger-triangle-linear', text: 'Add at least one field so the agent can take orders.' }
    : ready
      ? { tone: 'primary', icon: 'solar:check-circle-bold', text: 'Order form is ready.' }
      : value.flowStatus === 'unavailable' || value.flowStatus === 'error'
        ? null
        : { tone: 'slate', icon: 'solar:cloud-upload-linear', text: hashChanged && value.flowId ? 'Save changes to update your order form.' : 'Save changes to finish your order form.' }
  const statusClass = status ? {
    primary: 'border-primary/25 bg-primary/10 text-primary',
    rose: 'border-rose-200 bg-rose-50 text-rose-600 dark:border-rose-500/25 dark:bg-rose-500/10 dark:text-rose-300',
    slate: 'border-slate-200 bg-slate-50 text-slate-600 dark:border-white/10 dark:bg-white/[0.04] dark:text-white/60',
  }[status.tone as 'primary' | 'rose' | 'slate'] : ''

  return (
    <div className="mt-4 space-y-4">
      <div className="grid gap-4 lg:grid-cols-[230px_minmax(0,1fr)]">
        {/* Palette */}
        <div>
          <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.12em] text-slate-400 dark:text-white/30">Fields</p>
          <div className="space-y-2">
            {palette.map((field) => (
              <button
                key={field.key}
                type="button"
                draggable
                onDragStart={(event) => {
                  writePayload(event, { source: 'palette', key: field.key })
                  setDragging({ source: 'palette', key: field.key })
                }}
                onDragEnd={() => { setDragging(null); setOverIndex(null) }}
                onClick={() => insertField({ ...field }, null)}
                className="group flex w-full cursor-grab items-center gap-2.5 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-start text-sm text-slate-700 shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition hover:border-primary/40 hover:text-primary active:cursor-grabbing dark:border-white/10 dark:bg-white/[0.04] dark:text-white/75"
                title="Drag into the form or click to add"
              >
                <Icon icon="solar:hamburger-menu-linear" width="15" className="text-slate-300 group-hover:text-primary/60 dark:text-white/20" />
                <Icon icon={fieldIcon(field)} width="17" />
                <span className="flex-1 truncate font-medium">{field.label}</span>
                <Icon icon="solar:add-circle-linear" width="16" className="opacity-0 transition group-hover:opacity-100" />
              </button>
            ))}
            {!palette.length && (
              <p className="rounded-xl border border-dashed border-slate-200 px-3 py-3 text-xs text-slate-400 dark:border-white/10 dark:text-white/30">All standard fields are in the form.</p>
            )}
          </div>

          <div className="mt-4 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_8px_24px_rgba(15,23,42,0.05)] dark:border-white/10 dark:bg-white/[0.04]">
            <div className="flex items-center gap-2 border-b border-slate-100 px-3.5 py-3 dark:border-white/10">
              <span className="grid h-7 w-7 place-items-center rounded-lg bg-primary/10 text-primary">
                <Icon icon="solar:add-square-bold-duotone" width="16" />
              </span>
              <div>
                <p className="text-xs font-semibold text-slate-800 dark:text-white/80">Custom field</p>
                <p className="text-[10px] text-slate-400">Ask for any extra order detail</p>
              </div>
            </div>
            <div className="p-3">
            <input
              className={`${inputClass} h-10`}
              value={customLabel}
              onChange={(event) => setCustomLabel(event.target.value)}
              onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); addCustom() } }}
              placeholder="e.g. Size, Color, Notes"
              maxLength={40}
            />
            <div className="mt-2 flex items-center gap-2">
              <select className={`${inputClass} h-9 flex-1 text-xs`} value={customType} onChange={(event) => setCustomType(event.target.value as LeadField['type'])}>
                <option value="text">Short text</option>
                <option value="textarea">Long text</option>
                <option value="phone">Phone</option>
              </select>
              <button
                type="button"
                onClick={addCustom}
                disabled={!customLeadField(customLabel, customType) || inForm.has(customLeadField(customLabel, customType)?.key || '')}
                className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-primary text-white transition hover:bg-primary-hover disabled:opacity-40"
                aria-label="Add custom field"
              >
                <Icon icon="solar:add-circle-bold" width="18" />
              </button>
            </div>
            </div>
          </div>
        </div>

        {/* Form canvas */}
        <div>
          <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.12em] text-slate-400 dark:text-white/30">Order form the customer fills in WhatsApp</p>
          <div
            onDragOver={(event) => { if (!value.fields.length) allowDrop(event, null) }}
            onDrop={(event) => dropAt(event, null)}
            className={`rounded-[22px] border bg-[#f4f6f8] p-3 transition dark:bg-white/[0.03] ${
              dragging ? 'border-primary/50 ring-4 ring-primary/10' : 'border-slate-200 dark:border-white/10'
            }`}
          >
            <div className="mx-auto max-w-[380px] overflow-hidden rounded-[18px] border border-slate-200/80 bg-white shadow-[0_10px_30px_rgba(15,23,42,0.08)] dark:border-white/10 dark:bg-[#141418]">
              <div className="flex items-center gap-2 border-b border-slate-100 bg-[#f7f7f9] px-4 py-3 dark:border-white/10 dark:bg-white/[0.04]">
                <Icon icon="solar:close-linear" width="16" className="text-slate-400" />
                <span className="flex-1 text-sm font-semibold text-slate-800 dark:text-white/85">Your order</span>
                <Icon icon="solar:menu-dots-bold" width="16" className="text-slate-400" />
              </div>

              <div className="space-y-2 px-3 py-3">
                {value.fields.length === 0 && (
                  <div className="grid min-h-[140px] place-items-center rounded-xl border-2 border-dashed border-slate-200 text-center text-xs text-slate-400 dark:border-white/10 dark:text-white/30">
                    <span>
                      <Icon icon="solar:import-linear" width="22" className="mx-auto mb-1.5 block" />
                      Drag fields here
                    </span>
                  </div>
                )}
                {value.fields.map((field, index) => {
                  const showLineBefore = dragging && overIndex === index
                  return (
                    <div key={field.key}>
                      {showLineBefore && <div className="mb-2 h-0.5 rounded-full bg-primary" />}
                      <div
                        draggable
                        onDragStart={(event) => {
                          writePayload(event, { source: 'form', index })
                          setDragging({ source: 'form', index })
                        }}
                        onDragEnd={() => { setDragging(null); setOverIndex(null) }}
                        onDragOver={(event) => allowDrop(event, index)}
                        onDrop={(event) => dropAt(event, overIndex ?? index)}
                        className={`group rounded-2xl border bg-white px-3 py-3 shadow-[0_3px_12px_rgba(15,23,42,0.04)] transition dark:bg-white/[0.04] ${
                          dragging?.source === 'form' && dragging.index === index
                            ? 'border-primary/40 opacity-40'
                            : 'border-slate-200 hover:border-primary/30 hover:shadow-[0_8px_20px_rgba(15,23,42,0.07)] dark:border-white/10'
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          <span className="cursor-grab text-slate-300 active:cursor-grabbing dark:text-white/20" aria-hidden>
                            <Icon icon="solar:hamburger-menu-linear" width="15" />
                          </span>
                          <Icon icon={fieldIcon(field)} width="16" className="text-primary" />
                          {field.builtin ? (
                            <span className="flex-1 truncate text-sm font-medium text-slate-800 dark:text-white/85">{field.label}</span>
                          ) : (
                            <input
                              value={field.label}
                              onChange={(event) => updateField(field.key, { label: event.target.value.slice(0, 40) })}
                              className="min-w-0 flex-1 bg-transparent text-sm font-medium text-slate-800 outline-none dark:text-white/85"
                              aria-label="Field label"
                            />
                          )}
                          <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:bg-white/10 dark:text-white/50">{typeLabel(field.type)}</span>
                          <button
                            type="button"
                            onClick={() => removeField(field.key)}
                            className="grid h-8 w-8 shrink-0 place-items-center rounded-xl border border-rose-100 bg-rose-50 text-rose-500 transition hover:border-rose-200 hover:bg-rose-100 hover:text-rose-600 dark:border-rose-500/20 dark:bg-rose-500/10 dark:text-rose-300 dark:hover:bg-rose-500/20"
                            aria-label={`Remove ${field.label}`}
                            title={`Remove ${field.label}`}
                          >
                            <Icon icon="solar:trash-bin-trash-bold-duotone" width="16" />
                          </button>
                        </div>
                        <div className="mt-2 flex items-center justify-between ps-6">
                          <span className={`h-8 flex-1 rounded-lg border border-slate-200 bg-slate-50/70 dark:border-white/10 dark:bg-white/[0.03] ${field.type === 'textarea' ? 'h-12' : ''}`} />
                          <label className="ms-3 inline-flex cursor-pointer items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-[11px] font-semibold text-slate-600 transition hover:border-primary/30 dark:border-white/10 dark:bg-white/[0.04] dark:text-white/55">
                            <input
                              type="checkbox"
                              checked={field.required}
                              onChange={(event) => updateField(field.key, { required: event.target.checked })}
                              className="peer sr-only"
                            />
                            <span className="grid h-[18px] w-[18px] place-items-center rounded-md border border-slate-300 bg-white text-transparent shadow-sm transition peer-checked:border-primary peer-checked:bg-primary peer-checked:text-white peer-focus-visible:ring-2 peer-focus-visible:ring-primary/30 dark:border-white/20 dark:bg-white/5">
                              <Icon icon="solar:check-read-linear" width="13" />
                            </span>
                            Required
                          </label>
                        </div>
                      </div>
                    </div>
                  )
                })}
                {dragging && overIndex === value.fields.length && value.fields.length > 0 && (
                  <div
                    onDragOver={(event) => allowDrop(event, null)}
                    onDrop={(event) => dropAt(event, null)}
                    className="h-0.5 rounded-full bg-primary"
                  />
                )}
                {value.fields.length > 0 && (
                  <div
                    onDragOver={(event) => allowDrop(event, null)}
                    onDrop={(event) => dropAt(event, null)}
                    className="h-3"
                  />
                )}
              </div>

              <div className="border-t border-slate-100 px-3 py-3 dark:border-white/10">
                <div className="grid h-10 place-items-center rounded-full bg-primary text-sm font-semibold text-white">{value.cta || 'Complete order'}</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="flex justify-end">
        <label className="w-full rounded-2xl border border-slate-200 bg-white p-3 shadow-[0_3px_12px_rgba(15,23,42,0.04)] sm:max-w-[320px] dark:border-white/10 dark:bg-white/[0.04]">
          <span className="flex items-center justify-between gap-2 text-sm font-semibold text-slate-800 dark:text-white/85">
            Form button text
            <span className="text-[10px] font-medium text-slate-400">{value.cta.length}/20</span>
          </span>
          <div className="relative mt-2">
            <Icon icon="solar:cursor-square-bold-duotone" width="17" className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-primary" />
            <input
              className={`${inputClass} border-primary/25 bg-primary/[0.04] ps-9 font-semibold focus:bg-white dark:bg-primary/[0.06]`}
              value={value.cta}
              maxLength={20}
              placeholder="e.g. Complete my order"
              onChange={(event) => onChange({ ...value, cta: event.target.value.slice(0, 20) })}
            />
          </div>
          <span className="mt-1.5 block text-[10px] leading-4 text-slate-400">Shown on the WhatsApp form button</span>
        </label>
      </div>

      {status && (
        <div className={`flex items-start gap-2.5 rounded-xl border px-3.5 py-3 text-xs leading-5 ${statusClass}`}>
          <Icon icon={status.icon} width="17" className="mt-0.5 shrink-0" />
          <span>{status.text}</span>
        </div>
      )}
    </div>
  )
}
