/** Keep idle submissions in Chat across independently delivered Inbox and transcript frames. */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, type Page } from 'playwright'
import { expect, it, vi } from 'vite-plus/test'
import type { InboxState } from '@deepseek-ai/dsh-agent/types'
import type { SessionEvent } from '@deepseek-ai/dsh-session/types'
import { deriveReplayScript, parseSessionLog } from '@deepseek-ai/dsh-llm-replay'
import { parseRemoteStreamClientMessage, parseRemoteStreamServerMessage } from '@deepseek-ai/dsh-api-gateway/stream-protocol'
import { launchWebScaffold, seedSession, watchConsole, webSnapshotMode } from './scaffold.ts'
import { newEnglishPage, removeDiagnosticUrls, safeRequestPathname } from './support.ts'

const FIXTURE = fileURLToPath(new URL('../../../snapshots/web/live-interactions/session.v3.jsonl', import.meta.url))
const SESSION_ID = 'idle-submission-handoff'
const TEXT = 'IDLE_SUBMISSION_HANDOFF Keep this message in the conversation.'
const POLL_RETRY_WINDOW_MS = 1_000
const POLL_RETRY_INTERVAL_MS = 50
let failureScreenshotSequence = 0

interface Delivery {
  readonly arrival: number
  readonly receivedAt: number
  readonly stream: string
  readonly endpoint?: string
  readonly frameType: string
  readonly controlType?: string
  readonly controlKey?: string
  readonly eventSequence?: number
  readonly inbox?: InboxState
  readonly inboxHasInput?: boolean
  readonly event?: SessionEvent
  readonly send: () => void
}

interface DeliveryObservation {
  readonly arrival: number
  readonly receivedAt: number
  readonly stream: string
  readonly endpoint?: string
  readonly frameType: string
  readonly controlType?: string
  readonly controlKey?: string
  readonly eventType?: string
  readonly eventSequence?: number
  readonly inboxHasInput?: boolean
}

interface ReleaseBatchObservation {
  readonly kind: 'through' | 'all'
  readonly startedAt: number
  readonly targetArrival?: number
  readonly bufferedBefore: readonly DeliveryObservation[]
  readonly requestedArrivals: readonly number[]
}

interface PlacementValue {
  readonly echo: number
  readonly dock: number
  readonly durable: number
  readonly messageTop: number | null
  readonly composerTop: number | null
}

interface PlacementEvaluationTiming {
  readonly candidateScanMs: number
  readonly geometryReadMs: number
  readonly totalMs: number
}

interface PlacementObservation {
  readonly attempt: number
  readonly startedAt: number
  settledAt?: number
  durationMs?: number
  placementEvaluation?: PlacementEvaluationTiming
  elapsedOutsidePlacementEvaluationMs?: number
  result?: PlacementValue
  error?: string
}

/** Delay real Host frames while preserving FIFO within each logical stream. */
class HistoryDeliveryGate {
  private readonly streams = new Map<string, string>()
  private buffered: Delivery[] = []
  private nextArrival = 0
  private readonly enqueueRequests: Array<DeliveryObservation & { readonly requestedAt: number }> = []
  private readonly releaseBatches: ReleaseBatchObservation[] = []
  holding = false

  async install(page: Page): Promise<void> {
    await page.routeWebSocket('**/api/remote.mux', (socket) => {
      const server = socket.connectToServer()
      socket.onMessage((message) => {
        const frame = parseRemoteStreamClientMessage(String(message))
        if (frame.type === 'open') this.streams.set(frame.streamId, frame.endpoint)
        server.send(message)
      })
      server.onMessage((message) => {
        const frame = parseRemoteStreamServerMessage(String(message))
        const endpoint = this.streams.get(frame.streamId)
        if (!this.holding || (endpoint !== 'session/control' && endpoint !== 'session/follow')) {
          socket.send(message)
          return
        }
        const control =
          endpoint === 'session/control' && frame.type === 'item'
            ? (frame.value as { type: string; sessionId?: string; key?: string; value?: InboxState })
            : undefined
        const inbox =
          control?.type === 'projection' && control.sessionId === SESSION_ID && control.key === 'inbox' ? control.value : undefined
        const follow =
          endpoint === 'session/follow' && frame.type === 'item' ? (frame.value as { type: string; event?: SessionEvent }) : undefined
        const arrival = ++this.nextArrival
        const receivedAt = performance.now()
        const inboxHasInput = inbox?.['next-turn'].some((message) =>
          message.content.some((block) => block.type === 'text' && block.text === TEXT),
        )
        this.buffered.push({
          arrival,
          receivedAt,
          stream: frame.streamId,
          endpoint,
          frameType: frame.type,
          ...(control?.type === undefined ? {} : { controlType: control.type }),
          ...(control?.key === undefined ? {} : { controlKey: control.key }),
          ...(follow?.event === undefined ? {} : { eventSequence: follow.event.seq }),
          send: () => {
            socket.send(message)
          },
          ...(inboxHasInput === undefined ? {} : { inboxHasInput }),
          ...(follow?.event === undefined ? {} : { event: follow.event }),
          ...(inbox === undefined ? {} : { inbox }),
        })
      })
    })
  }

