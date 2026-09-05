import {
  agentLinkCodeFromPath,
  handleAgentLinkUpgrade,
  handleMcpRequest,
} from './agent-relay'
import { agentGuide } from '@purple/core/agent-tools'
import { handleFeedbackRequest } from './feedback'
import { textResponse } from './http'
import { handlePatternRequest } from './patterns'

export { AgentLinkSession } from './agent-relay'

const FEEDBACK_PATH = '/api/feedback'
const AGENT_GUIDE_PATH = '/llms.txt'
const MCP_PREFIX = '/mcp/'
const LINK_PREFIX = '/link/'
const CANONICAL_HOST = 'soundspurple.com'
const WWW_HOST = `www.${CANONICAL_HOST}`
const STUDIO_PATH = '/'
const PATTERNS_PATH = '/patterns'
const STUDIO_PRELOAD_SELECTOR = 'link[data-purple-studio-preload]'
const PATTERNS_PRELOAD_ATTRIBUTE = 'data-purple-patterns-preload'
const PATTERNS_PRELOAD_SELECTOR = `template[${PATTERNS_PRELOAD_ATTRIBUTE}]`
const PATTERNS_DESCRIPTION =
  'Browse, play, save, and remix public Strudel patterns made with Purple. Listening needs nothing but a browser.'

type AssetFetcher = Pick<Fetcher, 'fetch'>
type HtmlTransformer = (response: Response, pathname: string) => Response
export default {
  async fetch(request, env): Promise<Response> {
    const redirect = redirectToCanonicalOrigin(request)
    if (redirect) return redirect

    const url = new URL(request.url)
    // A bare /mcp is an agent guessing; the help there says where the code comes from.
    if (url.pathname === '/mcp' || url.pathname.startsWith(MCP_PREFIX)) {
      return handleMcpRequest(
        request,
        env,
        agentLinkCodeFromPath(url.pathname, MCP_PREFIX),
      )
    }
    if (url.pathname.startsWith(LINK_PREFIX)) {
      return handleAgentLinkUpgrade(
        request,
        env,
        agentLinkCodeFromPath(url.pathname, LINK_PREFIX),
      )
    }
    if (url.pathname === AGENT_GUIDE_PATH) {
      return textResponse(agentGuide(url.origin), 200)
    }
    if (url.pathname === FEEDBACK_PATH) {
      return handleFeedbackRequest(request, env)
    }
    if (url.pathname.startsWith('/api/')) {
      return handlePatternRequest(request, env)
    }
    return handleAssetRequest(request, env.ASSETS)
  },
} satisfies ExportedHandler<Env>

export async function handleAssetRequest(
  request: Request,
  assets: AssetFetcher,
  rewriteRouteHtml: HtmlTransformer = rewriteRoutePreloads,
): Promise<Response> {
  const pathname = new URL(request.url).pathname
  if (
    pathname === PATTERNS_PATH &&
    (request.method === 'GET' || request.method === 'HEAD')
  ) {
    const entryUrl = new URL(STUDIO_PATH, request.url)
    const response = await assets.fetch(spaEntryRequest(request, entryUrl))
    const routeHtml = uncacheableRouteHtml(response)
    return request.method === 'GET' &&
      (response.headers.get('Content-Type') ?? '').toLowerCase().startsWith('text/html')
      ? rewriteRouteHtml(routeHtml, pathname)
      : routeHtml
  }
  return assets.fetch(request)
}

function spaEntryRequest(request: Request, entryUrl: URL): Request {
  const headers = new Headers(request.headers)
  for (const name of [
    'If-Match',
    'If-None-Match',
    'If-Modified-Since',
    'If-Unmodified-Since',
    'If-Range',
    'Range',
  ]) {
    headers.delete(name)
  }
  return new Request(entryUrl, { headers, method: request.method })
}

function uncacheableRouteHtml(response: Response): Response {
  const headers = new Headers(response.headers)
  for (const name of [
    'Accept-Ranges',
    'Content-Length',
    'Content-Range',
    'ETag',
    'Last-Modified',
  ]) {
    headers.delete(name)
  }
  headers.set('Cache-Control', 'no-store')
  return new Response(response.body, {
    headers,
    status: response.status,
    statusText: response.statusText,
  })
}

function rewriteRoutePreloads(response: Response, pathname: string): Response {
  const rewriter = new HTMLRewriter()
    .on(STUDIO_PRELOAD_SELECTOR, {
      element(element) {
        element.remove()
      },
    })
    .on(PATTERNS_PRELOAD_SELECTOR, {
      element(element) {
        const href = element.getAttribute(PATTERNS_PRELOAD_ATTRIBUTE) ?? ''
        if (pathname !== PATTERNS_PATH || !isScriptAssetPath(href)) {
          element.remove()
          return
        }
        element.replace(
          `<link rel="modulepreload" crossorigin href="${href}" data-purple-patterns-preload>`,
          { html: true },
        )
      },
    })
  const metadata = routeMetadata(pathname)
  if (metadata) {
    rewriter
      .on('title', {
        element(element) {
          element.setInnerContent(metadata.title)
        },
      })
      .on('link[rel="canonical"]', {
        element(element) {
          element.setAttribute('href', metadata.url)
        },
      })
      .on('.boot-shell', {
        element(element) {
          element.setInnerContent(
            `<h1>${metadata.heading}</h1><p>${metadata.description}</p>`,
            { html: true },
          )
        },
      })
    for (const [selector, value] of [
      ['meta[name="description"]', metadata.description],
      ['meta[property="og:description"]', metadata.description],
      ['meta[property="og:title"]', metadata.title],
      ['meta[property="og:url"]', metadata.url],
      ['meta[name="twitter:description"]', metadata.description],
      ['meta[name="twitter:title"]', metadata.title],
    ] as const) {
      rewriter.on(selector, {
        element(element) {
          element.setAttribute('content', value)
        },
      })
    }
  }
  return rewriter.transform(response)
}

export function routeMetadata(pathname: string): {
  title: string
  heading: string
  description: string
  url: string
} | null {
  if (pathname !== PATTERNS_PATH) return null
  return {
    title: 'Public Strudel Patterns | Purple',
    heading: 'Public Strudel patterns to play, save, and remix',
    description: PATTERNS_DESCRIPTION,
    url: `https://${CANONICAL_HOST}${PATTERNS_PATH}`,
  }
}

function isScriptAssetPath(value: string): boolean {
  return /^\/assets\/[A-Za-z0-9_.-]+\.js$/.test(value)
}

export function redirectToCanonicalOrigin(request: Request): Response | null {
  const url = new URL(request.url)
  if (url.hostname !== CANONICAL_HOST && url.hostname !== WWW_HOST) return null
  if (url.protocol === 'https:' && url.hostname === CANONICAL_HOST) return null

  url.protocol = 'https:'
  url.hostname = CANONICAL_HOST
  url.port = ''
  // A permanent method-preserving redirect also keeps API requests safe while
  // collapsing HTTP and www traffic to the same origin in one round trip.
  return Response.redirect(url.toString(), 308)
}
