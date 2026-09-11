import { describe, expect, it } from 'vitest'
import page from '../index.html?raw'

describe('search discovery', () => {
  it('publishes valid structured site and application data', () => {
    const schemaText = page.match(
      /<script type="application\/ld\+json">\s*([\s\S]*?)\s*<\/script>/,
    )?.[1]
    if (!schemaText) throw new Error('Structured data is missing from index.html.')

    expect(JSON.parse(schemaText)).toMatchObject({
      '@context': 'https://schema.org',
      '@graph': [
        { '@type': 'WebSite', name: 'Purple', url: 'https://soundspurple.com/' },
        { '@type': 'WebApplication', name: 'Purple', isAccessibleForFree: true },
      ],
    })
  })
})
