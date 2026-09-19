'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { createBridge, type Bridge, type AppSession } from '@flashmanager/app-bridge'

const TOKEN_MAX_AGE_MS = 90_000

const HOST_ORIGINS = [
  'https://platform.flash-manager.com',
  'https://dev.flash-manager.com',
] as const

let bridgeInstance: Bridge | null = null

export function useBridge() {
  const [ready, setReady] = useState(false)
  const tokenRef = useRef<{ token: string; at: number } | null>(null)
  const bridgeRef = useRef<Bridge | null>(null)

  useEffect(() => {
    if (!bridgeInstance) {
      bridgeInstance = createBridge({ allowedHostOrigins: [...HOST_ORIGINS] })
    }
    bridgeRef.current = bridgeInstance

    const unsub = bridgeRef.current.onToken((session: AppSession) => {
      tokenRef.current = { token: session.token, at: Date.now() }
      setReady(true)
    })

    bridgeRef.current
      .getSessionToken()
      .then((session) => {
        tokenRef.current = { token: session.token, at: Date.now() }
        setReady(true)
      })
      .catch(() => {
        setReady(true)
      })

    return unsub
  }, [])

  const getFreshToken = useCallback(async (): Promise<string | null> => {
    const cached = tokenRef.current
    if (cached && Date.now() - cached.at < TOKEN_MAX_AGE_MS) return cached.token
    try {
      const session = await bridgeRef.current!.getSessionToken()
      tokenRef.current = { token: session.token, at: Date.now() }
      return session.token
    } catch {
      return cached?.token ?? null
    }
  }, [])

  return { ready, getFreshToken }
}
