/** Controlled browser audio devices with real Recording ownership and conversion. */
import { vi } from 'vite-plus/test'
import type { Mock } from 'vite-plus/test'
import { Recording } from '../src/client/audio.ts'

interface OfflineContextFixture {
  readonly destination: object
  createBufferSource(): { buffer: null; connect(): void; start(): void }
  readonly startRendering: Mock<() => Promise<{ getChannelData(): Float32Array }>>
}

interface CaptureFixture {
  readonly recording: Recording
  readonly trackStop: Mock<() => void>
  readonly close: Mock<() => Promise<void>>
  readonly disposed: Mock<() => void>
  readonly decoding: Mock<(data: ArrayBuffer) => Promise<{ duration: number }>>
  readonly rendering: Mock<() => Promise<{ getChannelData(): Float32Array }>>
  readonly offline: Mock<(channels: number, frames: number, rate: number) => OfflineContextFixture>
  readonly failRecorder: () => void
}

/**
 * Install per-test audio devices; callers restore globals and release acquired recordings.
 * @param options - device failures or an empty final recording.
 * @returns the recording, device controls, and resource observations.
 */
export function captureFixture(options: { empty?: boolean; recorderError?: boolean; constructError?: boolean } = {}): CaptureFixture {
  const trackStop = vi.fn<() => void>(),
    close = vi.fn(async () => {}),
    disposed = vi.fn<() => void>()
  const decoding = vi.fn(async (_data: ArrayBuffer) => ({ duration: 2 }))
  const rendering = vi.fn(async () => ({ getChannelData: () => new Float32Array([0.5, -0.5]) }))
  let failRecorder: () => void
  class Recorder {
    state = 'inactive'
    mimeType = 'audio/webm'
    ondataavailable?: (event: { data: Blob }) => void
    onstop?: () => void
    onerror?: () => void
    constructor() {
      if (options.constructError) throw new Error('recorder unavailable')
      failRecorder = () => {
        this.onerror!()
      }
    }
    start() {
      this.state = 'recording'
    }
    stop() {
      this.state = 'inactive'
      queueMicrotask(() => {
        this.ondataavailable?.({ data: new Blob() })
        if (!options.empty) this.ondataavailable?.({ data: new Blob(['final audio']) })
        if (options.recorderError) this.onerror?.()
        else this.onstop?.()
      })
    }
  }
  const offline = vi.fn(function Offline(_channels: number, _frames: number, _rate: number): OfflineContextFixture {
    return { destination: {}, createBufferSource: () => ({ buffer: null, connect() {}, start() {} }), startRendering: rendering }
  })
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: async () => ({ getTracks: () => [{ stop: trackStop }] }) } })
  vi.stubGlobal('MediaRecorder', Recorder)
  vi.stubGlobal('AudioContext', function Audio() {
    return {
      state: 'running',
      close,
      decodeAudioData: decoding,
      createMediaStreamSource: () => ({ connect: vi.fn() }),
      createAnalyser: () => ({
        fftSize: 256,
        getFloatTimeDomainData: (buffer: Float32Array) => {
          buffer.fill(0.25)
        },
      }),
    }
  })
  vi.stubGlobal('OfflineAudioContext', offline)
  return {
    recording: new Recording(disposed),
    trackStop,
    close,
    disposed,
    decoding,
    rendering,
    offline,
    failRecorder: () => {
      failRecorder()
    },
  }
}
