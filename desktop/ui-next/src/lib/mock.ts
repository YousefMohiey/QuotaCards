/**
 * Browser fallback so the UI runs (and can be screenshotted) without the
 * Rust engine: `npm run dev` in a plain browser, or the preview harness.
 * Values mirror the shapes in lib.rs; the tunnel "runs" so connected-state
 * screens are reachable with ?vpn=1.
 */
import type { Card, CmdResult, TrafficState, TunnelState, UpdateInfo } from "./ipc"

const cards: Card[] = [
  { name: "Gamerz (playvalorant.com)", uuid: "11111111-1111-4111-8111-111111111111", card_type: "Gamerz", sni: "playvalorant.com", wg_private: "", wg_addr: "" },
  { name: "Streamerz (youtube.com)", uuid: "22222222-2222-4222-8222-222222222222", card_type: "Streamerz", sni: "youtube.com", wg_private: "", wg_addr: "" },
]

let running = typeof window !== "undefined" && new URLSearchParams(window.location.search).get("vpn") === "1"
let rx = 0
let tx = 0
const started = Date.now()

const APPS = [
  "Discord", "Steam", "VALORANT", "Riot Client", "Google Chrome", "Firefox", "Opera GX",
  "Spotify", "Telegram", "WhatsApp", "Visual Studio Code", "OBS Studio", "Epic Games Launcher",
  "Battle.net", "League of Legends", "Minecraft Launcher", "Zoom", "Microsoft Teams", "Notepad++",
]

export async function mockCall<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  await new Promise((r) => setTimeout(r, 40))
  const ok = (msg = ""): CmdResult => ({ ok: true, msg })
  switch (cmd) {
    case "get_state":
      return { server_ip: "qc-speed.example.com", ssh_user: "ubuntu", ssh_port: 22, cards, version: "0.3.5" } as T
    case "probe_server":
      return ok("Server reachable.") as T
    case "generate_card": {
      const name = String(args?.name || "New card")
      const kind = String(args?.kind || "Gamerz")
      const sni = String(args?.sni || "")
      cards.push({ name, uuid: crypto.randomUUID(), card_type: kind, sni, wg_private: "", wg_addr: "" })
      return ok("Card created.") as T
    }
    case "revoke_card": {
      const i = cards.findIndex((c) => c.uuid === args?.uuid)
      if (i >= 0) cards.splice(i, 1)
      return ok("Card revoked.") as T
    }
    case "copy_card":
      return ok("Link copied.") as T
    case "set_card_sni": {
      const c = cards.find((x) => x.uuid === args?.uuid)
      if (c) c.sni = String(args?.sni || c.sni)
      return ok("Domain updated.") as T
    }
    case "tunnel_start":
      running = true
      return ok("Engine started.") as T
    case "tunnel_stop":
      running = false
      return ok("Engine stopped.") as T
    case "tunnel_status":
      return { running, error: "" } as TunnelState as T
    case "tunnel_traffic":
      if (running) {
        rx += 1_400_000 + Math.random() * 3_000_000
        tx += 180_000 + Math.random() * 900_000
      }
      return { rx, tx } as TrafficState as T
    case "tunnel_probe":
      return ok("Tunnel is up.") as T
    case "tunnel_log":
      return "[mock] engine log line\n[mock] tunnel up\n" as T
    case "tunnel_copy_log":
      return ok("Log copied.") as T
    case "import_card":
      return ok("Card added.") as T
    case "tunnel_apps":
      return JSON.stringify(APPS.map((label) => ({ pkg: label.toLowerCase().replace(/\s+/g, "") + ".exe", label }))) as T
    case "resolve_host":
      return "197.44.211.84" as T
    case "check_update": {
      // The "update ready" reminder appears only when asked for (?upd=1);
      // the real check reports available only when GitHub says so.
      const wantUpd = typeof window !== "undefined" && new URLSearchParams(window.location.search).get("upd") === "1"
      return { current: "0.3.5", latest: "0.3.6", available: wantUpd, url: "#", notes: "Hotfix: Valorant voice audio" } as UpdateInfo as T
    }
    case "apply_update":
      return "Up to date." as T
    default:
      return ok() as T
  }
}

export const mockElapsed = () => Math.round((Date.now() - started) / 1000)
