import { describe, expect, it } from 'vitest'
import {
  PingRequestSchema,
  CdpGetAxTreeRequestSchema,
  CdpHighlightNodeRequestSchema,
  CdpNavigateRequestSchema,
  HttpUrlSchema,
  MAX_IPC_PAYLOAD_BYTES,
  TabsCreateRequestSchema,
  TabsOpenPrivacyRequestSchema,
  TabsCloseRequestSchema,
  TabsSetActiveRequestSchema,
  VoiceStartRequestSchema,
  VoicePcmInRequestSchema,
  VoiceStatusRequestSchema
} from '../src/shared'
import { validateIpcPayload } from '../src/main/ipc/validate'

describe('Zod IPC validation', () => {
  it('accepts a valid ping request', () => {
    const result = validateIpcPayload(PingRequestSchema, { nonce: 'abc' })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.nonce).toBe('abc')
    }
  })

  it('accepts empty object (optional nonce)', () => {
    const result = validateIpcPayload(PingRequestSchema, {})
    expect(result.ok).toBe(true)
  })

  it('rejects unknown keys (strict)', () => {
    const result = validateIpcPayload(PingRequestSchema, {
      nonce: 'x',
      extra: 1
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.code).toBe('VALIDATION')
    }
  })

  it('rejects oversized payloads', () => {
    const huge = { nonce: 'x'.repeat(MAX_IPC_PAYLOAD_BYTES) }
    const result = validateIpcPayload(PingRequestSchema, huge)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.code).toBe('OVERSIZE')
    }
  })
})

describe('CDP channel schemas', () => {
  it('accepts empty getAxTree request', () => {
    const result = validateIpcPayload(CdpGetAxTreeRequestSchema, {})
    expect(result.ok).toBe(true)
  })

  it('accepts getAxTree with maxNodes and tabId', () => {
    const result = validateIpcPayload(CdpGetAxTreeRequestSchema, {
      maxNodes: 50,
      tabId: 'tab-1'
    })
    expect(result.ok).toBe(true)
  })

  it('rejects getAxTree maxNodes out of range', () => {
    const result = validateIpcPayload(CdpGetAxTreeRequestSchema, {
      maxNodes: 0
    })
    expect(result.ok).toBe(false)
  })

  it('accepts highlightNode with positive nodeId', () => {
    const result = validateIpcPayload(CdpHighlightNodeRequestSchema, {
      nodeId: 42,
      tabId: 't1'
    })
    expect(result.ok).toBe(true)
  })

  it('rejects highlightNode with non-positive nodeId', () => {
    const result = validateIpcPayload(CdpHighlightNodeRequestSchema, {
      nodeId: 0
    })
    expect(result.ok).toBe(false)
  })

  it('accepts http(s) navigate URLs', () => {
    for (const url of ['https://example.com', 'http://localhost:3000/path']) {
      const result = validateIpcPayload(CdpNavigateRequestSchema, { url })
      expect(result.ok).toBe(true)
    }
  })

  it('rejects non-http navigate URLs', () => {
    for (const url of [
      'file:///etc/passwd',
      'javascript:alert(1)',
      'data:text/html,hi',
      'ftp://example.com'
    ]) {
      expect(HttpUrlSchema.safeParse(url).success).toBe(false)
      const result = validateIpcPayload(CdpNavigateRequestSchema, { url })
      expect(result.ok).toBe(false)
    }
  })
})

describe('Phase 3 tab channel schemas', () => {
  it('accepts createTab with capability', () => {
    for (const capability of ['active', 'readOnly', 'privacy'] as const) {
      const result = validateIpcPayload(TabsCreateRequestSchema, {
        capability,
        url: 'https://example.com'
      })
      expect(result.ok).toBe(true)
    }
  })

  it('rejects unknown capability', () => {
    const result = validateIpcPayload(TabsCreateRequestSchema, {
      capability: 'admin'
    })
    expect(result.ok).toBe(false)
  })

  it('accepts openPrivacy / close / setActive', () => {
    expect(
      validateIpcPayload(TabsOpenPrivacyRequestSchema, {
        url: 'https://bank.example'
      }).ok
    ).toBe(true)
    expect(
      validateIpcPayload(TabsCloseRequestSchema, { tabId: 'abc' }).ok
    ).toBe(true)
    expect(
      validateIpcPayload(TabsSetActiveRequestSchema, { tabId: 'abc' }).ok
    ).toBe(true)
  })
})

describe('Phase 4 voice channel schemas', () => {
  it('accepts voice start with optional tabId', () => {
    expect(validateIpcPayload(VoiceStartRequestSchema, {}).ok).toBe(true)
    expect(
      validateIpcPayload(VoiceStartRequestSchema, { tabId: 'tab-1' }).ok
    ).toBe(true)
  })

  it('accepts voice status empty request', () => {
    expect(validateIpcPayload(VoiceStatusRequestSchema, {}).ok).toBe(true)
  })

  it('accepts pcmIn with base64 payload', () => {
    const result = validateIpcPayload(VoicePcmInRequestSchema, {
      pcmBase64: Buffer.from('hi').toString('base64'),
      sampleRateHz: 16000
    })
    expect(result.ok).toBe(true)
  })

  it('rejects empty pcmBase64', () => {
    const result = validateIpcPayload(VoicePcmInRequestSchema, {
      pcmBase64: ''
    })
    expect(result.ok).toBe(false)
  })
})
