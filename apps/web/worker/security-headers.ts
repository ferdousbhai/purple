/** Purple's document policy. It mirrors public/_headers so a document that
 * reaches the Worker without the asset headers still gets the full policy; the
 * hosted security header test keeps the two identical. Sample hosts are
 * limited to the repositories pinned in packages/ui/src/pinned-samples.ts. */
export const DOCUMENT_CSP = [
  "default-src 'self'",
  "base-uri 'none'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'none'",
  "script-src 'self' https://challenges.cloudflare.com",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data:",
  "img-src 'self' data: blob:",
  "media-src 'self' data: https://raw.githubusercontent.com/tidalcycles/Dirt-Samples/ https://raw.githubusercontent.com/felixroos/dough-samples/ https://raw.githubusercontent.com/ritchse/tidal-drum-machines/ https://raw.githubusercontent.com/todepond/samples/ blob:",
  "connect-src 'self' https://raw.githubusercontent.com/tidalcycles/Dirt-Samples/ https://raw.githubusercontent.com/felixroos/dough-samples/ https://raw.githubusercontent.com/ritchse/tidal-drum-machines/ https://raw.githubusercontent.com/todepond/samples/ wss://soundspurple.com ws://127.0.0.1:*",
  "frame-src https://challenges.cloudflare.com",
  "worker-src 'self' blob:",
].join('; ')

const DOCUMENT_FALLBACK_HEADERS: ReadonlyArray<readonly [string, string]> = [
  ['Content-Security-Policy', DOCUMENT_CSP],
  ['Cross-Origin-Opener-Policy', 'same-origin'],
  ['Cross-Origin-Resource-Policy', 'same-origin'],
  [
    'Permissions-Policy',
    'camera=(), display-capture=(), geolocation=(), microphone=(), payment=(), usb=()',
  ],
]

/** Shared document defenses. Keep game asset sandbox policies and API responses intact. */
export function secureDocument(response: Response): Response {
  if (!response.headers.get('content-type')?.includes('text/html')) return response
  const headers = new Headers(response.headers)
  headers.set('X-Content-Type-Options', 'nosniff')
  headers.set('X-Frame-Options', 'DENY')
  headers.set('Referrer-Policy', 'no-referrer')
  headers.set('Strict-Transport-Security', 'max-age=31536000')
  // Headers from public/_headers win; these fill in only what is missing.
  for (const [name, value] of DOCUMENT_FALLBACK_HEADERS) {
    if (!headers.has(name)) headers.set(name, value)
  }
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers })
}
