import assert from 'node:assert/strict'
import { test } from 'node:test'
import { isOptimisticId, takeServerMatch } from '../lib/optimisticSend'

test('optimistic ids are local-only placeholders', () => {
  assert.equal(isOptimisticId('pending-abc'), true)
  assert.equal(isOptimisticId('wamid.HBgM'), false)
})

test('pending text is covered by the matching outbound copy', () => {
  const claimed = new Set<string>()
  const match = takeServerMatch(
    {
      id: 'pending-1',
      direction: 'outbound',
      type: 'text',
      body: 'message d conifrmation?',
      timestamp: '2026-09-18T17:30:00.000Z',
    },
    [
      {
        id: 'srv-1',
        direction: 'outbound',
        type: 'text',
        body: 'message d conifrmation?',
        timestamp: '2026-09-18T17:30:01.200Z',
      },
    ],
    claimed,
  )
  assert.equal(match, 'srv-1')
})

test('two identical pending texts match two server copies in order', () => {
  const claimed = new Set<string>()
  const first = {
    id: 'pending-1',
    direction: 'outbound' as const,
    type: 'text',
    body: 'ok',
    timestamp: '2026-09-18T17:30:00.000Z',
  }
  const second = { ...first, id: 'pending-2', timestamp: '2026-09-18T17:30:02.000Z' }
  const server = [
    { id: 'srv-a', direction: 'outbound', type: 'text', body: 'ok', timestamp: '2026-09-18T17:30:00.400Z' },
    { id: 'srv-b', direction: 'outbound', type: 'text', body: 'ok', timestamp: '2026-09-18T17:30:02.300Z' },
  ]
  const a = takeServerMatch(first, server, claimed)
  if (a) claimed.add(a)
  const b = takeServerMatch(second, server, claimed)
  assert.equal(a, 'srv-a')
  assert.equal(b, 'srv-b')
})

test('an older identical text does not steal a new pending bubble', () => {
  const match = takeServerMatch(
    {
      id: 'pending-new',
      direction: 'outbound',
      type: 'text',
      body: 'ok',
      timestamp: '2026-09-18T17:30:00.000Z',
    },
    [
      {
        id: 'srv-old',
        direction: 'outbound',
        type: 'text',
        body: 'ok',
        timestamp: '2026-09-18T17:20:00.000Z',
      },
    ],
    new Set(),
  )
  assert.equal(match, null)
})
