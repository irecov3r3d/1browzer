import { MAX_IPC_PAYLOAD_BYTES, type IpcError } from '../../shared'

function payloadByteLength(payload: unknown): number {
  try {
    return Buffer.byteLength(JSON.stringify(payload ?? null), 'utf8')
  } catch {
    return Number.POSITIVE_INFINITY
  }
}

type ZodLikeSchema<T> = {
  safeParse: (
    data: unknown
  ) => { success: true; data: T } | { success: false; error: { message: string } }
}

/**
 * Validate an unknown IPC payload with Zod and enforce a hard size cap.
 * Pure helper — safe to unit-test without Electron.
 */
export function validateIpcPayload<T>(
  schema: ZodLikeSchema<T>,
  payload: unknown
): { ok: true; data: T } | IpcError {
  if (payloadByteLength(payload) > MAX_IPC_PAYLOAD_BYTES) {
    return {
      ok: false,
      error: `Payload exceeds ${MAX_IPC_PAYLOAD_BYTES} bytes`,
      code: 'OVERSIZE'
    }
  }

  const result = schema.safeParse(payload)
  if (!result.success) {
    return {
      ok: false,
      error: result.error.message,
      code: 'VALIDATION'
    }
  }

  return { ok: true, data: result.data }
}
