'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { apiJson } from '@/lib/waApi'

export type CallUiState =
  | 'idle'
  | 'checking'
  | 'requesting'
  | 'waiting_permission'
  | 'connecting'
  | 'ringing'
  | 'connected'
  | 'ended'

interface PermissionRes {
  success?: boolean
  granted?: boolean
  status?: string
  expiresAt?: string | null
  error?: string
  isShared?: boolean
  callingEnabled?: boolean
  callingError?: string | null
}

interface ConnectRes {
  success?: boolean
  id?: string
  status?: string
  error?: string
  code?: number
}

interface CallPollRes {
  success?: boolean
  status?: string
  answerSdp?: string | null
  error?: string
  errorCode?: string | null
}

function waitForIceComplete(pc: RTCPeerConnection, timeoutMs = 8000): Promise<void> {
  if (pc.iceGatheringState === 'complete') return Promise.resolve()
  return new Promise(resolve => {
    const t = setTimeout(() => {
      pc.removeEventListener('icegatheringstatechange', onChange)
      resolve()
    }, timeoutMs)
    const onChange = () => {
      if (pc.iceGatheringState === 'complete') {
        clearTimeout(t)
        pc.removeEventListener('icegatheringstatechange', onChange)
        resolve()
      }
    }
    pc.addEventListener('icegatheringstatechange', onChange)
  })
}

/** Meta blocks business-initiated calling from US, Canada, Egypt, Vietnam, Nigeria. */
export function outboundCallingBlockedCountry(displayOrE164: string | null | undefined): boolean {
  const digits = String(displayOrE164 || '').replace(/[^\d]/g, '')
  if (!digits) return false
  if (digits.startsWith('234')) return true
  if (digits.startsWith('84') && digits.length >= 10) return true
  if (digits.startsWith('20') && digits.length >= 11) return true
  if (digits.startsWith('1') && digits.length === 11) return true
  return false
}

