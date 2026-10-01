import { bindings, defineConfig, exports } from 'cf/config'

// The personal library and the working pattern stay in the visitor's
// browser. A pattern title and code reach D1 only after the visitor
// explicitly shares them.
// The feedback route sends only its submitted fields to a fixed destination.
export default defineConfig({
  worker: {
    name: 'purple-web',
    compatibilityDate: '2026-08-18',
    compatibilityFlags: ['nodejs_compat'],
    entrypoint: './worker/index.ts',
    previewUrls: true,
    observability: {
      enabled: true,
      logs: { enabled: true, headSamplingRate: 1 },
      traces: { enabled: true, headSamplingRate: 0.1 },
    },
    assets: {
      notFoundHandling: '404-page',
      // Run only app documents and APIs through Worker logic. Matching static
      // assets and the standalone 404 page stay on Cloudflare's asset fast path.
      runWorkerFirst: [
        '/',
        '/patterns',
        '/authorize',
        '/llms.txt',
        '/.well-known/*',
        '/oauth/*',
        '/api/*',
        '/mcp',
        '/mcp/*',
        '/link/*',
      ],
    },
    domains: ['soundspurple.com', 'www.soundspurple.com'],
    env: {
      TURNSTILE_SECRET: bindings.secret(),
      TOKEN_SECRET: bindings.secret(),
      // Migrations live in ./migrations; apply them with
      // `cf d1 migrations apply <id> --dir migrations` (see package.json).
      PATTERNS_DB: bindings.d1({
        id: '6e9cbe0d-7161-462b-91dc-8cab77fd9047',
        name: 'purple-patterns',
      }),
      FEEDBACK_EMAIL: bindings.sendEmail({
        destinationAddress: 'ferdous@hey.com',
        allowedSenderAddresses: ['feedback@soundspurple.com'],
      }),
      AGENT_LINK: bindings.durableObject({
        worker: 'purple-web',
        exportName: 'AgentLinkSession',
      }),
      SHARE_RATE_LIMITER: bindings.rateLimit({
        namespace: '1001',
        simple: { limit: 5, period: 60 },
      }),
      VOTE_RATE_LIMITER: bindings.rateLimit({
        namespace: '1002',
        simple: { limit: 60, period: 60 },
      }),
      ASSETS: bindings.assets(),
    },
    exports: {
      // Created by the live v1 Wrangler migration (new_sqlite_classes).
      AgentLinkSession: exports.durableObject({ storage: 'sqlite' }),
    },
  },
})
