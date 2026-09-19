export const dynamic = 'force-dynamic'

const ALLOWED = (host: string) => {
  const h = host.toLowerCase()
  return h.endsWith('.googleusercontent.com') || h.endsWith('.ggpht.com') || h === 'googleusercontent.com'
}

export async function GET(request: Request) {
  const raw = new URL(request.url).searchParams.get('u') || ''
  let target: URL
  try {
    target = new URL(raw)
  } catch {
    return new Response('Bad url', { status: 400 })
  }
  if (target.protocol !== 'https:' || !ALLOWED(target.hostname)) {
    return new Response('Forbidden host', { status: 400 })
  }

  const upstream = await fetch(target.toString(), {
    headers: { 'User-Agent': 'FlashManager-Avatar/1.0' },
    redirect: 'follow',
    cache: 'force-cache',
  })
  if (!upstream.ok) return new Response('Upstream failed', { status: 502 })
  const contentType = upstream.headers.get('content-type') || 'image/jpeg'
  if (!contentType.startsWith('image/')) return new Response('Not an image', { status: 415 })

  return new Response(await upstream.arrayBuffer(), {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'Cache-Control': 'public, max-age=86400, stale-while-revalidate=604800',
    },
  })
}
