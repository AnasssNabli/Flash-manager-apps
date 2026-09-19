'use client'

import { useCallback, useEffect, useState } from 'react'
import type { Product } from '@/lib/products'

const BP = process.env.NEXT_PUBLIC_BASE_PATH || '/whatsapp-ai-agents'

const inputCls =
  'w-full h-11 px-3 rounded-2xl border border-black/[0.08] dark:border-white/12 bg-white dark:bg-white/[0.06] text-sm outline-none focus:border-[#25D366]'
const areaCls =
  'w-full min-h-[140px] px-3 py-2.5 rounded-2xl border border-black/[0.08] dark:border-white/12 bg-white dark:bg-white/[0.06] text-sm outline-none focus:border-[#25D366] resize-y'
const btn =
  'h-11 px-5 rounded-full text-sm font-semibold bg-[#25D366] text-white disabled:opacity-40'
const btnGhost =
  'h-11 px-5 rounded-full text-sm font-semibold border border-black/[0.08] dark:border-white/15'

type Campaign = {
  id: string
  name: string
  message: string
  status: string
  audience: string
  conditionType: string
  conditionJson: string | null
  scheduledAt: string | null
  sent: number
  failed: number
  skipped: number
  total: number
  converted: number
  conversionRate: number
  productName: string | null
  productImage: string | null
}

type Send = { id: string; phone: string; status: string; error: string | null }
type Picked = { id: string; title: string; image_url?: string | null; price?: number; currency?: string; description?: string | null }

