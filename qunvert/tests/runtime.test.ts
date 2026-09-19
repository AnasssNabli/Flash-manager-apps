import assert from 'node:assert/strict'
import { test } from 'node:test'
import { comparablePhone, normalizePhone, normalizedStopWord, parseAgentConfig } from '../lib/agentConfig'
import { CONTEXT_DISCIPLINE, extractTemplateFields, fillConfirmationTemplate, formatProductCatalogue, isContextLengthError, isImageInputError } from '../lib/aiRuntime'
import { collapseRepeatedPhrases, customerAskedToWait, isDoNotAnswerTool, isSessionWindowError } from '../lib/replyQuality'
import {
  hitAiReplyLimit,
  humanTookOver,
  isBlockedPhone,
  isOlderHumanConversation,
  matchesStopWord,
  overflowManagedLabelIds,
  overResponseBudget,
  promisedHumanHandoff,
  remainingResponseBudget,
  shouldPauseForHuman,
  shouldWaitForRapidBatch,
} from '../lib/gates'
import { extractMediaTokens } from '../lib/media'
import { orderFingerprint } from '../lib/orders'
import { collapseMirroredThread } from '../lib/threadDedupe'
import { mergeWhatsAppLabels, parseWhatsAppLabels } from '../lib/wa'
import { audioFileName, isAudioMessage, isVisualMessage, mediaIdOf, messageKindOf, sniffImageMime } from '../lib/inboundMedia'

test('normalizes Moroccan and international phones to the last 9 digits', () => {
  assert.equal(comparablePhone('+212 6 12 34 56 78'), '612345678')
  assert.equal(comparablePhone('0612345678'), '612345678')
  assert.equal(comparablePhone('212612345678'), '612345678')
  assert.equal(normalizePhone('ab12cd34'), '1234')
})

test('blocklist matches equivalent phone formats', () => {
  assert.equal(isBlockedPhone('+212612345678\n0770000000', '0612345678'), true)
  assert.equal(isBlockedPhone('0612345678', '0770000000'), false)
})

test('stop word is exact after unicode and case folding', () => {
  assert.equal(matchesStopWord('STOP', ' stop '), true)
  assert.equal(matchesStopWord('stop', 'please stop'), false)
  assert.equal(matchesStopWord('', 'stop'), false)
  assert.equal(normalizedStopWord('STOP'), 'stop')
  assert.equal(matchesStopWord('stop', 'STOP'), true)
})

test('older conversation gate respects first-message and prior AI replies', () => {
  assert.equal(isOlderHumanConversation({
    answerOlderConversations: false,
    isFirstCustomerMessage: false,
    agentHasReplied: false,
    humanOutboundCount: 2,
  }), true)
  assert.equal(isOlderHumanConversation({
    answerOlderConversations: false,
    isFirstCustomerMessage: true,
    agentHasReplied: false,
    humanOutboundCount: 4,
  }), false)
  assert.equal(isOlderHumanConversation({
    answerOlderConversations: false,
    isFirstCustomerMessage: false,
    agentHasReplied: true,
    humanOutboundCount: 4,
  }), false)
})

test('human timeout pauses only after a later human message, never after AI', () => {
  const now = Date.parse('2026-09-15T12:00:00Z')
  assert.equal(humanTookOver(now - 60_000, now - 10_000), false)
  assert.equal(humanTookOver(now - 10_000, now - 60_000), true)
  assert.equal(shouldPauseForHuman({
    resumeAfterTakeover: true,
    resumeAfterMinutes: 5,
    isFirstCustomerMessage: true,
    state: 'human_active',
    humanTookOver: true,
    lastHumanAt: new Date(now - 30_000),
    now,
  }), false)
  assert.equal(shouldPauseForHuman({
    resumeAfterTakeover: true,
    resumeAfterMinutes: 5,
    isFirstCustomerMessage: false,
    state: 'human_active',
    humanTookOver: true,
    lastHumanAt: new Date(now - 30_000),
    now,
  }), true)
  assert.equal(shouldPauseForHuman({
    resumeAfterTakeover: true,
    resumeAfterMinutes: 5,
    isFirstCustomerMessage: false,
    state: 'human_active',
    humanTookOver: true,
    lastHumanAt: new Date(now - 6 * 60_000),
    now,
  }), false)
  assert.equal(shouldPauseForHuman({
    resumeAfterTakeover: false,
    resumeAfterMinutes: 5,
    isFirstCustomerMessage: false,
    state: 'human_active',
    humanTookOver: true,
    lastHumanAt: new Date(now - 30_000),
    now,
  }), false)
  assert.equal(shouldPauseForHuman({
    resumeAfterTakeover: true,
    resumeAfterMinutes: 5,
    isFirstCustomerMessage: false,
    state: 'stopped',
    humanTookOver: false,
    now,
  }), true)
})

