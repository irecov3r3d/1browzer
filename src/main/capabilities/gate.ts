import {
  isActionAllowed,
  type CapabilityAction,
  type IpcError,
  type TabCapability
} from '../../shared'

/**
 * Return a CAPABILITY_DENIED error if the tab class may not perform `action`.
 * Pure — unit-testable without Electron.
 */
export function denyIfNotAllowed(
  capability: TabCapability,
  action: CapabilityAction
): IpcError | null {
  if (isActionAllowed(capability, action)) {
    return null
  }
  return {
    ok: false,
    error: `Capability '${capability}' is not allowed to perform '${action}'`,
    code: 'CAPABILITY_DENIED'
  }
}

export function capabilityDenied(
  capability: TabCapability,
  action: CapabilityAction
): IpcError {
  return (
    denyIfNotAllowed(capability, action) ?? {
      ok: false,
      error: `Capability '${capability}' is not allowed to perform '${action}'`,
      code: 'CAPABILITY_DENIED'
    }
  )
}
