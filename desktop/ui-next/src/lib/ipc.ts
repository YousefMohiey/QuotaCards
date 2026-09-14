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
}

export type TunnelState = { running: boolean; error: string }
export type TrafficState = { rx: number; tx: number }
export type UpdateInfo = { current: string; latest: string; available: boolean; url: string }

export const isTauri = (): boolean =>
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window

async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (isTauri()) return invoke<T>(cmd, args)
  return mockCall<T>(cmd, args)
}

export const api = {
  state: () => call<UiState>("get_state"),
  probeServer: () => call<CmdResult>("probe_server"),
  generateCard: (name: string, kind: string, sni: string) =>
    call<CmdResult>("generate_card", { name, kind, sni }),
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
