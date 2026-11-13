export type Snapshot = {
  repo: string
  branch: string | null
  percent: number
  usd: number
  added: number
  removed: number
  model: string
  effort: string | null
  // the account's usage window: `session` for 5-hour plans, `spend` for a
  // spend limit (monthly cap, in tokens or $); null when none has a reading
  limit: Limit | null
}

export type Limit = {
  type: 'session' | 'spend'
  label: string
  // raw value: may pass 100 on an exceeded spend limit
  percent: number
  resetsAt: number | null
}

declare module 'claude-code' {
  interface PluginState {
    'rgb-statusline': { snapshot: Snapshot | null }
  }
}
