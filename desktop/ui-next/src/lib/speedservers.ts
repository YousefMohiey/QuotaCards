/**
 * The server pool, the way a speed test treats it: gather real test servers,
 * measure the nearest, run against that.
 *
 * Three sources, in order:
 *  - Ookla's public list, the same one speedtest.net and its CLI select from.
 *    It is ranked by distance from the caller's own address and includes
 *    servers hosted inside providers, which is why the reading matches what
 *    the website shows.
 *  - Cloudflare's endpoint, always in the pool (anycast, so it is also a
 *    nearest-edge measurement).
 *  - The LibreSpeed public list as a last resort.
 *
 * The list endpoints send no CORS headers, so in the app both come through
 * the Rust `speed_servers` command; the browser preview falls back to a small
 * verified set so it still behaves.
 */
import { CF_PING_URL, CF_UP_URL } from "./speedtest"
import { isTauri, speedLatency, speedServers } from "./ipc"

export type SpeedServer = {
  id: string
  label: string
  detail: string
  host: string
  ping: string
  /** Requests are cycled through these; the backend cache-busts each one. */
  downUrls: string[]
  up: string
}

export const CLOUDFLARE: SpeedServer = {
  id: "cloudflare",
  label: "Cloudflare",
  detail: "Cloudflare, Inc.",
  host: "speed.cloudflare.com",
  ping: CF_PING_URL,
  downUrls: ["https://speed.cloudflare.com/__down?bytes=52428800"],
  up: CF_UP_URL,
}

type OoklaEntry = {
  url?: string
  name?: string
  sponsor?: string
  country?: string
  distance?: number
  host?: string
  https_functional?: number
}

type LibreEntry = {
  name?: string
  server?: string
  dlURL?: string
  ulURL?: string
  pingURL?: string
  sponsorName?: string
}

/** Servers behind the school/lab networks of the LibreSpeed project. Only the
 *  browser preview uses these; in the app the live list arrives via Rust. */
const LIBRE_FALLBACK: LibreEntry[] = [
  { name: "Frankfurt, Germany (Clouvider)", server: "https://fra.speedtest.clouvider.net/backend", dlURL: "garbage.php", ulURL: "empty.php", pingURL: "empty.php", sponsorName: "Clouvider" },
  { name: "Prague, Czech Republic (Turris)", server: "https://librespeed.turris.cz", dlURL: "backend/garbage.php", ulURL: "backend/empty.php", pingURL: "backend/empty.php", sponsorName: "Turris" },
  { name: "Roma, Italy (GARR)", server: "https://st-be-rm2.infra.garr.it", dlURL: "garbage.php", ulURL: "empty.php", pingURL: "empty.php", sponsorName: "Consortium GARR" },
]

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : ""
}

function join(base: string, path: string): string {
  return `${base.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`
}

function displayHost(base: string): string {
  try {
    return new URL(base).host
  } catch {
    return base
  }
}

function fromOokla(e: OoklaEntry): SpeedServer | null {
  const raw = str(e.url)
  if (!raw) return null
  // The entry points at upload.php; the base carries latency.txt, the
  // random*jpg downloads and the upload endpoint.
  const base = raw.replace(/\/upload\.php.*$/i, "").replace(/\/+$/, "")
  if (!base) return null
  const sponsor = str(e.sponsor)
  const place = str(e.name)
  const km = typeof e.distance === "number" ? Math.round(e.distance) : null
  const country = str(e.country)
  return {
    id: `ookla-${str(e.host) || base}`,
    label: [sponsor, place].filter(Boolean).join(" · ") || displayHost(base),
    detail: [country, km !== null ? `${km} km` : ""].filter(Boolean).join(" · "),
    host: displayHost(base),
    ping: `${base}/latency.txt`,
    downUrls: [`${base}/random2000x2000.jpg`],
    up: `${base}/upload.php`,
  }
}

function fromLibre(e: LibreEntry): SpeedServer | null {
  const base = str(e.server)
  if (!base || !e.dlURL || !e.ulURL || !e.pingURL) return null
  const whole = str(e.name) || displayHost(base)
  const label = whole.split(" (")[0].trim() || displayHost(base)
  const inName = /\(([^)]+)\)/.exec(whole)?.[1]
  return {
    id: `ls-${displayHost(base)}`,
    label,
    detail: (str(e.sponsorName) || inName || "").trim(),
    host: displayHost(base),
    ping: `${join(base, e.pingURL)}?cors=true`,
    downUrls: [`${join(base, e.dlURL)}?ckSize=50&cors=true`],
    up: `${join(base, e.ulURL)}?cors=true`,
  }
}

/** Ookla (nearest first), Cloudflare, then LibreSpeed. */
export async function loadPool(_signal: AbortSignal): Promise<SpeedServer[]> {
  let ookla: OoklaEntry[] | null = null
  let libre: LibreEntry[] | null = null
  if (isTauri()) {
    try {
      const raw = await speedServers()
      if (raw) {
        const parsed = JSON.parse(raw) as { ookla?: OoklaEntry[]; librespeed?: LibreEntry[] }
        if (Array.isArray(parsed.ookla)) ookla = parsed.ookla
        if (Array.isArray(parsed.librespeed)) libre = parsed.librespeed
      }
    } catch {
      /* fall through to the bundled set */
    }
  }
  const sortKm = (a: OoklaEntry, b: OoklaEntry) =>
    (a.distance ?? Number.MAX_SAFE_INTEGER) - (b.distance ?? Number.MAX_SAFE_INTEGER)

  const pool: SpeedServer[] = []
  for (const e of (ookla ?? []).slice().sort(sortKm)) {
    const s = fromOokla(e)
    if (s) pool.push(s)
  }
  pool.push(CLOUDFLARE)
  for (const e of libre ?? LIBRE_FALLBACK) {
    const s = fromLibre(e)
    if (s) pool.push(s)
  }
  return pool
}

async function rtt(url: string, outer: AbortSignal): Promise<number | null> {
  if (outer.aborted) return null
  const t0 = performance.now()
  try {
    // no-cors: enough to time a round trip against hosts that do not send
    // CORS headers, which is most of the public test servers.
    await fetch(url, { cache: "no-store", mode: "no-cors", signal: AbortSignal.timeout(3000) })
    return performance.now() - t0
  } catch {
    return null
  }
}

/**
 * Lowest round trip wins. In the app the probes run through the backend (a
 * webview cannot read most of these hosts); in the preview they run here.
 */
export async function pickFastest(pool: SpeedServer[], signal: AbortSignal): Promise<SpeedServer> {
  const candidates = pool.slice(0, 9)
  if (candidates.length <= 1) return pool[0] ?? CLOUDFLARE

  const scored: { s: SpeedServer; ms: number | null }[] = []
  if (isTauri()) {
    const probe = (s: SpeedServer) =>
      speedLatency(s.ping, 1)
        .then((ms) => (ms.length ? Math.min(...ms) : null))
        .catch(() => null)
    const all = await Promise.all(candidates.map(probe))
    candidates.forEach((s, i) => scored.push({ s, ms: all[i] }))
  } else {
    const all = await Promise.all(candidates.map((s) => rtt(s.ping, signal)))
    candidates.forEach((s, i) => scored.push({ s, ms: all[i] }))
  }

  let best = candidates[0]
  let bestMs = Number.POSITIVE_INFINITY
  for (const { s, ms } of scored) {
    if (ms !== null && ms < bestMs) {
      best = s
      bestMs = ms
    }
  }
  return best
}
