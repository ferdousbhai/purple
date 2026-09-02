import { afterEach, describe, expect, it, vi } from 'vitest'
import { localStorageStub } from '@purple/ui/testing'
import {
  generateAgentLinkCode,
  loadAgentLinkSettings,
  parseAgentLinkSettings,
  saveAgentLinkSettings,
} from './agent-link-storage'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('parseAgentLinkSettings', () => {
  it('reads what save writes', () => {
    expect(
      parseAgentLinkSettings('{"enabled":true,"code":"0f7c2d91aa34bb56cc78"}'),
    ).toEqual({ enabled: true, code: '0f7c2d91aa34bb56cc78', local: false })
    expect(
      parseAgentLinkSettings(
        '{"enabled":true,"code":"0f7c2d91aa34bb56cc78","local":true}',
      ),
    ).toMatchObject({ local: true })
  })

  it('rejects missing, short, or unsafe codes and non-objects', () => {
    expect(parseAgentLinkSettings('{"enabled":true}')).toBeNull()
    expect(parseAgentLinkSettings('{"enabled":true,"code":"short"}')).toBeNull()
    expect(
      parseAgentLinkSettings('{"enabled":true,"code":"../../../etc/passwd"}'),
    ).toBeNull()
    expect(parseAgentLinkSettings('[]')).toBeNull()
    expect(parseAgentLinkSettings('nope')).toBeNull()
  })

  it('treats the retired port-based shape as absent', () => {
    expect(parseAgentLinkSettings('{"enabled":true,"port":7723}')).toBeNull()
  })
})

describe('load and save', () => {
  it('round-trips through localStorage', () => {
    vi.stubGlobal('localStorage', localStorageStub().window.localStorage)
    const code = generateAgentLinkCode()
    saveAgentLinkSettings({ enabled: true, code, local: false })
    expect(loadAgentLinkSettings()).toEqual({ enabled: true, code, local: false })
  })

  it('mints and persists a code on first load', () => {
    vi.stubGlobal('localStorage', localStorageStub().window.localStorage)
    const first = loadAgentLinkSettings()
    expect(first.enabled).toBe(false)
    expect(first.code).toMatch(/^[0-9a-f]{20}$/)
    expect(loadAgentLinkSettings()).toEqual(first)
  })
})

describe('generateAgentLinkCode', () => {
  it('mints unique twenty-character hex codes', () => {
    const code = generateAgentLinkCode()
    expect(code).toMatch(/^[0-9a-f]{20}$/)
    expect(generateAgentLinkCode()).not.toBe(code)
  })
})
