export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { resolveOwner, issueMediaTicket, fmTokenFor } from '@/lib/fm'
import { prisma } from '@/lib/db'

/**
 * Establish the app session.
 *
 * The embedded page posts the bridge token it just got from the FlashManager
 * host; we verify it, remember it as a fallback bearer, and hand back the
 * media ticket the inbox needs for <img>/<video> URLs. The page re-posts a
 * fresh token periodically, which is what keeps that fallback alive for a
 * seller who hasn't run the OAuth install.
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { token?: string }
  const owner = body.token ? await resolveOwner(body.token) : null
  if (!owner) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const expires = new Date(owner.exp * 1000)
  await prisma.app_tenants
    .upsert({
      where: { fm_owner_id: owner.ownerId },
      create: { fm_owner_id: owner.ownerId, fm_session_token: body.token, fm_session_exp: expires },
      update: { fm_session_token: body.token, fm_session_exp: expires },
    })
    .catch(() => {})

  const tenant = await prisma.app_tenants
    .findUnique({ where: { fm_owner_id: owner.ownerId }, select: { fm_access_token: true } })
    .catch(() => null)

  return NextResponse.json({
    ownerId: owner.ownerId,
    // Whether the seller ran the OAuth install. Without it the app still works
    // while the tab is open, but nothing can run in the background.
    installed: !!tenant?.fm_access_token,
    hasToken: !!(await fmTokenFor(owner.ownerId)),
    mediaTicket: issueMediaTicket(owner.ownerId),
  })
}
