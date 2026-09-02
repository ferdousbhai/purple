import { afterEach, describe, expect, it, vi } from 'vitest'
import { AGENT_LINK_DEFAULT_PORT } from '@purple/core/agent-link'
import { localStorageStub } from '@purple/ui/testing'
import {
  DEFAULT_AGENT_LINK_SETTINGS,
  loadAgentLinkSettings,
  parseAgentLinkSettings,
  saveAgentLinkSettings,
} from './agent-link-storage'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('parseAgentLinkSettings', () => {
  it('reads what save writes', () => {
    expect(parseAgentLinkSettings('{"enabled":true,"port":9001}')).toEqual({
      enabled: true,
      port: 9001,
    })
  })

  it('falls back to the default port for out-of-range or missing values', () => {
    expect(parseAgentLinkSettings('{"enabled":true,"port":0}')).toEqual({
      enabled: true,
      port: AGENT_LINK_DEFAULT_PORT,
    })
    expect(parseAgentLinkSettings('{"enabled":false}')).toEqual(
      DEFAULT_AGENT_LINK_SETTINGS,
    )
  })

  it('rejects text that is not a settings object', () => {
    expect(parseAgentLinkSettings('[]')).toBeNull()
    expect(parseAgentLinkSettings('nope')).toBeNull()
  })
})

describe('load and save', () => {
  it('round-trips through localStorage', () => {
    vi.stubGlobal('localStorage', localStorageStub().window.localStorage)
    saveAgentLinkSettings({ enabled: true, port: 7723 })
    expect(loadAgentLinkSettings()).toEqual({ enabled: true, port: 7723 })
  })

  it('starts switched off when nothing is stored', () => {
    vi.stubGlobal('localStorage', localStorageStub().window.localStorage)
    expect(loadAgentLinkSettings()).toEqual(DEFAULT_AGENT_LINK_SETTINGS)
  })
})
