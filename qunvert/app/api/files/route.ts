export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { transcribeAudio } from '@/lib/aiRuntime'
import { gatewayErrorMessage, gw, requireOwner } from '@/lib/fm'
import { ownerToken } from '@/lib/tenants'

type GatewayFile = {
  id: string
  name: string
  contentType: string
  kind: string
  size: number
  url?: string
}

async function tokensFor(owner: { ownerId: string; token: string }) {
  const grant = await ownerToken(owner.ownerId)
  return [...new Set([owner.token, grant].filter(Boolean))] as string[]
}

function filesError(error: unknown, fallback: string) {
  const message = gatewayErrorMessage(error, fallback)
  const status = /files:read|files:write|isn’t enabled/i.test(message) ? 403 : 502
  return NextResponse.json({ error: message }, { status })
}

export async function GET(req: Request) {
  const owner = await requireOwner(req)
  if (!owner) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  let lastError: unknown = null
  for (const token of await tokensFor(owner)) {
    try {
      const data = await gw<{ files?: GatewayFile[] }>('/v1/files?limit=100', token)
      return NextResponse.json({ files: Array.isArray(data.files) ? data.files : [] })
    } catch (error) {
      lastError = error
    }
  }
  return filesError(lastError, 'Could not load FlashManager Files.')
}

export async function POST(req: Request) {
  const owner = await requireOwner(req)
  if (!owner) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  try {
    const incoming = await req.formData()
    const file = incoming.get('file')
    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'file_required' }, { status: 400 })
    }
    if (file.size > 50 * 1024 * 1024) {
      return NextResponse.json({ error: 'File is larger than 50 MB.' }, { status: 413 })
    }

    const kind = file.type.startsWith('image/')
      ? 'image'
      : file.type.startsWith('video/')
        ? 'video'
        : file.type.startsWith('audio/')
          ? 'audio'
          : 'file'
    const bytes = Buffer.from(await file.arrayBuffer())
    let lastError: unknown = null
    for (const token of await tokensFor(owner)) {
      try {
        const payload = new FormData()
        payload.append('file', new Blob([new Uint8Array(bytes)], { type: file.type || 'application/octet-stream' }), file.name)
        payload.append('name', file.name)
        payload.append('kind', kind)
        payload.append('meta', JSON.stringify({ source: 'qunvert-agent-prompt' }))
        const data = await gw<{ file: GatewayFile }>('/v1/files', token, {
          method: 'POST',
          body: payload,
        })
        let transcript = ''
        const wantTranscript = new URL(req.url).searchParams.get('transcribe') === '1'
        if (wantTranscript && kind === 'audio') {
          transcript = await transcribeAudio(bytes, file.name).catch(() => '')
        }
        return NextResponse.json({ file: data.file, transcript })
      } catch (error) {
        lastError = error
      }
    }
    return filesError(lastError, 'Could not upload this file.')
  } catch (error) {
    return filesError(error, 'Could not upload this file.')
  }
}