test('first customer message still cannot override a stopped conversation', () => {
  assert.equal(shouldPauseForHuman({
    resumeAfterTakeover: true,
    resumeAfterMinutes: 5,
    isFirstCustomerMessage: true,
    state: 'stopped',
    humanTookOver: false,
  }), true)
})

test('human-requested chats stay silent until the resume window after the last human-mode message', () => {
  const now = Date.parse('2026-09-16T13:01:00Z')
  const handedOffAt = new Date(Date.parse('2026-09-16T12:56:00Z'))
  const laterCustomerAt = new Date(Date.parse('2026-09-16T12:56:10Z'))
  assert.equal(shouldPauseForHuman({
    resumeAfterTakeover: true,
    resumeAfterMinutes: 5,
    isFirstCustomerMessage: false,
    state: 'human_requested',
    humanTookOver: false,
    humanRequestedAt: handedOffAt,
    lastCustomerAt: laterCustomerAt,
    now,
  }), true)
  assert.equal(shouldPauseForHuman({
    resumeAfterTakeover: true,
    resumeAfterMinutes: 5,
    isFirstCustomerMessage: false,
    state: 'human_requested',
    humanTookOver: false,
    humanRequestedAt: handedOffAt,
    lastCustomerAt: laterCustomerAt,
    now: laterCustomerAt.getTime() + 10_000,
  }), true)
  assert.equal(shouldPauseForHuman({
    resumeAfterTakeover: true,
    resumeAfterMinutes: 5,
    isFirstCustomerMessage: false,
    state: 'human_requested',
    humanTookOver: false,
    humanRequestedAt: handedOffAt,
    lastCustomerAt: laterCustomerAt,
    now: laterCustomerAt.getTime() + 6 * 60_000,
  }), false)
  assert.equal(shouldPauseForHuman({
    resumeAfterTakeover: false,
    resumeAfterMinutes: 5,
    isFirstCustomerMessage: false,
    state: 'human_requested',
    humanTookOver: false,
    humanRequestedAt: handedOffAt,
    now: laterCustomerAt.getTime() + 60 * 60_000,
  }), true)
  assert.equal(shouldPauseForHuman({
    resumeAfterTakeover: true,
    resumeAfterMinutes: 5,
    isFirstCustomerMessage: true,
    state: 'human_requested',
    humanTookOver: false,
    humanRequestedAt: handedOffAt,
    now,
  }), true)
  assert.equal(shouldPauseForHuman({
    resumeAfterTakeover: true,
    resumeAfterMinutes: 5,
    isFirstCustomerMessage: false,
    state: 'human_active',
    humanTookOver: true,
    lastHumanAt: new Date(now - 6 * 60_000),
    lastCustomerAt: new Date(now - 30_000),
    now,
  }), true)
})

test('the model is forbidden from interviewing when it lacks context', () => {
  assert.match(CONTEXT_DISCIPLINE, /Never interview the customer/)
  assert.match(CONTEXT_DISCIPLINE, /cannot_help/)
  assert.match(CONTEXT_DISCIPLINE, /only allowed questions are missing required order fields/)
  assert.doesNotMatch(CONTEXT_DISCIPLINE, /If you are not sure, ask a clarification/)
})

test('handoff wording is treated as a human-mode promise', () => {
  assert.equal(promisedHumanHandoff('أكيد، غادي نحولك مع واحد من الفريق دابا'), true)
  assert.equal(promisedHumanHandoff('I will attach you to a human now'), true)
  assert.equal(promisedHumanHandoff('I notified human support for you'), true)
  assert.equal(promisedHumanHandoff('What city should we deliver to?'), false)
})

test('response budget never goes unlimited and hard-stops at 60', () => {
  assert.equal(remainingResponseBudget(0, 99), 0)
  assert.equal(remainingResponseBudget(30, 29), 1)
  assert.equal(remainingResponseBudget(999, 0), 60)
  assert.equal(overResponseBudget(30, 29, 2), true)
  assert.equal(overResponseBudget(0, 50, 1), false)
  assert.equal(overResponseBudget(0, 60, 1), true)
  assert.equal(hitAiReplyLimit(60, 59), false)
  assert.equal(hitAiReplyLimit(60, 60), true)
  assert.equal(hitAiReplyLimit(0, 60), true)
})