  inboxDelivery(queued: boolean, text = TEXT): Delivery | undefined {
    return this.buffered.find(
      (item) =>
        item.inbox !== undefined &&
        item.inbox['next-turn'].some((message) => message.content.some((block) => block.type === 'text' && block.text === text)) === queued,
    )
  }

  admissionDelivery(text = TEXT): Delivery | undefined {
    return this.buffered.find(
      (item) =>
        item.event?.type === 'user/message' && item.event.data.content.some((block) => block.type === 'text' && block.text === text),
    )
  }

  turnStartDelivery(): Delivery | undefined {
    return this.buffered.find((item) => item.event?.type === 'turn/start')
  }

  turnEndDelivery(): Delivery | undefined {
    return this.buffered.find((item) => item.event?.type === 'turn/end')
  }

  releaseThrough(target: Delivery): void {
    let reached = false
    const startedAt = performance.now()
    const bufferedBefore = this.buffered.map((item) => this.observe(item))
    const requestedArrivals: number[] = []
    this.buffered = this.buffered.filter((item) => {
      if (reached || item.stream !== target.stream) return true
      this.requestSend(item)
      requestedArrivals.push(item.arrival)
      reached = item === target
      return false
    })
    this.releaseBatches.push({ kind: 'through', startedAt, targetArrival: target.arrival, bufferedBefore, requestedArrivals })
  }

  releaseAll(): void {
    const startedAt = performance.now()
    this.holding = false
    const bufferedBefore = this.buffered.map((item) => this.observe(item))
    const requestedArrivals = this.buffered.map((item) => item.arrival)
    for (const item of this.buffered) this.requestSend(item)
    this.releaseBatches.push({ kind: 'all', startedAt, bufferedBefore, requestedArrivals })
    this.buffered = []
  }

  diagnostics(): {
    holding: boolean
    buffered: DeliveryObservation[]
    enqueueRequests: Array<DeliveryObservation & { requestedAt: number }>
    releaseBatches: ReleaseBatchObservation[]
  } {
    return {
      holding: this.holding,
      buffered: this.buffered.map((item) => this.observe(item)),
      enqueueRequests: [...this.enqueueRequests],
      releaseBatches: [...this.releaseBatches],
    }
  }

  private requestSend(item: Delivery): void {
    this.enqueueRequests.push({ ...this.observe(item), requestedAt: performance.now() })
    item.send()
  }

  private observe(item: Delivery): DeliveryObservation {
    return {
      arrival: item.arrival,
      receivedAt: item.receivedAt,
      stream: item.stream,
      ...(item.endpoint === undefined ? {} : { endpoint: item.endpoint }),
      frameType: item.frameType,
      ...(item.controlType === undefined ? {} : { controlType: item.controlType }),
      ...(item.controlKey === undefined ? {} : { controlKey: item.controlKey }),
      ...(item.event?.type === undefined ? {} : { eventType: item.event.type }),
      ...(item.eventSequence === undefined ? {} : { eventSequence: item.eventSequence }),
      ...(item.inboxHasInput === undefined ? {} : { inboxHasInput: item.inboxHasInput }),
    }
  }
}