export default function CampaignsPanel({
  t,
  api,
  ready,
}: {
  t: (key: string, vars?: Record<string, string | number>) => string
  api: (path: string, init?: RequestInit) => Promise<Record<string, unknown>>
  ready: boolean
}) {
  const [creating, setCreating] = useState(false)
  const [page, setPage] = useState(1)
  const [pages, setPages] = useState(1)
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [openId, setOpenId] = useState<string | null>(null)
  const [sends, setSends] = useState<Send[]>([])
  const [sendPage, setSendPage] = useState(1)
  const [sendPages, setSendPages] = useState(1)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')

  const [name, setName] = useState('')
  const [message, setMessage] = useState('')
  const [audience, setAudience] = useState('window24h')
  const [who, setWho] = useState<'chats' | 'ordered'>('chats')
  const [when, setWhen] = useState<'now' | 'schedule'>('now')
  const [scheduledAt, setScheduledAt] = useState('')
  const [promote, setPromote] = useState<Picked | null>(null)
  const [ordered, setOrdered] = useState<Picked[]>([])
  const [search, setSearch] = useState('')
  const [products, setProducts] = useState<Product[]>([])
  const [pickFor, setPickFor] = useState<'promote' | 'ordered'>('ordered')

  const load = useCallback(async (p = page) => {
    const data = await api(`/api/campaigns?page=${p}&limit=8`)
    setCampaigns((data.campaigns as Campaign[]) || [])
    const pag = data.pagination as { page?: number; totalPages?: number } | undefined
    setPage(pag?.page || p)
    setPages(pag?.totalPages || 1)
  }, [api, page])

  useEffect(() => {
    if (!ready || creating) return
    load(page).catch(() => setNotice(t('error')))
  }, [ready, creating, page, load, t])

  useEffect(() => {
    if (!ready || !creating) return
    const q = new URLSearchParams()
    if (search) q.set('search', search)
    api(`/api/products?${q}`)
      .then((d) => setProducts((d.products as Product[]) || []))
      .catch(() => {})
  }, [ready, creating, search, api])

  const loadSends = async (id: string, p = 1) => {
    const data = await api(`/api/campaigns/${id}?page=${p}&limit=12`)
    setSends((data.sends as Send[]) || [])
    const pag = data.pagination as { page?: number; totalPages?: number } | undefined
    setSendPage(pag?.page || p)
    setSendPages(pag?.totalPages || 1)
  }

  const toggleRow = async (id: string) => {
    if (openId === id) {
      setOpenId(null)
      return
    }
    setOpenId(id)
    try {
      await loadSends(id, 1)
    } catch {
      setNotice(t('error'))
    }
  }

  const pickProduct = (p: Product) => {
    const item: Picked = {
      id: p.id,
      title: p.title,
      image_url: p.image_url,
      price: p.price,
      currency: p.currency,
      description: p.description,
    }
    if (pickFor === 'promote') {
      setPromote(item)
      if (!name.trim()) setName(p.title)
    } else if (!ordered.some((o) => o.id === p.id)) {
      setOrdered((prev) => [...prev, item].slice(0, 8))
    }
    setSearch('')
  }

  const generate = async () => {
    setBusy(true)
    try {
      const data = await api('/api/campaigns', {
        method: 'POST',
        body: JSON.stringify({
          generate: true,
          productName: promote?.title,
          productPrice: promote ? `${promote.price} ${promote.currency || ''}`.trim() : null,
          productDescription: promote?.description,
        }),
      })
      setMessage(String(data.message || ''))
    } catch {
      setNotice(t('error'))
    } finally {
      setBusy(false)
    }
  }

  const save = async () => {
    if (!message.trim()) return
    if (who === 'ordered' && !ordered.length) return
    if (when === 'schedule' && !scheduledAt) return
    setBusy(true)
    try {
      const created = await api('/api/campaigns', {
        method: 'POST',
        body: JSON.stringify({
          name: name || promote?.title || 'Campaign',
          productId: promote?.id,
          productName: promote?.title,
          productImage: promote?.image_url,
          productPrice: promote ? `${promote.price} ${promote.currency || ''}`.trim() : null,
          message,
          audience,
          conditionType: who,
          conditionProducts: ordered,
          schedule: when === 'schedule',
          scheduledAt: when === 'schedule' ? new Date(scheduledAt).toISOString() : null,
        }),
      })
      const campaign = created.campaign as Campaign
      if (when === 'now') {
        await api(`/api/campaigns/${campaign.id}/run`, { method: 'POST', body: '{}' })
      }
      setCreating(false)
      setName('')
      setMessage('')
      setPromote(null)
      setOrdered([])
      setWhen('now')
      setWho('chats')
      setPage(1)
      await load(1)
    } catch {
      setNotice(t('error'))
    } finally {
      setBusy(false)
    }
  }

  const statusLabel = (status: string) => {
    if (status === 'scheduled') return t('statusScheduled')
    if (status === 'running') return t('statusRunning')
    if (status === 'done') return t('statusDone')
    return t('statusDraft')
  }

  const audienceLabel = (c: Campaign) => {
    if (c.conditionType === 'ordered') {
      try {
        const parsed = JSON.parse(c.conditionJson || '{}') as { products?: { title?: string }[] }
        const titles = (parsed.products || []).map((p) => p.title).filter(Boolean)
        return titles.length ? titles.join(' · ') : t('whoOrdered')
      } catch {
        return t('whoOrdered')
      }
    }
    return c.audience === 'needs_reply' ? t('audNeeds') : t('audWindow')
  }

  if (creating) {
    return (
      <section className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-semibold">{t('newCampaign')}</h2>
          <button type="button" className={btnGhost} onClick={() => setCreating(false)}>{t('back')}</button>
        </div>
        <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder={t('campaignNamePh')} />
        <div>
          <p className="text-xs font-medium text-black/45 mb-2">{t('pickProduct')}</p>
          {promote ? (
            <button type="button" className="flex items-center gap-2 text-sm" onClick={() => setPromote(null)}>
              {promote.image_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={promote.image_url} alt="" className="w-8 h-8 rounded-lg object-cover" />
              ) : null}
              <span>{promote.title}</span>
            </button>
          ) : (
            <button type="button" className="text-sm text-[#128C7E]" onClick={() => setPickFor('promote')}>{t('searchProducts')}</button>
          )}
        </div>
        <textarea className={areaCls} value={message} onChange={(e) => setMessage(e.target.value)} placeholder={t('messagePh')} />
        <button type="button" className={btnGhost} disabled={busy} onClick={generate}>
          {busy ? t('generating') : t('generate')}
        </button>

        <div className="space-y-2">
          <p className="text-xs font-medium text-black/45">{t('whoLabel')}</p>
          <button
            type="button"
            onClick={() => setWho('chats')}
            className={`w-full p-4 rounded-2xl border text-start ${who === 'chats' ? 'border-[#25D366] bg-[#25D366]/8' : 'border-black/[0.06] dark:border-white/10'}`}
          >
            <p className="font-semibold text-sm">{t('whoChats')}</p>
          </button>
          <button
            type="button"
            onClick={() => { setWho('ordered'); setPickFor('ordered') }}
            className={`w-full p-4 rounded-2xl border text-start ${who === 'ordered' ? 'border-[#25D366] bg-[#25D366]/8' : 'border-black/[0.06] dark:border-white/10'}`}
          >
            <p className="font-semibold text-sm">{t('whoOrdered')}</p>
            <p className="text-xs text-black/45 mt-1">{t('whoOrderedHint')}</p>
          </button>
          {who === 'ordered' && (
            <div className="flex flex-wrap gap-2">
              {ordered.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setOrdered((prev) => prev.filter((x) => x.id !== p.id))}
                  className="h-8 px-3 rounded-full text-xs font-medium bg-[#25D366]/12"
                >
                  {p.title}
                </button>
              ))}
            </div>
          )}
        </div>

        {(pickFor === 'promote' && !promote) || who === 'ordered' ? (
          <div>
            <input className={inputCls} value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('searchProducts')} />
            <div className="mt-2 max-h-44 overflow-auto space-y-1">
              {products.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => pickProduct(p)}
                  className="w-full flex items-center gap-3 px-2 py-2 rounded-xl text-start hover:bg-black/[0.03] dark:hover:bg-white/5"
                >
                  {p.image_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={p.image_url} alt="" className="w-9 h-9 rounded-lg object-cover" />
                  ) : (
                    <span className="w-9 h-9 rounded-lg bg-black/5 dark:bg-white/10" />
                  )}
                  <span className="min-w-0">
                    <span className="block text-sm font-medium truncate">{p.title}</span>
                    <span className="block text-xs text-black/40">{p.price} {p.currency}</span>
                  </span>
                </button>
              ))}
            </div>
          </div>
        ) : null}

        <select className={inputCls} value={audience} onChange={(e) => setAudience(e.target.value)}>
          <option value="window24h">{t('audWindow')}</option>
          <option value="needs_reply">{t('audNeeds')}</option>
          <option value="all">{t('audAll')}</option>
        </select>

        <div className="space-y-2">
          <p className="text-xs font-medium text-black/45">{t('whenLabel')}</p>
          <div className="flex gap-2">
            <button type="button" className={`${btnGhost} ${when === 'now' ? 'border-[#25D366]' : ''}`} onClick={() => setWhen('now')}>{t('sendNow')}</button>
            <button type="button" className={`${btnGhost} ${when === 'schedule' ? 'border-[#25D366]' : ''}`} onClick={() => setWhen('schedule')}>{t('schedule')}</button>
          </div>
          {when === 'schedule' && (
            <input
              type="datetime-local"
              className={inputCls}
              value={scheduledAt}
              onChange={(e) => setScheduledAt(e.target.value)}
            />
          )}
        </div>

        <button
          type="button"
          className={btn}
          disabled={!message.trim() || busy || (who === 'ordered' && !ordered.length) || (when === 'schedule' && !scheduledAt)}
          onClick={save}
        >
          {busy ? t('launching') : when === 'schedule' ? t('scheduleSave') : t('launch')}
        </button>
        {notice && <p className="text-xs text-black/40">{notice}</p>}
      </section>
    )
  }

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-semibold">{t('campaigns')}</h2>
        <button type="button" className={btn} onClick={() => setCreating(true)}>{t('newCampaign')}</button>
      </div>

      {campaigns.length === 0 ? (
        <p className="text-sm text-black/40">{t('emptyCampaigns')}</p>
      ) : (
        <div className="rounded-2xl border border-black/[0.06] dark:border-white/10 overflow-hidden">
          <div className="hidden sm:grid grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_88px_72px_88px] gap-2 px-4 py-2 text-[11px] font-medium text-black/40 dark:text-white/35">
            <span>{t('colCampaign')}</span>
            <span>{t('colAudience')}</span>
            <span>{t('colStatus')}</span>
            <span>{t('colSent')}</span>
            <span>{t('colConv')}</span>
          </div>
          <ul>
            {campaigns.map((c) => (
              <li key={c.id} className="border-t border-black/[0.05] dark:border-white/8">
                <button
                  type="button"
                  onClick={() => toggleRow(c.id)}
                  className="w-full text-start px-4 py-3 grid sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_88px_72px_88px] gap-2 items-center"
                >
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold truncate">{c.name}</span>
                    <span className="block text-xs text-black/40 truncate">{c.productName || c.message}</span>
                  </span>
                  <span className="text-xs text-black/45 truncate">{audienceLabel(c)}</span>
                  <span className="text-xs text-black/45">
                    {statusLabel(c.status)}
                    {c.status === 'scheduled' && c.scheduledAt ? (
                      <span className="block">{new Date(c.scheduledAt).toLocaleString()}</span>
                    ) : null}
                  </span>
                  <span className="text-xs">{c.sent}/{c.total || 0}</span>
                  <span className="text-sm font-semibold text-[#128C7E]">{t('convRate', { n: c.conversionRate })}</span>
                </button>
                {openId === c.id && (
                  <div className="px-4 pb-4 space-y-2">
                    <p className="text-xs text-black/40">
                      {t('sent', { n: c.sent })} · {t('failed', { n: c.failed })} · {t('converted', { n: c.converted })}
                    </p>
                    {sends.length === 0 ? (
                      <p className="text-xs text-black/35">{t('results')}</p>
                    ) : (
                      <ul className="space-y-1">
                        {sends.map((s) => (
                          <li key={s.id} className="flex justify-between gap-2 text-xs">
                            <span className="font-mono">{s.phone}</span>
                            <span className="text-black/40">{s.status}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                    {sendPages > 1 && (
                      <div className="flex items-center justify-between pt-1">
                        <button type="button" className={btnGhost} disabled={sendPage <= 1} onClick={() => loadSends(c.id, sendPage - 1)}>{t('prevPage')}</button>
                        <span className="text-xs text-black/40">{t('pageOf', { page: sendPage, pages: sendPages })}</span>
                        <button type="button" className={btnGhost} disabled={sendPage >= sendPages} onClick={() => loadSends(c.id, sendPage + 1)}>{t('nextPage')}</button>
                      </div>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {pages > 1 && (
        <div className="flex items-center justify-between">
          <button type="button" className={btnGhost} disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>{t('prevPage')}</button>
          <span className="text-xs text-black/40">{t('pageOf', { page, pages })}</span>
          <button type="button" className={btnGhost} disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>{t('nextPage')}</button>
        </div>
      )}
      {notice && <p className="text-xs text-black/40">{notice}</p>}
    </section>
  )
}
