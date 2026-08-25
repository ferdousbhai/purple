import { describe, expect, it } from 'vitest'
import page from '../index.html?raw'
import robots from '../public/robots.txt?raw'
import sitemap from '../public/sitemap.xml?raw'

describe('search discovery', () => {
  it('ships descriptive root metadata and crawlable loading content', () => {
    expect(page).toContain('<title>Purple: AI Music Production with Strudel</title>')
    expect(page).toContain('name="robots" content="index, follow, max-image-preview:large"')
    expect(page).toContain('property="og:image" content="https://soundspurple.com/icon-512.png"')
    expect(page).toContain('<h1>Purple</h1>')
    expect(page).toContain('Create, edit, and play AI-generated Strudel music in your browser.')
  })

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

  it('points crawlers at the canonical public routes while excluding APIs', () => {
    expect(robots).toContain('Disallow: /api/')
    expect(robots).toContain('Sitemap: https://soundspurple.com/sitemap.xml')
    expect(sitemap).toContain('<loc>https://soundspurple.com/</loc>')
    expect(sitemap).toContain('<loc>https://soundspurple.com/patterns</loc>')
  })
})