async function placement(
  page: Page,
  input = TEXT,
  onEvaluationTiming?: (timing: PlacementEvaluationTiming) => void,
): Promise<PlacementValue> {
  const evaluation = await page.evaluate(
    ({ text, measure }) => {
      const startedAt = measure ? performance.now() : undefined
      const matching = (selector: string) =>
        [...document.querySelectorAll<HTMLElement>(selector)].filter((element) => element.textContent?.includes(text))
      const echo = matching('[data-submission-echo]')
      const dock = matching('[data-queue-dock] li')
      const durable = matching('[data-chat-flow-kind="user"]')
      const candidatesScannedAt = startedAt === undefined ? undefined : performance.now()
      const result = {
        echo: echo.length,
        dock: dock.length,
        durable: durable.length,
        messageTop: (echo[0] ?? dock[0] ?? durable[0])?.getBoundingClientRect().top ?? null,
        composerTop: document.querySelector('[data-composer-card]')?.getBoundingClientRect().top ?? null,
      }
      const finishedAt = startedAt === undefined ? undefined : performance.now()
      return {
        result,
        ...(startedAt === undefined || candidatesScannedAt === undefined || finishedAt === undefined
          ? {}
          : {
              timing: {
                candidateScanMs: candidatesScannedAt - startedAt,
                geometryReadMs: finishedAt - candidatesScannedAt,
                totalMs: finishedAt - startedAt,
              },
            }),
      }
    },
    { text: input, measure: onEvaluationTiming !== undefined },
  )
  if ('timing' in evaluation) onEvaluationTiming?.(evaluation.timing)
  return evaluation.result
}

async function boundedPlacementRead(
  page: Page,
): Promise<
  | { readonly status: 'resolved'; readonly value: Awaited<ReturnType<typeof placement>> }
  | { readonly status: 'rejected'; readonly error: string }
  | { readonly status: 'pending' }
> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      placement(page).then(
        (value) => ({ status: 'resolved' as const, value }),
        (error: unknown) => ({
          status: 'rejected' as const,
          error: removeDiagnosticUrls(error instanceof Error ? error.message : String(error)).slice(0, 500),
        }),
      ),
      new Promise<{ readonly status: 'pending' }>((resolve) => {
        timer = setTimeout(() => {
          resolve({ status: 'pending' })
        }, 500)
      }),
    ])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

/** Preserve Vitest 4 poll-window semantics for an active browser read.
 * The 1-second deadline marks the next attempt final; it does not end the active read.
 * @param read Reads the current value.
 * @param assertValue Throws when the value does not match.
 * @returns The first value accepted by the assertion.
 */
async function pollWithInFlightRead<T>(read: () => Promise<T>, assertValue: (value: T) => void): Promise<T> {
  let retryWindowElapsed = false
  const retryWindow = setTimeout(() => {
    retryWindowElapsed = true
  }, POLL_RETRY_WINDOW_MS)
  try {
    while (true) {
      const isFinalAttempt = retryWindowElapsed
      try {
        const value = await read()
        assertValue(value)
        return value
      } catch (error) {
        if (isFinalAttempt) throw error
        await new Promise<void>((resolve) => {
          setTimeout(resolve, POLL_RETRY_INTERVAL_MS)
        })
      }
    }
  } finally {
    clearTimeout(retryWindow)
  }
}

it('allows a poll read that started inside the retry window to match after expiry', async () => {
  vi.useFakeTimers()
  try {
    const read = Promise.withResolvers<string>()
    let attempts = 0
    const pending = pollWithInFlightRead(
      () => {
        attempts++
        return read.promise
      },
      (value) => {
        expect(value).toBe('ready')
      },
    )
    await vi.advanceTimersByTimeAsync(POLL_RETRY_WINDOW_MS)
    read.resolve('ready')
    await expect(pending).resolves.toBe('ready')
    expect(attempts).toBe(1)
    expect(vi.getTimerCount()).toBe(0)
  } finally {
    vi.useRealTimers()
  }
})

it('retries a mismatch before the poll retry window expires', async () => {
  vi.useFakeTimers()
  try {
    let attempts = 0
    const pending = pollWithInFlightRead(
      async () => (++attempts === 1 ? 'waiting' : 'ready'),
      (value) => {
        expect(value).toBe('ready')
      },
    )
    await vi.advanceTimersByTimeAsync(POLL_RETRY_INTERVAL_MS)
    await expect(pending).resolves.toBe('ready')
    expect(attempts).toBe(2)
    expect(vi.getTimerCount()).toBe(0)
  } finally {
    vi.useRealTimers()
  }
})

