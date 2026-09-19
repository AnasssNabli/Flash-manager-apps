'use client'

const SLOTS = [
  ['newCustomer', 'New customer'],
  ['orderConfirmation', 'Order confirmation'],
  ['orderSummary', 'Order summary'],
  ['followUp', 'Follow-up message'],
] as const

type SlotKey = (typeof SLOTS)[number][0]

export function WaLabelFields({
  values,
  options,
  live = false,
  loading = false,
  error = '',
  onChange,
  inputClass,
}: {
  values: Record<SlotKey, string>
  options: { id: string; name: string }[]
  live?: boolean
  loading?: boolean
  error?: string
  onChange: (key: SlotKey, value: string) => void
  inputClass: string
}) {
  const listId = 'wa-label-options'
  return (
    <div>
      <div className="grid gap-3 sm:grid-cols-2">
        {SLOTS.map(([key, label]) => (
          <label key={key} className="block">
            <span className="mb-1.5 flex items-center gap-1.5 text-sm font-medium text-slate-800 dark:text-white/85">
              {label}
            </span>
            <input
              className={inputClass}
              list={listId}
              value={values[key]}
              placeholder="No label"
              onChange={(event) => onChange(key, event.target.value)}
            />
          </label>
        ))}
      </div>
      <datalist id={listId}>
        {options.map((item) => (
          <option key={item.id} value={item.name} />
        ))}
      </datalist>
      {loading && (
        <p className="mt-2 text-xs text-slate-400">Loading labels from the connected WhatsApp number…</p>
      )}
      {error && <p className="mt-2 text-xs text-rose-500">{error}</p>}
      {!loading && !error && options.length === 0 && (
        <p className="mt-2 text-xs text-slate-400">
          Type a label name to apply it on chats. Matching names from this WhatsApp number appear here when they are available.
        </p>
      )}
      {!loading && !error && options.length > 0 && !live && (
        <p className="mt-2 text-xs text-slate-400">
          Suggestions include labels already used on this inbox. Type another name if you need a new one.
        </p>
      )}
    </div>
  )
}
