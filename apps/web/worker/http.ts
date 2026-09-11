import type { JsonValue } from '@purple/core/json'

type BodyReadResult =
  | { ok: true; body: string }
  | { ok: false }

export async function readBoundedBody(
  request: Request,
  limit: number,
): Promise<BodyReadResult> {
  const declaredLength = Number(request.headers.get('Content-Length'))
  if (Number.isFinite(declaredLength) && declaredLength > limit) return { ok: false }
  if (!request.body) return { ok: true, body: '' }

  const reader = request.body.getReader()
  const decoder = new TextDecoder()
  let bytesRead = 0
  let body = ''
  try {
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) break
      bytesRead += chunk.value.byteLength
      if (bytesRead > limit) {
        await reader.cancel()
        return { ok: false }
      }
      body += decoder.decode(chunk.value, { stream: true })
    }
    body += decoder.decode()
    return { ok: true, body }
  } finally {
    reader.releaseLock()
  }
}

/** Unpadded base64url, the alphabet share ids and signed tokens share. */
export function base64url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
}

/** Lowercase hex, the alphabet digests and voter ids share. */
export function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return hex(new Uint8Array(digest))
}

export function hasContentType(request: Request, expected: string): boolean {
  const mediaType = request.headers.get('Content-Type')?.split(';', 1)[0]
  return mediaType?.trim().toLowerCase() === expected
}

const UNCACHED_HEADERS = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
}

export function jsonResponse(
  body: JsonValue,
  status: number,
  extraHeaders: Record<string, string> = {},
): Response {
  return Response.json(body, {
    status,
    headers: {
      ...UNCACHED_HEADERS,
      'Content-Type': 'application/json; charset=utf-8',
      ...extraHeaders,
    },
  })
}

export function textResponse(
  body: string,
  status: number,
  extraHeaders: Record<string, string> = {},
): Response {
  return new Response(body, {
    status,
    headers: {
      ...UNCACHED_HEADERS,
      'Content-Type': 'text/plain; charset=utf-8',
      ...extraHeaders,
    },
  })
}
