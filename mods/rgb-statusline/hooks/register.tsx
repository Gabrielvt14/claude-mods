import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Snapshot } from '../types'

const snapshot = atom({ plugin: 'rgb-statusline', key: 'snapshot' } as const, null)

type Rgb = [number, number, number]

const GREEN: Rgb = [0, 200, 80]
const YELLOW: Rgb = [220, 200, 0]
const RED: Rgb = [220, 40, 20]
const EMPTY = '#3c3c3c'
const SESSION_FILL = '#3b82f6'
const SESSION_EMPTY = '#0f2a4a'
const BLOCKS = 20

const hex = ([r, g, b]: Rgb) =>
  '#' + [r, g, b].map(c => Math.round(c).toString(16).padStart(2, '0')).join('')

const mix = (a: Rgb, b: Rgb, t: number): Rgb => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
]

// t in [0, 1]: green → yellow → red
const gradient = (t: number) =>
  hex(t < 0.5 ? mix(GREEN, YELLOW, t * 2) : mix(YELLOW, RED, (t - 0.5) * 2))

const emoji = (pct: number) => (pct >= 90 ? '🚨' : pct >= 70 ? '🔥' : pct >= 20 ? '⚡' : '🟢')

const levelColor = (pct: number) =>
  pct >= 90 ? hex(RED) : pct >= 70 ? hex([220, 120, 10]) : pct >= 20 ? hex(YELLOW) : hex(GREEN)

const lineCount = (s: string) => (s === '' ? 0 : s.split('\n').length)

// "3h 56m", "12m", or "now"
const countdown = (ms: number) => {
  const mins = Math.max(0, Math.round(ms / 60000))
  if (mins === 0) return 'now'
  const h = Math.floor(mins / 60)
  return h > 0 ? `${h}h ${mins % 60}m` : `${mins}m`
}

const basename = (p: string) => p.replace(/\/+$/, '').split('/').pop() || p

let added = 0
let removed = 0
let effort: string | null = null

async function git($: EngineInterface, args: string[]) {
  try {
    const { exitCode, stdout } = await $.process.run(['git', ...args])
    return exitCode === 0 ? stdout.trim() : null
  } catch {
    return null
  }
}

async function refresh($: EngineInterface) {
  const [cwd, model, usage, top, branch] = await Promise.all([
    $.session.cwd(),
    $.session.model(),
    $.session.usage(),
    git($, ['rev-parse', '--show-toplevel']),
    git($, ['rev-parse', '--abbrev-ref', 'HEAD']),
  ])
  const next: Snapshot = {
    repo: basename(top ?? cwd),
    branch,
    percent: usage.context.percent ?? 0,
    usd: usage.cost?.usd ?? 0,
    added,
    removed,
    model,
    // a reload starts the module over; keep the last effort $.state still holds
    effort: effort ?? (await read($, snapshot))?.effort ?? null,
    session: (() => {
      const w = usage.rateLimits.find(r => r.kind === 'five_hour')
      if (w === undefined) return null
      const at = w.resetsAt === undefined ? NaN : Date.parse(w.resetsAt)
      return { percent: w.percentUsed, resetsAt: Number.isNaN(at) ? null : at }
    })(),
  }
  await update($, snapshot, () => next)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const r = await next(e)
    await refresh($)
    return r
  })

  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    if (ran.deny === undefined && ran.isError !== true) {
      if (e.tool === 'Edit') {
        removed += lineCount(e.old_string)
        added += lineCount(e.new_string)
      } else if (e.tool === 'Write') {
        added += lineCount(e.content)
      }
    }
    await refresh($)
    return ran
  }).catch(($, e, next) => next(e))

  // effort is only known per model request; read it off the main loop's steps
  on('turn.step', async function* ($, e, next) {
    if (e.agentId === undefined) {
      const seen = e.effort === undefined ? null : String(e.effort)
      if (seen !== effort) {
        effort = seen
        await update($, snapshot, s => (s === null ? s : { ...s, effort }))
      }
    }
    return yield* next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    await refresh($)
    return r
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const s = await read($, snapshot)
    if (s === null || e.props.hasSurvey) return next(e)

    const { Box, Text } = $.ui.resolve(e)
    const pct = Math.max(0, Math.min(100, Math.round(s.percent)))
    const filled = Math.round((pct / 100) * BLOCKS)
    const sep = <Text color="#6c6c6c" dimColor> │ </Text>
    const now = await $.clock.now()
    const sp = s.session === null ? null : Math.max(0, Math.min(100, Math.round(s.session.percent)))

    return (
      <Box flexDirection="column">
        <Text wrap="truncate-end">
          <Text color="yellow" bold>{s.repo}</Text>
          {s.branch !== null && (
            <Text>
              {' '}
              <Text color="cyan" bold>🌿 ({s.branch})</Text>
            </Text>
          )}
          {sep}
          {Array.from({ length: BLOCKS }, (_, i) => (
            <Text color={i < filled ? gradient(i / (BLOCKS - 1)) : EMPTY}>█</Text>
          ))}
          <Text> {emoji(pct)} </Text>
          <Text color={levelColor(pct)} bold>{pct}%</Text>
          {sep}
          <Text color="yellow">${s.usd.toFixed(2)}</Text>
          {sep}
          <Text color="green">+{s.added}</Text>
          <Text> </Text>
          <Text color="red">-{s.removed}</Text>
          {sep}
          <Text color="magenta">🤖 {s.model}</Text>
          {s.effort !== null && <Text color="magenta" dimColor> · {s.effort}</Text>}
        </Text>
        {s.session !== null && sp !== null && (
          <Text wrap="truncate-end">
            <Text color="#c8c8c8" bold>Session</Text>
            {sep}
            {Array.from({ length: BLOCKS }, (_, i) => (
              <Text color={i < Math.round((sp / 100) * BLOCKS) ? SESSION_FILL : SESSION_EMPTY}>█</Text>
            ))}
            <Text color={levelColor(sp)} bold> {sp}% used</Text>
            {s.session.resetsAt !== null && (
              <Text>
                {sep}
                <Text color="#8a8a8a">resets in {countdown(s.session.resetsAt - now)}</Text>
              </Text>
            )}
          </Text>
        )}
      </Box>
    )
  })
}
