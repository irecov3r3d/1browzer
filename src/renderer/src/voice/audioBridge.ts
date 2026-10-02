/**
 * Renderer audio path for Phase 4:
 * - Capture mic via getUserMedia + Web Audio
 * - Downsample / convert to 16 kHz Int16 LE PCM
 * - Send frames to Main via voicePcmIn
 * - Play model PCM (24 kHz) from voice:event pcmOut
 * - Stub energy VAD → voiceInterrupt (flush local playback)
 */

import {
  VOICE_INPUT_SAMPLE_RATE_HZ,
  VOICE_OUTPUT_SAMPLE_RATE_HZ
} from '../../../shared/voice'

export type AudioBridgeHandlers = {
  onPcmIn: (pcmBase64: string, sampleRateHz: number) => void
  onVadInterrupt?: () => void
  onError?: (message: string) => void
}

function floatTo16BitPCM(input: Float32Array): Int16Array {
  const out = new Int16Array(input.length)
  for (let i = 0; i < input.length; i++) {
    const s = Math.max(-1, Math.min(1, input[i]!))
    out[i] = s < 0 ? Math.round(s * 0x8000) : Math.round(s * 0x7fff)
  }
  return out
}

/** Simple decimation downsample (good enough for Phase 4 stub). */
function downsample(
  input: Float32Array,
  inputRate: number,
  outputRate: number
): Float32Array {
  if (inputRate === outputRate) return input
  const ratio = inputRate / outputRate
  const newLen = Math.floor(input.length / ratio)
  const out = new Float32Array(newLen)
  for (let i = 0; i < newLen; i++) {
    out[i] = input[Math.floor(i * ratio)] ?? 0
  }
  return out
}

function int16ToBase64(samples: Int16Array): string {
  const bytes = new Uint8Array(samples.buffer, samples.byteOffset, samples.byteLength)
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

function base64ToInt16(b64: string): Int16Array {
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return new Int16Array(bytes.buffer)
}

/**
 * Energy-based VAD stub. Signals barge-in when RMS exceeds threshold while
 * the model is presumed speaking (caller sets `playbackActive`).
 */
export class StubVad {
  private readonly threshold: number
  private readonly hangoverMs: number
  private lastFire = 0

  constructor(threshold = 0.04, hangoverMs = 600) {
    this.threshold = threshold
    this.hangoverMs = hangoverMs
  }

  /**
   * @returns true if an interrupt should be signaled
   */
  observe(frame: Float32Array, playbackActive: boolean, now = Date.now()): boolean {
    if (!playbackActive || frame.length === 0) return false
    let sum = 0
    for (let i = 0; i < frame.length; i++) {
      const v = frame[i] ?? 0
      sum += v * v
    }
    const rms = Math.sqrt(sum / frame.length)
    if (rms < this.threshold) return false
    if (now - this.lastFire < this.hangoverMs) return false
    this.lastFire = now
    return true
  }
}

export class MicCapture {
  private stream: MediaStream | null = null
  private context: AudioContext | null = null
  private processor: ScriptProcessorNode | null = null
  private source: MediaStreamAudioSourceNode | null = null
  private readonly vad = new StubVad()
  private playbackActive = false
  private running = false

  constructor(private readonly handlers: AudioBridgeHandlers) {}

  setPlaybackActive(active: boolean): void {
    this.playbackActive = active
  }

  async start(): Promise<void> {
    if (this.running) return
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('getUserMedia is not available in this environment')
    }
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        channelCount: 1
      },
      video: false
    })
    const ctx = new AudioContext()
    this.context = ctx
    this.source = ctx.createMediaStreamSource(this.stream)
    // ScriptProcessor is deprecated but widely available; AudioWorklet can replace later.
    const bufferSize = 4096
    this.processor = ctx.createScriptProcessor(bufferSize, 1, 1)
    this.processor.onaudioprocess = (ev) => {
      const input = ev.inputBuffer.getChannelData(0)
      const copy = new Float32Array(input)
      if (this.vad.observe(copy, this.playbackActive)) {
        this.handlers.onVadInterrupt?.()
      }
      const down = downsample(copy, ctx.sampleRate, VOICE_INPUT_SAMPLE_RATE_HZ)
      const pcm = floatTo16BitPCM(down)
      if (pcm.length === 0) return
      this.handlers.onPcmIn(int16ToBase64(pcm), VOICE_INPUT_SAMPLE_RATE_HZ)
    }
    this.source.connect(this.processor)
    // Keep the processor in the graph without monitoring the mic (avoid feedback).
    const mute = ctx.createGain()
    mute.gain.value = 0
    this.processor.connect(mute)
    mute.connect(ctx.destination)
    this.running = true
  }

  stop(): void {
    this.running = false
    try {
      this.processor?.disconnect()
      this.source?.disconnect()
    } catch {
      // ignore
    }
    this.processor = null
    this.source = null
    if (this.context) {
      void this.context.close()
      this.context = null
    }
    if (this.stream) {
      for (const t of this.stream.getTracks()) t.stop()
      this.stream = null
    }
  }
}

/** Queued PCM playback for model audio (24 kHz typical). */
export class PcmPlayer {
  private context: AudioContext | null = null
  private nextTime = 0
  private activeSources = 0
  private onActiveChange: ((active: boolean) => void) | null = null

  setActiveChangeListener(cb: (active: boolean) => void): void {
    this.onActiveChange = cb
  }

  private ensureContext(sampleRateHz: number): AudioContext {
    if (!this.context || this.context.state === 'closed') {
      this.context = new AudioContext({ sampleRate: sampleRateHz })
      this.nextTime = 0
    }
    return this.context
  }

  enqueue(pcmBase64: string, sampleRateHz = VOICE_OUTPUT_SAMPLE_RATE_HZ): void {
    const samples = base64ToInt16(pcmBase64)
    if (samples.length === 0) return
    const ctx = this.ensureContext(sampleRateHz)
    const buffer = ctx.createBuffer(1, samples.length, sampleRateHz)
    const channel = buffer.getChannelData(0)
    for (let i = 0; i < samples.length; i++) {
      channel[i] = (samples[i] ?? 0) / 0x8000
    }
    const src = ctx.createBufferSource()
    src.buffer = buffer
    src.connect(ctx.destination)
    const startAt = Math.max(ctx.currentTime, this.nextTime)
    src.start(startAt)
    this.nextTime = startAt + buffer.duration
    this.activeSources += 1
    this.onActiveChange?.(true)
    src.onended = () => {
      this.activeSources = Math.max(0, this.activeSources - 1)
      if (this.activeSources === 0) {
        this.onActiveChange?.(false)
      }
    }
  }

  /** Barge-in: drop queued playback immediately. */
  flush(): void {
    if (this.context) {
      void this.context.close()
      this.context = null
    }
    this.nextTime = 0
    this.activeSources = 0
    this.onActiveChange?.(false)
  }

  stop(): void {
    this.flush()
  }
}