it('allows exactly one final read after an in-flight read fails past expiry', async () => {
  vi.useFakeTimers()
  try {
    const read = Promise.withResolvers<string>()
    let attempts = 0
    const pending = pollWithInFlightRead(
      () => {
        attempts++
        return attempts === 1 ? read.promise : Promise.resolve('ready')
      },
      (value) => {
        expect(value).toBe('ready')
      },
    )
    await vi.advanceTimersByTimeAsync(POLL_RETRY_WINDOW_MS)
    read.reject(new Error('first read failed'))
    await vi.advanceTimersByTimeAsync(POLL_RETRY_INTERVAL_MS)
    await expect(pending).resolves.toBe('ready')
    expect(attempts).toBe(2)
    expect(vi.getTimerCount()).toBe(0)
  } finally {
    vi.useRealTimers()
  }
})

it('preserves the final assertion or read error without another retry', async () => {
  vi.useFakeTimers()
  try {
    const badPlacement: PlacementValue = { echo: 0, dock: 0, durable: 0, messageTop: 331, composerTop: 872 }
    const firstMismatchRead = Promise.withResolvers<PlacementValue>()
    let mismatchAttempts = 0
    let matcherError: unknown
    const mismatchPending = pollWithInFlightRead(
      () => {
        mismatchAttempts++
        return mismatchAttempts === 1 ? firstMismatchRead.promise : Promise.resolve(badPlacement)
      },
      (value) => {
        try {
          expect(value).toMatchObject({ echo: 0, dock: 0, durable: 1 })
        } catch (error) {
          matcherError = error
          throw error
        }
      },
    )
    const mismatchResult = mismatchPending.then(
      (value) => ({ status: 'resolved' as const, value }),
      (error: unknown) => ({ status: 'rejected' as const, error }),
    )
    await vi.advanceTimersByTimeAsync(POLL_RETRY_WINDOW_MS)
    firstMismatchRead.reject(new Error('first read failed'))
    await vi.advanceTimersByTimeAsync(POLL_RETRY_INTERVAL_MS)
    const mismatchOutcome = await mismatchResult
    expect(mismatchOutcome.status).toBe('rejected')
    if (mismatchOutcome.status === 'rejected') {
      expect(mismatchOutcome.error).toBe(matcherError)
    }
    expect(mismatchAttempts).toBe(2)
    expect(vi.getTimerCount()).toBe(0)

    const finalReadError = new Error('final read failed')
    const firstRead = Promise.withResolvers<string>()
    let readAttempts = 0
    const readPending = pollWithInFlightRead(
      () => {
        readAttempts++
        return readAttempts === 1 ? firstRead.promise : Promise.reject(finalReadError)
      },
      (value) => {
        expect(value).toBe('ready')
      },
    )
    const readAssertion = expect(readPending).rejects.toBe(finalReadError)
    await vi.advanceTimersByTimeAsync(POLL_RETRY_WINDOW_MS)
    firstRead.reject(new Error('first read failed'))
    await vi.advanceTimersByTimeAsync(POLL_RETRY_INTERVAL_MS)
    await readAssertion
    expect(readAttempts).toBe(2)
    expect(vi.getTimerCount()).toBe(0)
  } finally {
    vi.useRealTimers()
  }
})