test('rapid messages wait for a 5s quiet window', () => {
  const now = 1_000_000
  assert.equal(shouldWaitForRapidBatch(now - 2000, now), true)
  assert.equal(shouldWaitForRapidBatch(now - 5000, now), false)
})

test('media tokens are stripped and collected without duplicating names', () => {
  const parsed = extractMediaTokens('Hello {media:catalog.png} {media:catalog.png}\n{product_media:x}')
  assert.equal(parsed.cleanText, 'Hello')
  assert.deepEqual(parsed.names, ['catalog.png'])
})

test('confirmation template maps mixed placeholder styles and drops media tokens', () => {
  const template = 'Hi {Full Name} / {{PHONE NUMBER}} / [City]\n{media:receipt.png}'
  const fields = extractTemplateFields(template)
  assert.ok(fields.keys.includes('customer_name'))
  assert.ok(fields.keys.includes('customer_phone'))
  assert.ok(fields.keys.includes('customer_city'))
  assert.ok(!fields.placeholders.some((item) => item.toLowerCase().startsWith('media:')))
  const filled = fillConfirmationTemplate(template, {
    customer_name: 'Sara',
    customer_city: 'Casablanca',
  }, '0612345678')
  assert.equal(filled.includes('Sara'), true)
  assert.equal(filled.includes('0612345678'), true)
  assert.equal(filled.includes('Casablanca'), true)
  assert.equal(filled.includes('{media:'), false)
})

test('order fingerprint is stable for the same cart and phone', () => {
  const a = orderFingerprint('+212612345678', { product_name: 'Bag', quantity: 1, price: '120', total_amount: '120' })
  const b = orderFingerprint('0612345678', { items: [{ product_name: 'Bag', quantity: 1, price: '120' }], total_amount: '120' })
  assert.equal(a, b)
})

test('custom labels keep the newest three managed ids', () => {
  assert.deepEqual(overflowManagedLabelIds(['d', 'c', 'b', 'a'], 3), ['a'])
})

test('compressed catalogue is shorter than the full card layout', () => {
  const products = [{
    id: '1',
    title: 'Leather bag',
    price: '199',
    currency: 'MAD',
    description: 'A long description that should disappear when compressed.',
    variants: [{ title: 'Black', price: '199', sku: 'B1' }],
  }] as any
  const full = formatProductCatalogue(products)
  const compact = formatProductCatalogue(products, true)
  assert.ok(compact.length < full.length)
  assert.equal(compact.includes('Leather bag'), true)
  assert.equal(compact.includes('long description'), false)
})

test('parseAgentConfig fills follow-up defaults as off / 3 hours', () => {
  const config = parseAgentConfig('{"purpose":"support"}')
  assert.equal(config.followUp.enabled, false)
  assert.equal(config.followUp.hours, 3)
  assert.equal(config.purpose, 'support')
  assert.equal(config.answerOlderConversations, true)
  assert.equal(config.maxResponses, 60)
})

test('parseAgentConfig clamps max AI replies per chat to 60', () => {
  assert.equal(parseAgentConfig({ maxResponses: 12 }).maxResponses, 12)
  assert.equal(parseAgentConfig({ maxResponses: 0 }).maxResponses, 60)
  assert.equal(parseAgentConfig({ maxResponses: 400 }).maxResponses, 60)
})

test('model error classifiers detect context and image failures', () => {
  assert.equal(isContextLengthError(new Error('context_length_exceeded')), true)
  assert.equal(isImageInputError(new Error('invalid_image_url')), true)
  assert.equal(isContextLengthError(new Error('rate_limit')), false)
})

test('parseAgentConfig accepts a live object draft', () => {
  const config = parseAgentConfig({ instructions: 'Sell gently', resumeAfterMinutes: 8 })
  assert.equal(config.instructions, 'Sell gently')
  assert.equal(config.resumeAfterMinutes, 8)
  assert.equal(config.purpose, 'leads')
})

test('WhatsApp label payloads normalize to unique named options', () => {
  const labels = parseWhatsAppLabels({
    labels: [
      { id: '1', name: 'New lead' },
      { id: '2', title: 'Paid' },
      'VIP',
      { id: '3', name: 'new lead' },
    ],
  })
  assert.deepEqual(labels.map((item) => item.name), ['New lead', 'Paid', 'VIP'])
  const nested = parseWhatsAppLabels({
    data: { result: { labels: [{ id: 'l1', name: 'Hot lead' }] } },
  })
  assert.equal(nested[0]?.name, 'Hot lead')
})

