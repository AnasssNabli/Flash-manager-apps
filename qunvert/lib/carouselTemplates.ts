import { gwResult } from './fm'

/**
 * Ask FlashManager to submit the product-variant carousel template to Meta
 * so an approved carousel can be sent later when a customer asks for options.
 */
export async function submitVariantCarouselTemplates(
  token: string,
  input: { allProducts: boolean; productIds: string[] },
): Promise<{ ok: boolean; submitted?: number; error?: string }> {
  const body = JSON.stringify({
    source: 'qunvert',
    submitVariants: true,
    allProducts: input.allProducts,
    productIds: input.allProducts ? [] : input.productIds,
  })
  const headers = { 'Content-Type': 'application/json' }

  for (const path of ['/v1/whatsapp/ensure-templates', '/v1/whatsapp/templates']) {
    const result = await gwResult(path, token, { method: 'POST', headers, body }).catch(() => null)
    if (result?.ok) {
      const data = result.data && typeof result.data === 'object' ? result.data as Record<string, unknown> : {}
      return { ok: true, submitted: Number(data.submitted || 1) }
    }
  }

  const host = (process.env.FM_HOST || '').replace(/\/$/, '')
  if (host) {
    try {
      const response = await fetch(`${host}/api/whatsapp/ensure-templates`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body,
        cache: 'no-store',
        signal: AbortSignal.timeout(20_000),
      })
      const data = await response.json().catch(() => ({})) as Record<string, unknown>
      if (response.ok && data.error !== 'Invalid token') {
        return { ok: true, submitted: Number(data.submitted || 1) }
      }
    } catch {
      // Native unlink-style host routes reject app tokens; the gateway path is the real one.
    }
  }

  return { ok: false, error: 'carousel_submit_unavailable' }
}