it.skipIf(webSnapshotMode() === 'record').each(['inbox-first', 'transcript-first'] as const)(
  'keeps an idle submission in Chat under CPU throttling (%s)',
  async (order) => {
    const scaffold = await launchWebScaffold({ replayFixture: FIXTURE, compareReplaySession: false })
    const releasePrompt = Promise.withResolvers<undefined>()
    const promptBlocked = Promise.withResolvers<undefined>()
    const gate = new HistoryDeliveryGate()
    let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined
    let page: Page | undefined
    let tripwire: ReturnType<typeof watchConsole> | undefined
    let phase = 'setup'
    const phaseHistory: Array<{ readonly phase: string; readonly at: number }> = []
    const trace: Array<{ phase: string } & Awaited<ReturnType<typeof placement>>> = []
    const placementAttempts: PlacementObservation[] = []
    let placementAttempt = 0
    const markPhase = (next: string): void => {
      phase = next
      phaseHistory.push({ phase: next, at: performance.now() })
    }
    phaseHistory.push({ phase, at: performance.now() })
    try {
      await seedSession(scaffold, await readFile(FIXTURE, 'utf8'), SESSION_ID)
      browser = await chromium.launch()
      page = await newEnglishPage(browser)
      tripwire = watchConsole(page)
      await gate.install(page)
      markPhase('navigate')
      await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
      markPhase('open-session')
      await page.locator('[role="treeitem"]').first().click()
      await page.locator('[role="treeitem"]').nth(1).click()
      markPhase('wait-session-history')
      await page.locator('[data-chat-flow-kind="user"]').first().waitFor()
      markPhase('wait-composer')
      await page.getByRole('button', { name: 'Send message', exact: true }).waitFor()
      const cdp = await page.context().newCDPSession(page)
      markPhase('enable-cpu-throttling')
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: 6 })
      markPhase('install-prompt-barrier')
      await page.route(
        '**/api/session/prompt',
        async (route) => {
          promptBlocked.resolve(undefined)
          await releasePrompt.promise
          await route.continue()
        },
        { times: 1 },
      )
      const settled = scaffold.whenTurnSettled()
      gate.holding = true
      const input = page.locator('[data-composer-input]').first()
      markPhase('submit-input')
      await input.fill(TEXT)
      await input.press('Enter')
      markPhase('wait-prompt-blocked')
      await promptBlocked.promise
      markPhase('poll-optimistic-placement')
      await expect.poll(() => placement(page)).toMatchObject({ echo: 1, dock: 0, durable: 0 })
      trace.push({ phase: 'optimistic', ...(await placement(page)) })
      releasePrompt.resolve(undefined)

      if (order === 'transcript-first') {
        markPhase('wait-turn-start-frame')
        await expect.poll(() => gate.turnStartDelivery()).toBeDefined()
        gate.releaseThrough(gate.turnStartDelivery()!)
        markPhase('wait-turn-process')
        await page.locator('[data-chat-flow-kind="turn-process"]').last().waitFor({ state: 'attached' })
        await expect.poll(() => placement(page)).toMatchObject({ echo: 1, dock: 0, durable: 0 })
        trace.push({ phase: 'turn-start', ...(await placement(page)) })
        markPhase('wait-admission-frame')
        await expect.poll(() => gate.admissionDelivery()).toBeDefined()
        gate.releaseThrough(gate.admissionDelivery()!)
        markPhase('poll-durable-before-inbox')
        await expect.poll(() => placement(page)).toMatchObject({ echo: 0, dock: 0, durable: 1 })
        trace.push({ phase: 'durable-before-inbox', ...(await placement(page)) })
      }

      markPhase('wait-inbox-queued-frame')
      await expect.poll(() => gate.inboxDelivery(true)).toBeDefined()
      gate.releaseThrough(gate.inboxDelivery(true)!)
      markPhase('poll-after-inbox-release')
      await expect
        .poll(() => placement(page))
        .toMatchObject({ echo: order === 'inbox-first' ? 1 : 0, dock: 0, durable: order === 'transcript-first' ? 1 : 0 })
      trace.push({ phase: 'inbox', ...(await placement(page)) })

      markPhase('wait-inbox-claim-frame')
      await expect.poll(() => gate.inboxDelivery(false)).toBeDefined()
      gate.releaseThrough(gate.inboxDelivery(false)!)
      markPhase('poll-after-claim-release')
      await expect
        .poll(() => placement(page))
        .toMatchObject({ echo: order === 'inbox-first' ? 1 : 0, dock: 0, durable: order === 'transcript-first' ? 1 : 0 })
      trace.push({ phase: 'claim-projection', ...(await placement(page)) })

      if (order === 'inbox-first') {
        markPhase('wait-turn-start-frame')
        await expect.poll(() => gate.turnStartDelivery()).toBeDefined()
        gate.releaseThrough(gate.turnStartDelivery()!)
        markPhase('wait-turn-process')
        await page.locator('[data-chat-flow-kind="turn-process"]').last().waitFor({ state: 'attached' })
        await expect.poll(() => placement(page)).toMatchObject({ echo: 1, dock: 0, durable: 0 })
        trace.push({ phase: 'turn-start', ...(await placement(page)) })
        markPhase('wait-admission-frame')
        await expect.poll(() => gate.admissionDelivery()).toBeDefined()
      }

      markPhase('release-all-buffered-frames')
      gate.releaseAll()
      markPhase('poll-durable-after-release')
      const observeFinalPlacement = (): Promise<PlacementValue> => {
        const observation: PlacementObservation = { attempt: ++placementAttempt, startedAt: performance.now() }
        placementAttempts.push(observation)
        if (placementAttempts.length > 12) placementAttempts.shift()
        const pending = placement(page!, TEXT, (placementEvaluation) => {
          Object.assign(observation, { placementEvaluation })
        })
        void pending.then(
          (result) => {
            const settledAt = performance.now()
            const durationMs = settledAt - observation.startedAt
            Object.assign(observation, {
              settledAt,
              durationMs,
              ...(observation.placementEvaluation === undefined
                ? {}
                : { elapsedOutsidePlacementEvaluationMs: durationMs - observation.placementEvaluation.totalMs }),
              result,
            })
          },
          (error: unknown) => {
            const settledAt = performance.now()
            Object.assign(observation, {
              settledAt,
              durationMs: settledAt - observation.startedAt,
              error: removeDiagnosticUrls(error instanceof Error ? error.message : String(error)).slice(0, 500),
            })
          },
        )
        return pending
      }
      await pollWithInFlightRead(observeFinalPlacement, (value) => {
        expect(value).toMatchObject({ echo: 0, dock: 0, durable: 1 })
      })
      trace.push({ phase: 'durable', ...(await placement(page)) })
      for (const entry of trace) {
        expect(entry.messageTop, entry.phase).toBe(trace[0]?.messageTop)
        expect(entry.composerTop, entry.phase).toBe(trace[0]?.composerTop)
      }
      await settled
      markPhase('restore-cpu-throttling')
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 })
      await cdp.detach()
      expect(tripwire.pageErrors).toEqual([])
      markPhase('complete')
    } catch (error) {
      try {
        const caughtAt = performance.now()
        const failureState = {
          order,
          phase,
          caughtAt,
          phaseHistory: [...phaseHistory],
          trace: trace.map((entry) => ({ ...entry })),
          placementAttempts: placementAttempts.map((attempt) => ({ ...attempt })),
          gate: gate.diagnostics(),
          page:
            page === undefined
              ? undefined
              : {
                  path: safeRequestPathname(page.url()),
                  pageErrors: (tripwire?.pageErrors ?? []).map((message) => removeDiagnosticUrls(message).slice(0, 500)),
                  consoleWarnings: (tripwire?.warnings ?? []).map((message) => removeDiagnosticUrls(message).slice(0, 500)),
                },
        }
        const finalPlacementRead = page === undefined ? { status: 'page unavailable' } : await boundedPlacementRead(page)
        const placementAttemptsAfterLateRead = placementAttempts.map((attempt) => ({ ...attempt }))
        let screenshot: string | undefined
        let screenshotError: string | undefined
        if (page !== undefined) {
          screenshot = join(tmpdir(), `dsh-idle-submission-handoff-${process.pid}-${++failureScreenshotSequence}-${order}.png`)
          try {
            await page.screenshot({ path: screenshot, timeout: 1_000 })
          } catch (captureError) {
            screenshot = undefined
            screenshotError = removeDiagnosticUrls(captureError instanceof Error ? captureError.message : String(captureError)).slice(
              0,
              300,
            )
          }
        }
        console.error(
          `idle-submission-handoff failure diagnostics: ${JSON.stringify({
            ...failureState,
            finalPlacementRead,
            placementAttemptsAfterLateRead,
            screenshot,
            screenshotError,
            receiptSemantics: 'arrival and receivedAt mark Node-gate receipt; requestedAt marks WebSocketRoute.send invocation',
            sendSemantics: 'WebSocketRoute.send invocation only; not browser receipt acknowledgement',
          })}`,
        )
      } catch (diagnosticError) {
        console.error(
          `idle-submission-handoff diagnostics unavailable: ${removeDiagnosticUrls(
            diagnosticError instanceof Error ? diagnosticError.message : String(diagnosticError),
          ).slice(0, 300)}`,
        )
      }
      throw error
    } finally {
      releasePrompt.resolve(undefined)
      gate.releaseAll()
      try {
        await browser?.close()
      } finally {
        await scaffold.close()
      }
    }
  },
)

