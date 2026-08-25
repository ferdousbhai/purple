/* oxlint-disable anti-slop/no-chained-type-assertions, anti-slop/no-conditional-empty-object-spread, anti-slop/no-unknown-parameters, anti-slop/require-safety-comment-for-type-assertion -- The in-memory D1 harness deliberately bridges Cloudflare's abstract binding types and inspects test-only dynamic rows. */
import { describe, expect, it } from 'vitest'
import { handlePatternRequest } from './patterns'

describe('public pattern Worker', () => {
  it('creates a short public share after same-origin and Turnstile checks', async () => {
    const db = new PatternDatabase()
    const response = await handlePatternRequest(
      jsonRequest('/api/shares', 'POST', {
        title: 'Acid rain',
        code: 's("bd*4")',
        turnstileToken: 'verified',
      }),
      patternEnv(db),
      validSiteverify(),
    )

    expect(response.status).toBe(201)
    const body = await response.json() as { id: string }
    expect(body.id).toMatch(/^[A-Za-z0-9_-]{12}$/)
    expect(response.headers.get('Location')).toBe(`/?s=${body.id}`)
    expect(db.patterns.get(body.id)).toMatchObject({
      title: 'Acid rain',
      code: 's("bd*4")',
    })
  })

  it('lists public patterns, returns a short link target and records one vote per browser', async () => {
    const db = new PatternDatabase()
    seedAcidRain(db)
    const env = patternEnv(db)

    const list = await handlePatternRequest(
      new Request('https://soundspurple.com/api/patterns?sort=fresh'),
      env,
    )
    expect(list.status).toBe(200)
    expect(await list.json()).toMatchObject({
      patterns: [{ id: 'Abc_123-xYz9', viewerVote: 0 }],
      nextCursor: null,
    })
    const cookie = list.headers.get('Set-Cookie')?.split(';')[0]
    expect(cookie).toMatch(/^purple_voter=[a-f0-9]{32}$/)

    const vote = await handlePatternRequest(
      jsonRequest('/api/patterns/Abc_123-xYz9/vote', 'PUT', { value: 1 }, cookie),
      env,
    )
    expect(vote.status).toBe(200)
    expect(await vote.json()).toEqual({
      likes: 1,
      dislikes: 0,
      score: 1,
      viewerVote: 1,
    })

    const shared = await handlePatternRequest(
      new Request('https://soundspurple.com/api/shares/Abc_123-xYz9', {
        headers: cookie ? { Cookie: cookie } : {},
      }),
      env,
    )
    expect(await shared.json()).toMatchObject({ viewerVote: 1, likes: 1 })
  })

  it('rejects malformed, cross-origin and rate-limited writes', async () => {
    const db = new PatternDatabase()
    const env = patternEnv(db)
    const wrongOrigin = new Request('https://soundspurple.com/api/shares', {
      method: 'POST',
      headers: { Origin: 'https://attacker.example', 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'x', code: 's("bd")', turnstileToken: 'verified' }),
    })
    expect((await handlePatternRequest(wrongOrigin, env, validSiteverify())).status).toBe(403)

    const unsupported = jsonRequest('/api/shares', 'POST', {
      title: 'x', code: 's("bd")', turnstileToken: 'verified',
    })
    unsupported.headers.set('Content-Type', 'application/jsonp')
    expect((await handlePatternRequest(unsupported, env, validSiteverify())).status).toBe(415)

    const invalid = jsonRequest('/api/shares', 'POST', {
      title: '',
      code: 's("bd")',
      turnstileToken: 'verified',
    })
    expect((await handlePatternRequest(invalid, env, validSiteverify())).status).toBe(400)

    const limited = patternEnv(db, false)
    expect((await handlePatternRequest(
      jsonRequest('/api/shares', 'POST', {
        title: 'x', code: 's("bd")', turnstileToken: 'verified',
      }),
      limited,
      validSiteverify(),
    )).status).toBe(429)
  })

  it('does not create a vote for a missing pattern', async () => {
    const db = new PatternDatabase()
    const response = await handlePatternRequest(
      jsonRequest('/api/patterns/Abc_123-xYz9/vote', 'PUT', { value: 1 }),
      patternEnv(db),
    )

    expect(response.status).toBe(404)
    expect(db.votes.size).toBe(0)
  })

  it('rate limits rotated voter cookies by their Cloudflare client IP', async () => {
    const db = new PatternDatabase()
    seedAcidRain(db)
    const rateLimitKeys: string[] = []
    const env = patternEnv(db, true, rateLimitKeys)
    for (const voterId of [
      '11111111111111111111111111111111',
      '22222222222222222222222222222222',
    ]) {
      const request = jsonRequest(
        '/api/patterns/Abc_123-xYz9/vote',
        'PUT',
        { value: 1 },
        `purple_voter=${voterId}`,
      )
      request.headers.set('CF-Connecting-IP', '203.0.113.7')
      expect((await handlePatternRequest(request, env)).status).toBe(200)
    }

    expect(rateLimitKeys).toEqual(['ip:203.0.113.7', 'ip:203.0.113.7'])
  })
})

interface StoredPattern {
  id: string
  title: string
  code: string
  createdAt: number
  likes: number
  dislikes: number
  score: number
}