test('WhatsApp label lists merge unique names and ignore blanks', () => {
  const labels = mergeWhatsAppLabels(
    [{ id: '1', name: 'New lead' }, { id: '2', name: 'Paid' }],
    [{ id: 'new-lead', name: 'new lead' }, { id: '', name: '' }, { id: '3', name: 'VIP' }],
  )
  assert.deepEqual(labels.map((item) => item.name), ['New lead', 'Paid', 'VIP'])
})

test('seller phone echoes that landed on both sides keep only the outbound copy', () => {
  const messages = collapseMirroredThread([
    {
      id: 'in',
      direction: 'inbound',
      from_phone: '212600000001',
      to_phone: '212701400620',
      body: 'ahhh fhemt',
      timestamp: '2026-09-18T16:52:00.000Z',
    },
    {
      id: 'out',
      direction: 'outbound',
      from_phone: '1122693277592895',
      to_phone: '212600000001',
      body: 'ahhh fhemt',
      timestamp: '2026-09-18T16:52:00.200Z',
    },
  ])
  assert.deepEqual(messages.map((item) => item.id), ['out'])
})

test('concurrent ticks are serialized by unique inbound claim keys', () => {
  const first = new Set<string>()
  const inboundId = 'wamid.ABC'
  const claim = (ownerId: string) => {
    const key = `${ownerId}:${inboundId}`
    if (first.has(key)) return false
    first.add(key)
    return true
  }
  assert.equal(claim('owner-1'), true)
  assert.equal(claim('owner-1'), false)
  assert.equal(claim('owner-2'), true)
})

test('collapseRepeatedPhrases drops the same sentence copied three times', () => {
  const payment = 'لا الدفع غير عند الاستلام فقط 💰 لا الدفع غير عند الاستلام فقط 💰 لا الدفع غير عند الاستلام فقط'
  assert.equal(collapseRepeatedPhrases(payment), 'لا الدفع غير عند الاستلام فقط')
  const wait = 'واخا، غادي نتناظر حتى تسالي ومن بعد نجاوبك.واخا، غادي نتناظر حتى تسالي ومن بعد نجاوبك.واخا، غادي نتناظر حتى تسالي ومن بعد نجاوبك.'
  const collapsedWait = collapseRepeatedPhrases(wait)
  assert.equal((collapsedWait.match(/واخا/g) || []).length, 1)
  assert.equal(collapseRepeatedPhrases('Thanks, noted.'), 'Thanks, noted.')
})

test('customerAskedToWait only matches the latest wait-to-finish line', () => {
  assert.equal(customerAskedToWait('حتا تكون مسالي عاد جاوب'), true)
  assert.equal(customerAskedToWait('Wait until I finish then answer'), true)
  assert.equal(customerAskedToWait('I will wait for delivery'), false)
  assert.equal(customerAskedToWait('How much is it?\nحتا تكون مسالي عاد جاوب'), true)
  assert.equal(customerAskedToWait('حتا تكون مسالي عاد جاوب\nبكم الثمن؟'), false)
})

test('donotanswer tool names normalize and 24h send errors are detected', () => {
  assert.equal(isDoNotAnswerTool('donotanswer'), true)
  assert.equal(isDoNotAnswerTool('do_not_answer'), true)
  assert.equal(isDoNotAnswerTool('request_human_agent'), false)
  assert.equal(isSessionWindowError('Not delivered — 24h window closed (needs a template)'), true)
  assert.equal(isSessionWindowError('send_failed'), false)
})

test('inbound media kinds resolve voice notes, nested ids, and image bytes', () => {
  assert.equal(isAudioMessage({ type: 'ptt', media_url: '1' }), true)
  assert.equal(isAudioMessage({ type: 'audio' }), true)
  assert.equal(isVisualMessage({ type: 'image', media_url: '179' }), true)
  assert.equal(isVisualMessage({ type: 'sticker', media_url: '179' }), true)
  assert.equal(mediaIdOf({ type: 'unknown', metadata: { image: { id: '998877' } } }), '998877')
  assert.equal(mediaIdOf({ type: 'image', media_url: 'wamid.ABC', metadata: { media_id: '12345' } }), '12345')
  assert.equal(messageKindOf({ type: 'voice' }), 'audio')
  assert.equal(audioFileName('audio/ogg; codecs=opus'), 'voice.ogg')
  assert.equal(sniffImageMime(Buffer.from([0xff, 0xd8, 0xff, 0xe0]), 'application/octet-stream'), 'image/jpeg')
})