it.skipIf(webSnapshotMode() === 'record').each(['ABC', 'ACB', 'BAC', 'BCA', 'CAB', 'CBA'])(
  'hands off three rapid submissions through all Turns in Host order %s',
  async (hostOrder) => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-input-handoff-'))
    const releases = new Map(['A', 'B', 'C'].map((id) => [id, Promise.withResolvers<undefined>()]))
    const blocked = new Set<string>()
    const gate = new HistoryDeliveryGate()
    let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined
    let scaffold: Awaited<ReturnType<typeof launchWebScaffold>> | undefined
    try {
      const fixture = await readFile(FIXTURE, 'utf8')
      const recorded = deriveReplayScript(parseSessionLog(fixture))
      expect(recorded).toHaveLength(1)
      const override = join(root, 'replay.override.json')
      await writeFile(override, JSON.stringify([recorded[0], recorded[0], recorded[0]]))
      scaffold = await launchWebScaffold({ replayFixture: FIXTURE, replayOverride: override, compareReplaySession: false })
      await seedSession(scaffold, fixture, SESSION_ID)
      browser = await chromium.launch()
      const page = await newEnglishPage(browser)
      const tripwire = watchConsole(page)
      await gate.install(page)
      await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
      await page.locator('[role="treeitem"]').first().click()
      await page.locator('[role="treeitem"]').nth(1).click()
      await page.locator('[data-chat-flow-kind="user"]').first().waitFor()
      await page.getByRole('button', { name: 'Send message', exact: true }).waitFor()
      const text = (id: string) => `RAPID_INPUT_${id}`
      await page.route('**/api/session/prompt', async (route) => {
        const request = route.request().postData() ?? ''
        const id = [...releases.keys()].find((id) => request.includes(text(id)))
        if (id === undefined) throw new Error('unexpected prompt in rapid input fixture')
        blocked.add(id)
        await releases.get(id)!.promise
        await route.continue()
      })
      gate.holding = true
      const input = page.locator('[data-composer-input]').first()
      for (const id of releases.keys()) {
        await input.fill(text(id))
        await input.press('Enter')
        await expect.poll(() => blocked.has(id)).toBe(true)
        await expect.poll(() => placement(page, text(id))).toMatchObject({ echo: 1, dock: 0, durable: 0 })
      }
      const entered: string[] = []
      for (const id of hostOrder) {
        const settled = scaffold.whenTurnSettled()
        releases.get(id)!.resolve(undefined)
        await expect.poll(() => gate.turnStartDelivery()).toBeDefined()
        gate.releaseThrough(gate.turnStartDelivery()!)
        await expect.poll(() => gate.admissionDelivery(text(id))).toBeDefined()
        gate.releaseThrough(gate.admissionDelivery(text(id))!)
        entered.push(id)
        for (const candidate of releases.keys()) {
          const admitted = entered.includes(candidate)
          await expect
            .poll(() => placement(page, text(candidate)))
            .toMatchObject({
              echo: admitted ? 0 : 1,
              dock: 0,
              durable: admitted ? 1 : 0,
            })
        }
        await expect.poll(() => gate.inboxDelivery(true, text(id))).toBeDefined()
        gate.releaseThrough(gate.inboxDelivery(true, text(id))!)
        await expect.poll(() => placement(page, text(id))).toMatchObject({ echo: 0, dock: 0, durable: 1 })
        await expect.poll(() => gate.inboxDelivery(false, text(id))).toBeDefined()
        gate.releaseThrough(gate.inboxDelivery(false, text(id))!)
        await expect.poll(() => gate.turnEndDelivery()).toBeDefined()
        gate.releaseThrough(gate.turnEndDelivery()!)
        await settled
      }
      gate.releaseAll()
      const actual = await page.locator('[data-chat-flow-kind="user"]').allTextContents()
      expect(
        actual
          .filter((value) => value.includes('RAPID_INPUT_'))
          .map((value) => [...releases.keys()].find((id) => value.includes(text(id)))),
      ).toEqual(hostOrder.split(''))
      expect(await page.locator('[data-submission-echo]').count()).toBe(0)
      expect(await page.locator('[data-queue-dock]').count()).toBe(0)
      expect(tripwire.pageErrors).toEqual([])
    } finally {
      for (const release of releases.values()) release.resolve(undefined)
      gate.releaseAll()
      try {
        await browser?.close()
      } finally {
        try {
          await scaffold?.close()
        } finally {
          await rm(root, { recursive: true, force: true })
        }
      }
    }
  },
)