export function useWhatsAppCall(opts: {
  phone: string | null
  sharedNumber?: boolean
  /** Seller's own WhatsApp number — used to refuse outbound in Meta-blocked countries. */
  connectedPhone?: string | null
  contactName?: string | null
  addToast: (type: 'error' | 'success', message: string) => void
  onPermissionSent?: () => void
}) {
  const { phone, sharedNumber, connectedPhone, addToast, onPermissionSent } = opts
  const [state, setState] = useState<CallUiState>('idle')
  const [muted, setMuted] = useState(false)
  const [elapsedSec, setElapsedSec] = useState(0)
  const [error, setError] = useState<string | null>(null)

  const pcRef = useRef<RTCPeerConnection | null>(null)
  const localStreamRef = useRef<MediaStream | null>(null)
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null)
  const callIdRef = useRef<string | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const hangupRef = useRef<(opts?: { skipServer?: boolean }) => Promise<void>>(async () => {})

  const stopTimer = () => {
    if (timerRef.current) clearInterval(timerRef.current)
    timerRef.current = null
  }

  const stopPoll = () => {
    if (pollRef.current) clearInterval(pollRef.current)
    pollRef.current = null
  }

  const teardownMedia = () => {
    pcRef.current?.getSenders().forEach(s => s.track?.stop())
    localStreamRef.current?.getTracks().forEach(t => t.stop())
    localStreamRef.current = null
    try {
      pcRef.current?.close()
    } catch {
      /* already closed */
    }
    pcRef.current = null
    if (remoteAudioRef.current) remoteAudioRef.current.srcObject = null
  }

  const hangUp = useCallback(async (hangOpts?: { skipServer?: boolean }) => {
    stopPoll()
    stopTimer()
    const id = callIdRef.current
    callIdRef.current = null
    teardownMedia()
    setMuted(false)
    setState(prev => (prev === 'idle' ? prev : 'ended'))
    if (!hangOpts?.skipServer && id) {
      await apiJson('/wa/calls', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'terminate', callId: id }),
      }).catch(() => {})
    }
    setTimeout(() => setState('idle'), 1200)
  }, [])

  hangupRef.current = hangUp

  useEffect(() => {
    return () => {
      hangupRef.current({ skipServer: false })
    }
  }, [])

  useEffect(() => {
    hangupRef.current({ skipServer: false })
    setError(null)
    setState('idle')
  }, [phone])

  const attachRemote = (stream: MediaStream) => {
    const el = remoteAudioRef.current
    if (!el) return
    el.srcObject = stream
    el.play().catch(() => {})
  }

  const startWebRtc = useCallback(async (to: string) => {
    setState('connecting')
    setError(null)
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false })
    localStreamRef.current = stream
    const pc = new RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
    })
    pcRef.current = pc
    stream.getTracks().forEach(t => pc.addTrack(t, stream))
    pc.ontrack = ev => {
      const remote = ev.streams[0] || new MediaStream(ev.track ? [ev.track] : [])
      attachRemote(remote)
    }
    const offer = await pc.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: false })
    await pc.setLocalDescription(offer)
    await waitForIceComplete(pc)
    const sdp = pc.localDescription?.sdp
    if (!sdp) throw new Error('Could not build the call offer')

    const res = await apiJson<ConnectRes>('/wa/calls', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'connect', to, sdp }),
    })
    if (!res.success || !res.id) {
      throw new Error(res.error || 'Could not start the WhatsApp call')
    }
    callIdRef.current = res.id
    setState('ringing')

    const started = Date.now()
    pollRef.current = setInterval(async () => {
      const id = callIdRef.current
      if (!id) return
      const poll = await apiJson<CallPollRes>(`/wa/calls/${encodeURIComponent(id)}`)
      if (!poll.success) return

      if (poll.answerSdp && pc.signalingState !== 'closed' && !pc.currentRemoteDescription) {
        try {
          await pc.setRemoteDescription({ type: 'answer', sdp: poll.answerSdp })
        } catch (e) {
          console.warn('[WA call] setRemoteDescription failed', e)
        }
      }

      if (poll.status === 'connected') {
        setState('connected')
        if (!timerRef.current) {
          const connectedAt = Date.now()
          timerRef.current = setInterval(
            () => setElapsedSec(Math.floor((Date.now() - connectedAt) / 1000)),
            1000,
          )
        }
      } else if (poll.status === 'ringing') {
        setState('ringing')
      }

      if (poll.status === 'ended' || poll.status === 'failed' || poll.status === 'rejected') {
        stopPoll()
        if (poll.status === 'rejected') addToast('error', 'The customer declined the call')
        else if (poll.status === 'failed') addToast('error', 'The call failed')
        hangupRef.current({ skipServer: true })
      }

      if (Date.now() - started > 30_000 && !pc.currentRemoteDescription && poll.status !== 'connected') {
        stopPoll()
        addToast('error', 'The call timed out waiting for WhatsApp')
        hangupRef.current()
      }
    }, 500)
  }, [addToast])

  const startCall = useCallback(async () => {
    if (!phone) return
    if (sharedNumber) {
      addToast('error', 'WhatsApp calling is only available on your own Cloud API number.')
      return
    }
    if (outboundCallingBlockedCountry(connectedPhone)) {
      addToast(
        'error',
        'Meta does not allow businesses to start WhatsApp calls from this number’s country (United States, Canada, Egypt, Vietnam, and Nigeria). Connect a WhatsApp number from a supported country to place calls.',
      )
      return
    }
    if (state !== 'idle' && state !== 'ended') return

    setState('checking')
    setError(null)
    setElapsedSec(0)
    try {
      const perm = await apiJson<PermissionRes>(
        `/wa/call-permission?phone=${encodeURIComponent(phone)}`,
      )
      if (perm.error && !perm.success) {
        throw new Error(perm.error)
      }
      if (perm.callingEnabled === false) {
        throw new Error(perm.callingError || perm.error || 'WhatsApp calling is not enabled on this number.')
      }
      if (!perm.granted) {
        setState('requesting')
        const sent = await apiJson<PermissionRes>('/wa/call-permission', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ phone }),
        })
        if (!sent.success) throw new Error(sent.error || 'Could not send the permission request')
        addToast('success', 'Permission request sent — wait for the customer to allow the call')
        onPermissionSent?.()
        setState('waiting_permission')

        const waitStart = Date.now()
        pollRef.current = setInterval(async () => {
          const again = await apiJson<PermissionRes>(
            `/wa/call-permission?phone=${encodeURIComponent(phone)}`,
          )
          if (again.granted) {
            stopPoll()
            try {
              await startWebRtc(phone)
            } catch (e: any) {
              teardownMedia()
              setState('idle')
              addToast('error', e?.message || 'Could not start the call')
            }
          } else if (Date.now() - waitStart > 120_000) {
            stopPoll()
            setState('idle')
            addToast('error', 'Still waiting for the customer to allow the call')
          }
        }, 2000)
        return
      }
      await startWebRtc(phone)
    } catch (e: any) {
      teardownMedia()
      stopPoll()
      setState('idle')
      const msg = e?.message || 'Could not start the WhatsApp call'
      setError(msg)
      addToast('error', msg)
    }
  }, [phone, sharedNumber, connectedPhone, state, addToast, onPermissionSent, startWebRtc])

  const toggleMute = useCallback(() => {
    const next = !muted
    setMuted(next)
    localStreamRef.current?.getAudioTracks().forEach(t => {
      t.enabled = !next
    })
  }, [muted])

  return {
    state,
    muted,
    elapsedSec,
    error,
    startCall,
    hangUp,
    toggleMute,
    remoteAudioRef,
    inCall: state === 'connecting' || state === 'ringing' || state === 'connected',
  }
}
