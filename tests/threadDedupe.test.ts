import assert from 'node:assert/strict'
import { test } from 'node:test'
import { collapseMirroredThread } from '../lib/threadDedupe'

test('seller phone text that landed on both sides keeps only the outbound bubble', () => {
  const messages = collapseMirroredThread([
    {
      id: 'in-1',
      wa_message_id: 'wamid.in1',
      direction: 'inbound',
      from_phone: '212600000001',
      to_phone: '212701400620',
      body: 'message d conifrmation?',
      type: 'text',
      timestamp: '2026-09-18T16:49:00.000Z',
    },
    {
      id: 'out-1',
      wa_message_id: 'wamid.out1',
      direction: 'outbound',
      from_phone: '1122693277592895',
      to_phone: '212600000001',
      body: 'message d conifrmation?',
      type: 'text',
      timestamp: '2026-09-18T16:49:00.400Z',
    },
    {
      id: 'in-audio',
      wa_message_id: 'wamid.audio',
      direction: 'inbound',
      from_phone: '212600000001',
      to_phone: '212701400620',
      body: null,
      type: 'audio',
      timestamp: '2026-09-18T16:50:00.000Z',
      media_url: '12345',
    },
  ])
  assert.deepEqual(messages.map((msg) => msg.id), ['out-1', 'in-audio'])
  assert.equal(messages[0]?.direction, 'outbound')
})

test('inbound messages sent from the business number are shown as outbound', () => {
  const messages = collapseMirroredThread([
    {
      id: 'echo',
      direction: 'inbound',
      from_phone: '212701400620',
      to_phone: '212600000001',
      body: 'ana swltek hitash glti dazt',
      type: 'audio',
      timestamp: '2026-09-18T16:51:00.000Z',
      media_url: '999',
    },
  ], ['+212 7 01 40 06 20'])
  assert.equal(messages[0]?.direction, 'outbound')
})

test('duplicate wamids keep a single outbound copy', () => {
  const messages = collapseMirroredThread([
    {
      id: 'a',
      wa_message_id: 'wamid.same',
      direction: 'inbound',
      body: 'ahhh fhemt',
      timestamp: '2026-09-18T16:52:00.000Z',
    },
    {
      id: 'b',
      wa_message_id: 'wamid.same',
      direction: 'outbound',
      body: 'ahhh fhemt',
      timestamp: '2026-09-18T16:52:00.000Z',
    },
  ])
  assert.equal(messages.length, 1)
  assert.equal(messages[0]?.id, 'b')
})

test('real customer replies are not dropped', () => {
  const messages = collapseMirroredThread([
    {
      id: 'out',
      direction: 'outbound',
      from_phone: '212701400620',
      to_phone: '212600000001',
      body: 'How can I help?',
      timestamp: '2026-09-18T16:00:00.000Z',
    },
    {
      id: 'in',
      direction: 'inbound',
      from_phone: '212600000001',
      to_phone: '212701400620',
      body: 'I want to order',
      timestamp: '2026-09-18T16:00:08.000Z',
    },
  ])
  assert.deepEqual(messages.map((msg) => msg.id), ['out', 'in'])
  assert.equal(messages[1]?.direction, 'inbound')
})

test('from_me echoes are dropped instead of painted green beside the real outbound', () => {
  const messages = collapseMirroredThread([
    {
      id: 'in-echo',
      wa_message_id: 'wamid.in',
      direction: 'inbound',
      from_phone: '212600000001',
      to_phone: '212701400620',
      body: 'ahhh fhemt',
      timestamp: '2026-09-18T16:52:00.000Z',
      metadata: { from_me: true },
    },
    {
      id: 'out-real',
      wa_message_id: 'wamid.out',
      direction: 'outbound',
      from_phone: '1122693277592895',
      to_phone: '212600000001',
      body: 'ahhh fhemt',
      timestamp: '2026-09-18T16:52:00.300Z',
    },
  ])
  assert.deepEqual(messages.map((msg) => msg.id), ['out-real'])
  assert.equal(messages[0]?.direction, 'outbound')
})

test('outbound from_phone being the customer does not flip their replies to the seller side', () => {
  const messages = collapseMirroredThread([
    {
      id: 'out',
      direction: 'outbound',
      from_phone: '212781953811',
      to_phone: '212781953811',
      body: 'Kartsana',
      timestamp: '2026-09-18T16:23:00.000Z',
    },
    {
      id: 'in',
      direction: 'inbound',
      from_phone: '212781953811',
      to_phone: '212701400620',
      body: 'https://tomoore.ma/',
      timestamp: '2026-09-18T16:27:00.000Z',
    },
  ])
  assert.equal(messages.find((msg) => msg.id === 'in')?.direction, 'inbound')
})
