export type Snapshot = {
  repo: string
  branch: string | null
  percent: number
  usd: number
  added: number
  removed: number
  model: string
  effort: string | null
  session: { percent: number; resetsAt: number | null } | null
}

declare module 'claude-code' {
  interface PluginState {
    'rgb-statusline': { snapshot: Snapshot | null }
  }
}
