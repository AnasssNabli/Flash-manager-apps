import { execFileSync } from 'child_process'
import { readFileSync } from 'fs'
import type { Agent, AgentChannelAssignment, MetaAccount } from '@prisma/client'
import { prisma } from './db'
import { parseAgentConfig } from './agentConfig'
import { listProducts } from './products'
import { ownerToken } from './tenants'

export type Channel = 'whatsapp' | 'instagram' | 'facebook'

export type PublicMetaAccount = {
  id: string
  provider: 'instagram' | 'facebook'
  externalId: string
  displayName: string | null
  username: string | null
  status: string
  connectedAt: string
}

export type PublicAssignment = {
  id: string
  agentId: string
  channel: Channel
  endpointId: string
  displayName: string
  details: Record<string, unknown>
}

function safeJson(value: string | null): Record<string, unknown> {
  try {
    const parsed = value ? JSON.parse(value) : {}
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

export function publicMetaAccount(account: MetaAccount): PublicMetaAccount {
  return {
    id: account.id,
    provider: account.provider === 'facebook' ? 'facebook' : 'instagram',
    externalId: account.externalId,
    displayName: account.displayName,
    username: account.username,
    status: account.status,
    connectedAt: account.connectedAt.toISOString(),
  }
}

export function publicAssignment(assignment: AgentChannelAssignment): PublicAssignment {
  return {
    id: assignment.id,
    agentId: assignment.agentId,
    channel: assignment.channel as Channel,
    endpointId: assignment.endpointId,
    displayName: assignment.displayName,
    details: safeJson(assignment.detailsJson),
  }
}

export async function listMetaAccounts(ownerId: string, provider?: 'instagram' | 'facebook') {
  const accounts = await prisma.metaAccount.findMany({
    where: { ownerId, status: 'connected', ...(provider ? { provider } : {}) },
    orderBy: { connectedAt: 'desc' },
  })
  return accounts.map(publicMetaAccount)
}

export async function upsertMetaAccount(ownerId: string, provider: 'instagram' | 'facebook', input: {
  externalId: string
  displayName: string | null
  username: string | null
  accessToken: string
  scope: string
}) {
  const account = await prisma.metaAccount.upsert({
    where: {
      ownerId_provider_externalId: {
        ownerId,
        provider,
        externalId: input.externalId,
      },
    },
    create: { ownerId, provider, status: 'connected', connectedAt: new Date(), ...input },
    update: { status: 'connected', connectedAt: new Date(), ...input },
  })
  await syncMetaAccount(ownerId, account)
  return publicMetaAccount(account)
}

type SyncOp =
  | 'upsert_tenant'
  | 'upsert_page'
  | 'upsert_automation'
  | 'delete_automation'

let sharedRuntimeEnv: Record<string, string> | null = null

function runtimeValue(name: string): string {
  if (process.env[name]) return process.env[name] || ''
  if (sharedRuntimeEnv === null) {
    sharedRuntimeEnv = {}
    try {
      const path = process.env.M_AGENTS_ENV_PATH || '/www/apps/m-agents/.env'
      for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
        const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
        if (!match) continue
        sharedRuntimeEnv[match[1]] = match[2].trim().replace(/^(['"])([\s\S]*)\1$/, '$2')
      }
    } catch {
      // Fall back to this app's own environment.
    }
  }
  return sharedRuntimeEnv[name] || ''
}

/** Same Panddo mirror m-agents uses. That runtime receives the Instagram webhook and sends the reply. */
async function panddoSync(op: SyncOp, record: Record<string, unknown>) {
  const url = runtimeValue('PANDDO_SYNC_URL')
  const secret = runtimeValue('FM_SYNC_SECRET')
  if (!url || !secret) {
    console.error(`[panddo-sync] ${op} skipped: runtime sync is not configured`)
    return false
  }
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-fm-sync-secret': secret,
      },
      body: JSON.stringify({ op, record }),
      signal: AbortSignal.timeout(6_000),
    })
    if (!response.ok) {
      const text = await response.text().catch(() => '')
      console.error(`[panddo-sync] ${op} → HTTP ${response.status} ${text.slice(0, 180)}`)
      return false
    }
    return true
  } catch (error) {
    console.error(`[panddo-sync] ${op} failed`, (error as Error).message)
    return false
  }
}

