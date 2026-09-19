import { prisma } from './db'

export async function rememberGrant(ownerId: string, grantToken: string) {
  await prisma.tenant.upsert({
    where: { ownerId },
    create: { ownerId, grantToken },
    update: { grantToken },
  })
}

export async function rememberGrantIfMissing(ownerId: string, grantToken: string) {
  const existing = await prisma.tenant.findUnique({
    where: { ownerId },
    select: { grantToken: true },
  })
  if (existing?.grantToken) return
  await rememberGrant(ownerId, grantToken)
}

export async function rememberOwner(ownerId: string) {
  await prisma.tenant.upsert({
    where: { ownerId },
    create: { ownerId },
    update: {},
  })
}

export async function ownerToken(ownerId: string): Promise<string | null> {
  const row = await prisma.tenant.findUnique({ where: { ownerId }, select: { grantToken: true } })
  return row?.grantToken || null
}

export async function getOrCreateSettings(ownerId: string) {
  return prisma.agentSettings.upsert({
    where: { ownerId },
    create: { ownerId },
    update: {},
  })
}