function seedAcidRain(db: PatternDatabase): void {
  db.patterns.set('Abc_123-xYz9', {
    id: 'Abc_123-xYz9',
    title: 'Acid rain',
    code: 's("bd*4")',
    createdAt: 123,
    likes: 0,
    dislikes: 0,
    score: 0,
  })
}

class PatternDatabase {
  patterns = new Map<string, StoredPattern>()
  votes = new Map<string, number>()

  prepare(query: string): D1PreparedStatement {
    return new PatternStatement(this, query) as unknown as D1PreparedStatement
  }

  async batch(statements: D1PreparedStatement[]): Promise<D1Result[]> {
    const results: D1Result[] = []
    for (const statement of statements) {
      const prepared = statement as unknown as PatternStatement
      results.push(prepared.isSelect ? await prepared.all() : await prepared.run())
    }
    return results
  }
}

class PatternStatement {
  private values: unknown[] = []

  constructor(
    private readonly db: PatternDatabase,
    private readonly query: string,
  ) {}

  get isSelect(): boolean {
    return this.query.trimStart().startsWith('SELECT')
  }

  bind(...values: unknown[]): this {
    this.values = values
    return this
  }

  async run(): Promise<D1Result> {
    if (this.query.includes('INSERT INTO shared_patterns')) {
      const [id, title, code, createdAt] = this.values as [string, string, string, number]
      this.db.patterns.set(id, {
        id, title, code, createdAt, likes: 0, dislikes: 0, score: 0,
      })
    } else if (this.query.includes('INSERT INTO pattern_votes')) {
      const [id, voterHash, value] = this.values as [string, string, number]
      if (this.db.patterns.has(id)) this.db.votes.set(`${id}:${voterHash}`, value)
    } else if (this.query.includes('DELETE FROM pattern_votes')) {
      const [id, voterHash] = this.values as [string, string]
      if (this.db.patterns.has(id)) this.db.votes.delete(`${id}:${voterHash}`)
    } else if (this.query.includes('UPDATE shared_patterns SET')) {
      const id = this.values.at(-1) as string
      this.updateCounts(id)
    }
    return d1Result([])
  }

  async first<T>(): Promise<T | null> {
    const voterHash = this.values[0] as string
    const id = this.values[1] as string
    const pattern = this.db.patterns.get(id)
    return (pattern ? this.withVote(pattern, voterHash) : null) as T | null
  }

  async all<T>(): Promise<D1Result<T>> {
    if (this.query.includes('SELECT p.likes, p.dislikes')) {
      const voterHash = this.values[0] as string
      const id = this.values[1] as string
      this.updateCounts(id)
      const pattern = this.db.patterns.get(id)
      const result = pattern
        ? [{
            likes: pattern.likes,
            dislikes: pattern.dislikes,
            score: pattern.score,
            viewerVote: this.db.votes.get(`${id}:${voterHash}`) ?? 0,
          }]
        : []
      return d1Result(result as T[])
    }
    const voterHash = this.values[0] as string
    const patterns = [...this.db.patterns.values()]
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((pattern) => this.withVote(pattern, voterHash))
    return d1Result(patterns as T[])
  }

  private withVote(
    pattern: StoredPattern,
    voterHash: string,
  ): StoredPattern & { viewerVote: number } {
    return {
      ...pattern,
      viewerVote: this.db.votes.get(`${pattern.id}:${voterHash}`) ?? 0,
    }
  }

  private updateCounts(id: string): void {
    const pattern = this.db.patterns.get(id)
    if (!pattern) return
    const values = [...this.db.votes.entries()]
      .filter(([key]) => key.startsWith(`${id}:`))
      .map(([, value]) => value)
    pattern.likes = values.filter((value) => value === 1).length
    pattern.dislikes = values.filter((value) => value === -1).length
    pattern.score = values.reduce((sum, value) => sum + value, 0)
  }
}

function patternEnv(
  db: PatternDatabase,
  allowed = true,
  rateLimitKeys?: string[],
): Env {
  const limiter = {
    async limit({ key }: { key: string }) {
      rateLimitKeys?.push(key)
      return { success: allowed }
    },
  }
  return {
    PATTERNS_DB: db,
    SHARE_RATE_LIMITER: limiter,
    VOTE_RATE_LIMITER: limiter,
    TURNSTILE_SECRET: 'test-secret',
  } as unknown as Env
}

function jsonRequest(
  path: string,
  method: string,
  body: unknown,
  cookie?: string,
): Request {
  return new Request(`https://soundspurple.com${path}`, {
    method,
    headers: {
      Origin: 'https://soundspurple.com',
      'Content-Type': 'application/json',
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: JSON.stringify(body),
  })
}

function validSiteverify(): typeof fetch {
  return async () => Response.json({
    success: true,
    action: 'purple_share',
    hostname: 'soundspurple.com',
  })
}

function d1Result<T>(results: T[]): D1Result<T> {
  return {
    success: true,
    results,
    meta: {
      served_by: 'test',
      served_by_region: 'test',
      served_by_primary: true,
      timings: { sql_duration_ms: 0 },
      duration: 0,
      changes: 0,
      last_row_id: 0,
      changed_db: false,
      size_after: 0,
      rows_read: 0,
      rows_written: 0,
    },
  }
}
