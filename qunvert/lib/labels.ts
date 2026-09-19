import { parseAgentConfig } from './agentConfig'
import { overflowManagedLabelIds } from './gates'
import { prisma } from './db'
import { applyWhatsAppLabel, mergeWhatsAppLabels, type WhatsAppLabel } from './wa'

function labelNamesFromConfig(value: string | null | undefined): WhatsAppLabel[] {
  const config = parseAgentConfig(value)
  return [
    config.labels.newCustomer,
    config.labels.orderConfirmation,
    config.labels.orderSummary,
    config.labels.followUp,
    ...config.labels.custom.map((item) => item.label),
  ]
    .map((name) => String(name || '').trim())
    .filter(Boolean)
    .map((name) => ({ id: name, name }))
}

export async function listKnownWhatsAppLabels(ownerId: string): Promise<WhatsAppLabel[]> {
  const [rows, agents] = await Promise.all([
    prisma.agentConversationLabel.findMany({
      where: { ownerId },
      select: { label: true },
      distinct: ['label'],
    }),
    prisma.agent.findMany({
      where: { ownerId },
      select: { policiesJson: true },
    }),
  ])
  return mergeWhatsAppLabels(
    rows.map((row) => ({ id: row.label, name: row.label })),
    ...agents.map((agent) => labelNamesFromConfig(agent.policiesJson)),
  )
}

export async function applyConversationLabel(opts: {
  ownerId: string
  agentId: string
  phone: string
  label: string | null | undefined
  slot: string
  token?: string
}) {
  const label = String(opts.label || '').trim()
  if (!label) return
  if (opts.token) {
    await applyWhatsAppLabel(opts.token, opts.phone, label, opts.ownerId).catch((error) => {
      console.error('[wa-ai] whatsapp label failed', opts.phone, label, error)
    })
  }
  await prisma.agentConversationLabel.upsert({
    where: {
      agentId_phone_label: {
        agentId: opts.agentId,
        phone: opts.phone,
        label,
      },
    },
    create: {
      ownerId: opts.ownerId,
      agentId: opts.agentId,
      phone: opts.phone,
      label,
      slot: opts.slot,
      managed: true,
    },
    update: {
      slot: opts.slot,
      createdAt: new Date(),
    },
  })
  const managed = await prisma.agentConversationLabel.findMany({
    where: {
      ownerId: opts.ownerId,
      agentId: opts.agentId,
      phone: opts.phone,
      managed: true,
    },
    orderBy: { createdAt: 'desc' },
    select: { id: true },
  })
  const overflow = overflowManagedLabelIds(managed.map((item) => item.id), 3)
  if (overflow.length) {
    await prisma.agentConversationLabel.deleteMany({
      where: { id: { in: overflow } },
    })
  }
}

export async function getConversationLabels(ownerId: string, phones?: string[]) {
  const rows = await prisma.agentConversationLabel.findMany({
    where: {
      ownerId,
      ...(phones?.length ? { phone: { in: phones } } : {}),
    },
    orderBy: { createdAt: 'desc' },
  })
  return rows
}
