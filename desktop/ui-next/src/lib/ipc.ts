/**
 * Typed wrappers for the Rust side. Command names and argument casing match
 * `desktop/src-tauri/src/lib.rs` exactly: Tauri renames camelCase JS keys to
 * snake_case Rust params, so `appsMode` here is `apps_mode` there.
 *
 * Outside Tauri (browser preview, screenshots) every call falls back to
 * `mock.ts` so the UI can be exercised without the engine.
 */
import { invoke } from "@tauri-apps/api/core"
import { mockCall } from "./mock"

export type CmdResult = { ok: boolean; msg: string }

export type Card = {
  name: string
  uuid: string
  card_type: string
  sni: string
  wg_private: string
  wg_addr: string
}

export type UiState = {
  server_ip: string
  ssh_user: string
  ssh_port: number
  cards: Card[]
  version: string
}

export type TunnelState = { running: boolean; error: string }
export type TrafficState = { rx: number; tx: number }
export type UpdateInfo = { current: string; latest: string; available: boolean; url: string }
export type NetInfo = { ip: string; isp: string; place: string }

export const isTauri = (): boolean =>
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window

/** Exit-address facts for the speed page, resolved backend-side. */
export const netInfo = (): Promise<NetInfo | null> => call<NetInfo | null>("net_info")

/** The public speed-test server list as raw JSON (CORS-free, backend-side). */
export const speedServers = (): Promise<string | null> => call<string | null>("speed_servers")

/** Speed measurement, backend-side: any host, and honest byte/ack accounting. */
export const speedLatency = (url: string, probes: number): Promise<number[]> =>
  call<number[]>("speed_latency", { url, probes })

export const speedDown = (urls: string[], seconds: number): Promise<number | null> =>
  call<number | null>("speed_down", { urls, seconds })

export const speedUp = (url: string, seconds: number, chunkMb = 2): Promise<number | null> =>
  call<number | null>("speed_up", { url, seconds, chunkMb })

/** Live Mbps during a run. Returns the unsubscribe. */
export async function onSpeedTick(cb: (mbps: number) => void): Promise<() => void> {
  if (!isTauri()) return () => {}
  const { listen } = await import("@tauri-apps/api/event")
  return listen<number>("speed-tick", (e) => cb(e.payload))
}

/** Which half of the official client's run is active ("download"/"upload"). */
export async function onSpeedPhase(cb: (phase: string) => void): Promise<() => void> {
  if (!isTauri()) return () => {}
  const { listen } = await import("@tauri-apps/api/event")
  return listen<string>("speed-phase", (e) => cb(e.payload))
}

/** What the official speedtest.net client reports for one run. */
export type CliSpeed = {
  ping_ms: number | null
  jitter_ms: number | null
  down_mbps: number | null
  up_mbps: number | null
  server_name: string | null
  server_location: string | null
  server_country: string | null
  server_host: string | null
  isp: string | null
  result_url: string | null
}

/** True once the client binary is fetched and usable (first call downloads it). */
export const speedtestCliReady = (): Promise<boolean> => call<boolean>("speedtest_cli_ready")

/** One full test through the official client, with live speed-phase/tick events. */
export const speedtestCli = (): Promise<CliSpeed | null> => call<CliSpeed | null>("speedtest_cli")

async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (isTauri()) return invoke<T>(cmd, args)
  return mockCall<T>(cmd, args)
}

export const api = {
  state: () => call<UiState>("get_state"),
  probeServer: () => call<CmdResult>("probe_server"),
  generateCard: (name: string, kind: string, sni: string) =>
    call<CmdResult>("generate_card", { name, kind, sni }),
  importCard: (uuid: string, name: string, kind: string, sni: string) =>
    call<CmdResult>("import_card", { uuid, name, kind, sni }),
  revokeCard: (uuid: string) => call<CmdResult>("revoke_card", { uuid }),
  copyCard: (uuid: string) => call<CmdResult>("copy_card", { uuid }),
  start: (uuid: string, appsMode: string, apps: string[], transport: string) =>
    call<CmdResult>("tunnel_start", { uuid, appsMode, apps, transport }),
  stop: () => call<CmdResult>("tunnel_stop"),
  status: () => call<TunnelState>("tunnel_status"),
  traffic: () => call<TrafficState>("tunnel_traffic"),
  log: () => call<string>("tunnel_log"),
  copyLog: () => call<CmdResult>("tunnel_copy_log"),
  apps: () => call<string>("tunnel_apps"),
  resolveHost: (host: string) => call<string>("resolve_host", { host }),
  probeTunnel: () => call<CmdResult>("tunnel_probe"),
  checkUpdate: () => call<UpdateInfo>("check_update"),
  applyUpdate: () => call<string>("apply_update"),
}