function mAgentsDatabaseUrl(): string {
  const line = readFileSync(process.env.M_AGENTS_ENV_PATH || '/www/apps/m-agents/.env', 'utf8')
    .split(/\r?\n/)
    .find((item) => item.startsWith('DATABASE_URL='))
  return String(line || '').slice('DATABASE_URL='.length).trim().replace(/^(['"])([\s\S]*)\1$/, '$2')
}

/** Reuse the seller row Panddo already knows from m-agents. A second id for the same seller is rejected. */
function panddoTenant(ownerId: string): { id: string; fm_owner_id: string; created_at: string } {
  const safeOwner = ownerId.replace(/[^a-zA-Z0-9_-]/g, '')
  const database = new URL(mAgentsDatabaseUrl())
  const output = execFileSync('psql', [
    '-h', database.hostname,
    '-p', database.port || '5432',
    '-U', decodeURIComponent(database.username),
    '-d', database.pathname.replace(/^\//, ''),
    '-q',
    '-t',
    '-A',
    '-v',
    'ON_ERROR_STOP=1',
    '-c',
    `INSERT INTO app_tenants (id, fm_owner_id) VALUES (gen_random_uuid(), '${safeOwner}') ON CONFLICT (fm_owner_id) DO UPDATE SET fm_owner_id = EXCLUDED.fm_owner_id RETURNING id || '|' || fm_owner_id || '|' || to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');`,
  ], {
    encoding: 'utf8',
    env: { ...process.env, PGPASSWORD: decodeURIComponent(database.password) },
  }).trim()
  const [id, fmOwnerId, createdAt] = output.split('|')
  if (!id || !fmOwnerId) throw new Error('panddo_tenant_missing')
  return { id, fm_owner_id: fmOwnerId, created_at: createdAt }
}

async function syncTenant(ownerId: string) {
  const tenant = panddoTenant(ownerId)
  await panddoSync('upsert_tenant', tenant)
  return tenant
}

export async function syncMetaAccount(ownerId: string, account: MetaAccount) {
  const tenant = await syncTenant(ownerId)
  await panddoSync('upsert_page', {
    id: account.id,
    tenant_id: tenant.id,
    provider: account.provider,
    page_id: account.externalId,
    page_name: account.displayName,
    ig_username: account.username,
    access_token: account.accessToken,
    scope: account.scope,
    status: account.status,
    connected_at: account.connectedAt.toISOString(),
  })
}

function mapProducts(products: Record<string, unknown>[]) {
  return products.map((product) => ({
    id: String(product.id || ''),
    title: String(product.title || ''),
    sku: product.sku ? String(product.sku) : null,
    price: Number(product.price || 0),
    compare_at_price: null,
    currency: product.currency ? String(product.currency) : null,
    description: product.description ? String(product.description) : null,
    image_url: product.image_url ? String(product.image_url) : null,
    status: null,
    variants: Array.isArray(product.variants)
      ? product.variants.map((variant: Record<string, unknown>) => ({
          id: String(variant.id || ''),
          title: String(variant.title || ''),
          sku: variant.sku ? String(variant.sku) : null,
          price: Number(variant.price || product.price || 0),
        }))
      : [],
  })).filter((product) => product.id && product.title && product.price > 0)
}

async function assignedProducts(ownerId: string, agent: Agent) {
  try {
    const saved = agent.productJson ? JSON.parse(agent.productJson) : []
    const picked = Array.isArray(saved) ? mapProducts(saved) : []
    if (picked.length) return picked
  } catch {
    // Fall through to the live catalog.
  }
  const config = parseAgentConfig(agent.policiesJson)
  if (!config.allProducts && agent.productScope !== 'all') return []
  const token = await ownerToken(ownerId)
  if (!token) return []
  const catalog = await listProducts(token, '', 100, agent.storeDomain || '')
  return mapProducts(catalog as unknown as Record<string, unknown>[])
}

function mAgentsSql(sql: string) {
  const database = new URL(mAgentsDatabaseUrl())
  return execFileSync('psql', [
    '-h', database.hostname,
    '-p', database.port || '5432',
    '-U', decodeURIComponent(database.username),
    '-d', database.pathname.replace(/^\//, ''),
    '-q',
    '-t',
    '-A',
    '-v',
    'ON_ERROR_STOP=1',
    '-c',
    sql,
  ], {
    encoding: 'utf8',
    env: { ...process.env, PGPASSWORD: decodeURIComponent(database.password) },
  }).trim()
}

/** Panddo sends the confirmed order to m-agents, which finds this row to build the FlashManager order. */
function saveLeadAutomation(tenantId: string, id: string, platform: string, status: string, config: Record<string, unknown>) {
  if (!/^[a-zA-Z0-9_-]+$/.test(id) || !/^[a-zA-Z0-9_-]+$/.test(tenantId)) return
  const tag = `cfg${Date.now()}`
  const json = JSON.stringify(config)
  mAgentsSql(`
    INSERT INTO automations (id, tenant_id, platform, type, status, trigger_type, post_id, config, created_at, updated_at)
    VALUES ('${id}', '${tenantId}', '${platform}', 'lead_agent', '${status}', 'all_posts', NULL, $${tag}$${json}$${tag}$::jsonb, now(), now())
    ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status, config = EXCLUDED.config, platform = EXCLUDED.platform, updated_at = now();
  `)
}

export async function syncMetaAssignment(
  ownerId: string,
  agent: Agent,
  assignment: AgentChannelAssignment,
) {
  if (assignment.channel !== 'instagram' && assignment.channel !== 'facebook') return
  const account = await prisma.metaAccount.findFirst({
    where: { id: assignment.endpointId, ownerId, provider: assignment.channel },
  })
  if (!account) return
  const tenant = panddoTenant(ownerId)
  await syncMetaAccount(ownerId, account)
  const config = parseAgentConfig(agent.policiesJson)
  const details = safeJson(assignment.detailsJson)
  const triggerType = details.triggerType === 'specific_post' ? 'specific_post' : 'all_posts'
  const selectedPosts = Array.isArray(details.selectedPosts)
    ? details.selectedPosts.filter((post): post is Record<string, unknown> =>
        Boolean(post && typeof post === 'object' && !Array.isArray(post) && post.id),
      ).map((post) => ({
        id: String(post.id),
        caption: String(post.caption || ''),
      }))
    : []
  const status = agent.enabled && config.desiredStatus === 'active' ? 'active' : 'paused'
  const sharedConfig = {
    platform: assignment.channel,
    pageId: account.id,
    pageName: assignment.displayName,
    selectedPosts,
    postId: selectedPosts[0]?.id || null,
    postCaption: selectedPosts[0]?.caption || null,
    keywordFilterEnabled: false,
    keywords: [],
    commentReplies: [],
    autoDmEnabled: false,
    dmMessages: [],
    dmLink: '',
    protection: {
      enabled: true,
      insults: { skip: true, remove: false },
      critique: { skip: false, remove: false },
      unanswerable: { skip: false, remove: false },
      begging: { skip: false, remove: false },
    },
    aiTone: config.tone,
    aiInstructions: config.instructions || agent.prompt,
    assignedProducts: await assignedProducts(ownerId, agent),
    leadCapture: {
      enabled: true,
      fields: [
        { key: 'FULL_NAME', label: 'Full Name', required: true, builtin: true },
        { key: 'PHONE_NUMBER', label: 'Phone Number', required: true, builtin: true },
        { key: 'CITY', label: 'City', required: true, builtin: true },
        { key: 'ADDRESS', label: 'Address', required: true, builtin: true },
      ],
      aiPrompt: 'Answer the customer first. Collect order details only when they want to buy.',
      notifyNumber: '',
      confirmationTemplate: 'Order confirmed for {FULL_NAME}. We will contact you shortly.',
    },
    metaPixel: null,
  }
  const tone = config.tone === 'professional' ? 'professional' : config.tone === 'fun' ? 'fun' : 'friendly'
  const baseRecord = {
    tenant_id: tenant.id,
    fm_owner_id: tenant.fm_owner_id,
    platform: assignment.channel,
    status,
    created_at: agent.createdAt.toISOString(),
    updated_at: agent.updatedAt.toISOString(),
  }
  sharedConfig.aiTone = tone

  // Remove the first implementation's single runtime row before publishing
  // the separate DM and comment automations.
  const leadConfig = {
    ...sharedConfig,
    triggerType: 'all_posts' as const,
    selectedPosts: [],
    postId: null,
    postCaption: null,
    replyMode: 'ai' as const,
  }
  const leadId = `${agent.id}_${assignment.id}_dm`
  saveLeadAutomation(tenant.id, leadId, assignment.channel, status, leadConfig)
  await panddoSync('delete_automation', { id: `${agent.id}_${assignment.id}` })
  await panddoSync('upsert_automation', {
    ...baseRecord,
    id: leadId,
    type: 'lead_agent',
    trigger_type: 'all_posts',
    post_id: null,
    config: leadConfig,
  })
  await panddoSync('upsert_automation', {
    ...baseRecord,
    id: `${agent.id}_${assignment.id}_comments`,
    type: 'comments',
    trigger_type: triggerType,
    post_id: selectedPosts[0]?.id || null,
    config: {
      ...sharedConfig,
      assignedProducts: [],
      triggerType,
      replyMode: 'ai',
    },
  })
}

export async function deleteMetaAssignmentSync(agentId: string, assignmentId: string) {
  const leadId = `${agentId}_${assignmentId}_dm`
  if (/^[a-zA-Z0-9_-]+$/.test(leadId)) {
    try {
      mAgentsSql(`DELETE FROM automations WHERE id = '${leadId}' AND type = 'lead_agent';`)
    } catch (error) {
      console.error('[panddo-sync] local automation delete failed', (error as Error).message)
    }
  }
  await Promise.all([
    panddoSync('delete_automation', { id: `${agentId}_${assignmentId}` }),
    panddoSync('delete_automation', { id: leadId }),
    panddoSync('delete_automation', { id: `${agentId}_${assignmentId}_comments` }),
  ])
}
