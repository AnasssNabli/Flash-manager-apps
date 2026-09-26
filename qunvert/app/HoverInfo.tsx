'use client'

export default function HoverInfo({ text }: { text: string }) {
  return (
    <span className="relative inline-flex group align-middle">
      <button
        type="button"
        className="grid h-5 w-5 place-items-center rounded-full bg-slate-200 text-[11px] font-black leading-none text-slate-600 transition hover:bg-primary/15 hover:text-primary dark:bg-white/15 dark:text-white/70 dark:hover:bg-primary/20 dark:hover:text-primary"
        aria-label="More information"
        onClick={(event) => event.preventDefault()}
      >
        !
      </button>
      <span className="pointer-events-none absolute start-0 bottom-full z-40 mb-2 w-72 origin-bottom-left rounded-xl bg-slate-900 px-3 py-2 text-xs font-normal leading-4 text-white opacity-0 shadow-[0_12px_30px_rgba(15,23,42,0.28)] transition group-hover:opacity-100 group-focus-within:opacity-100">
        {text}
      </span>
    </span>
  )
}
