/**
 * Capability-based IFC tab classes (ARCHITECTURE.md Phase 3–4).
 * Permission matrix is the single source of truth for IPC gating.
 */

export const TAB_CAPABILITIES = ['active', 'readOnly', 'privacy'] as const
export type TabCapability = (typeof TAB_CAPABILITIES)[number]

/** Actions that may be gated by capability. */
export const CAPABILITY_ACTIONS = [
  'cdpAttach',
  'getAxTree',
  'highlightNode',
  'navigate',
  'input',
  /** Gemini Live voice session bound to the Active Worker only. */
  'voice'
] as const
export type CapabilityAction = (typeof CAPABILITY_ACTIONS)[number]

export type CapabilityPermissions = {
  /** May attach CDP debugger to the guest WebContents. */
  canCdpAttach: boolean
  /** Accessibility.getFullAXTree / DOM read. */
  canGetAxTree: boolean
  /** DOM.highlightNode (visual mutation / agent feedback). */
  canHighlight: boolean
  /** Navigate via CDP/guest loadURL from agent IPC. */
  canNavigate: boolean
  /**
   * Input domain permission flag (Phase 3 stub).
   * true only for Active even if Input.dispatch* is not fully implemented yet.
   */
  canInput: boolean
  /**
   * Gemini Multimodal Live voice (Phase 4).
   * Active only — Read-Only is reserved for future read-aloud text input; Privacy never.
   */
  canVoice: boolean
}

/**
 * Allowed IPC / CDP surface per capability class.
 *
 * | Action        | Active | Read-Only | Privacy |
 * |---------------|--------|-----------|---------|
 * | cdpAttach     | ✓      | ✓         | ✗       |
 * | getAxTree     | ✓      | ✓         | ✗       |
 * | highlightNode | ✓      | ✗         | ✗       |
 * | navigate      | ✓      | ✗         | ✗       |
 * | input         | ✓      | ✗         | ✗       |
 * | voice         | ✓      | ✗         | ✗       |
 *
 * Privacy lifecycle (openPrivacyTab / closeTab) is separate from cdp:* / voice:* channels.
 */
export const CAPABILITY_PERMISSIONS: Record<
  TabCapability,
  CapabilityPermissions
> = {
  active: {
    canCdpAttach: true,
    canGetAxTree: true,
    canHighlight: true,
    canNavigate: true,
    canInput: true,
    canVoice: true
  },
  readOnly: {
    canCdpAttach: true,
    canGetAxTree: true,
    canHighlight: false,
    canNavigate: false,
    canInput: false,
    canVoice: false
  },
  privacy: {
    canCdpAttach: false,
    canGetAxTree: false,
    canHighlight: false,
    canNavigate: false,
    canInput: false,
    canVoice: false
  }
}

const ACTION_TO_FLAG: Record<CapabilityAction, keyof CapabilityPermissions> = {
  cdpAttach: 'canCdpAttach',
  getAxTree: 'canGetAxTree',
  highlightNode: 'canHighlight',
  navigate: 'canNavigate',
  input: 'canInput',
  voice: 'canVoice'
}

/** Pure gate — true if the capability class may perform the action. */
export function isActionAllowed(
  capability: TabCapability,
  action: CapabilityAction
): boolean {
  const perms = CAPABILITY_PERMISSIONS[capability]
  return perms[ACTION_TO_FLAG[action]] === true
}

export function getPermissions(
  capability: TabCapability
): CapabilityPermissions {
  return CAPABILITY_PERMISSIONS[capability]
}
