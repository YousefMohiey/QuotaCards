/**
 * The server pool, the way a speed test treats it: ping the candidates and
 * run against the closest one instead of a single fixed endpoint.
 *
 * Cloudflare's endpoint is always in the pool (it is anycast, so it is the
 * nearest of Cloudflare's edge either way). The LibreSpeed public list adds
 * real per-host servers, several of them sitting on carrier and university
 * networks, which is what makes the reading comparable to what speedtest.net
 * shows: traffic that leaves your provider as late as possible.
 */
import { CF_PING_URL, CF_UP_URL, cfDownUrl } from "./speedtest"
import { isTauri, speedServers } from "./ipc"

export type SpeedServer = {
  id: string
  label: string
  detail: string
  host: string
  ping: string
  down: (bytes: number) => string
  up: string
}

export const CLOUDFLARE: SpeedServer = {
  id: "cloudflare",
  label: "Cloudflare",
  detail: "Cloudflare, Inc.",
  host: "speed.cloudflare.com",
  ping: CF_PING_URL,
  down: cfDownUrl,
  up: CF_UP_URL,
}

type ListEntry = {
  name?: string
  server?: string
  dlURL?: string
  ulURL?: string
  pingURL?: string
  sponsorName?: string
}

/** Verified hosts, used when the list cannot be read (the browser preview is
 *  stuck here: librespeed.org/backend-servers/servers.php has no CORS headers,
 *  so only the app, which can fetch it backend-side, gets the live set). */
const FALLBACK: ListEntry[] = [
  { name: "Frankfurt, Germany (Clouvider)", server: "https://fra.speedtest.clouvider.net/backend", dlURL: "garbage.php", ulURL: "empty.php", pingURL: "empty.php", sponsorName: "Clouvider" },
  { name: "Prague, Czech Republic (Turris)", server: "https://librespeed.turris.cz", dlURL: "backend/garbage.php", ulURL: "backend/empty.php", pingURL: "backend/empty.php", sponsorName: "Turris" },
  { name: "Frankfurt, Germany (FS IT-Systeme GmbH)", server: "https://speed.fs-it.systems/", dlURL: "backend/garbage.php", ulURL: "backend/empty.php", pingURL: "backend/empty.php", sponsorName: "FS IT-Systeme GmbH" },
  { name: "Roma, Italy (GARR)", server: "https://st-be-rm2.infra.garr.it", dlURL: "garbage.php", ulURL: "empty.php", pingURL: "empty.php", sponsorName: "Consortium GARR" },
]

function fromEntry(e: ListEntry): SpeedServer | null {
  const base = (e.server || "").trim()
  if (!base || !e.dlURL || !e.ulURL || !e.pingURL) return null
  const join = (path: string) => `${base.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`
  let host = base
  try {
    host = new URL(base).host
  } catch {
    /* keep the raw string */
  }
  const whole = e.name || host
  const label = whole.split(" (")[0].trim() || host
  const inName = /\(([^)]+)\)/.exec(whole)?.[1]
  return {
    id: `ls-${host}`,
    label,
    detail: (e.sponsorName || inName || "").trim(),
    host,
    ping: `${join(e.pingURL)}?cors=true`,
    down: (bytes) => {
      // LibreSpeed's backend takes the size in whole megabytes, 4 to 1024.
      const mb = Math.min(1024, Math.max(4, Math.ceil(bytes / 1e6)))
      return `${join(e.dlURL!)}?ckSize=${mb}&cors=true&r=${Math.random()}`
    },
    up: `${join(e.ulURL)}?cors=true`,
  }
}

/** Cloudflare plus every reachable server in the public list. */
export async function loadPool(_signal: AbortSignal): Promise<SpeedServer[]> {
  const pool: SpeedServer[] = [CLOUDFLARE]
  let list: ListEntry[] | null = null
  if (isTauri()) {
    try {
      const raw = await speedServers()
      if (raw) list = JSON.parse(raw) as ListEntry[]
    } catch {
      /* fall through to the bundled set */
    }
  }
  if (!Array.isArray(list)) list = FALLBACK
  for (const e of list) {
    const s = fromEntry(e)
    if (s) pool.push(s)
  }
  return pool
}

async function rtt(url: string, outer: AbortSignal): Promise<number | null> {
  if (outer.aborted) return null
  const t0 = performance.now()
  try {
    // One bounded probe per candidate. The caller's signal only gates the
    // start: AbortSignal.any is newer than some of the runtimes this ships
    // into, and a silent failure there would leave every candidate untried.
    await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(3000) })
    return performance.now() - t0
  } catch {
    return null
  }
}

/**
 * Lowest round trip wins. One probe each, in parallel, so the whole sweep
 * costs about one timeout at worst and the run starts with the nearest
 * responder rather than whichever endpoint was wired in.
 */
export async function pickFastest(pool: SpeedServer[], signal: AbortSignal): Promise<SpeedServer> {
  if (pool.length <= 1) return pool[0] ?? CLOUDFLARE
  const scored = await Promise.all(pool.map(async (s) => ({ s, ms: await rtt(s.ping, signal) })))
  let best = pool[0]
  let bestMs = Number.POSITIVE_INFINITY
  for (const { s, ms } of scored) {
    if (ms !== null && ms < bestMs) {
      best = s
      bestMs = ms
    }
  }
  return best
}
