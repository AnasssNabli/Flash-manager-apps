import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mediaIdOf, messageKindOf, previewLabelForMessage } from '../lib/waMedia'

test('history phone media without a file id is a placeholder, not generic text', () => {
  const msg = {
    type: 'media_placeholder',
    body: null,
    media_url: null,
    metadata: { source: 'history_import', message_type: 'media_placeholder' },
  }
  assert.equal(messageKindOf(msg), 'placeholder')
  assert.equal(mediaIdOf(msg), null)
  assert.equal(previewLabelForMessage(msg), '📷 Media')
})

test('history error payloads without media are unsupported', () => {
  const msg = {
    type: 'errors',
    body: null,
    media_url: null,
    metadata: { source: 'history_import', message_type: 'errors' },
  }
  assert.equal(messageKindOf(msg), 'unsupported')
  assert.equal(previewLabelForMessage(msg), 'Message not available')
})

test('real inbound images keep their media id', () => {
  const msg = {
    type: 'image',
    body: 'Hawa khrj lia tani',
    media_url: '1795239834812830',
    metadata: { source: 'history_import', message_type: 'image' },
  }
  assert.equal(messageKindOf(msg), 'image')
  assert.equal(mediaIdOf(msg), '1795239834812830')
  assert.equal(previewLabelForMessage(msg), 'Hawa khrj lia tani')
})

test('voice notes and nested metadata ids resolve', () => {
  assert.equal(messageKindOf({ type: 'ptt', media_url: '1' }), 'audio')
  assert.equal(mediaIdOf({
    type: 'unknown',
    metadata: { image: { id: '998877' } },
  }), '998877')
})
