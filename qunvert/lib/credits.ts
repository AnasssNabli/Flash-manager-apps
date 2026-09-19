import { gw } from './fm'

export const REPLY_CREDITS = 2
export const COPY_CREDITS = 3

export class InsufficientCreditsError extends Error {
  readonly balance: number
  readonly required: number
  constructor(balance: number, required: number) {
    super(
      `Not enough AI credits — this needs ${required} cr, your balance is ${Math.max(0, balance)} cr.`,
    )
    this.name = 'InsufficientCreditsError'
    this.balance = balance
    this.required = required
  }
}

export async function chargeCredits(
  token: string,
  credits: number,
  reason: string,
  idempotencyKey?: string,
): Promise<{ balance: number; charged: number }> {
  const amount = Math.max(1, Math.floor(credits))
  const body = await gw<{ success?: boolean; balance?: number; error?: string }>('/v1/credits', token, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      credits: amount,
      reason,
      idempotency_key: idempotencyKey || crypto.randomUUID(),
    }),
  })
  if (body && typeof body.balance === 'number') {
    return { balance: body.balance, charged: amount }
  }
  throw new Error(body?.error || 'Credit charge failed')
}
