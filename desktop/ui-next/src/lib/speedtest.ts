/**
 * Real network measurement, modelled on LibreSpeed's client
 * (https://github.com/librespeed/speedtest): timed tiny requests for
 * latency + jitter, a rolling-window download that adapts its chunk size
 * while it ramps, and a streamed upload that grows between rounds.
 *
 * The endpoints are the ones the server already serves
 * (`/speed/down?bytes=N`, `/speed/up`), so whatever route the machine is
 * using - tunnel or bare - is the route being measured.
 */

const base = (host: string) => `https://${host}`

export type PingResult = { ping: number; jitter: number }

export type RunOpts = {
  seconds?: number
  onTick?: (mbps: number) => void
  onPing?: (ms: number) => void
  signal?: AbortSignal
  /** What the ping should measure against, on top of the server host itself. */
  target?: string
  /** Direct probe URL, used by the public internet test. */
  pingUrl?: string
  /** Download URL builder, used by the public internet test. */
  downUrl?: (bytes: number) => string
  /** Upload URL, used by the public internet test. */
  upUrl?: string
}

const sim = () => typeof window !== "undefined" && !("__TAURI_INTERNALS__" in window)

/** True outside Tauri: measurements are simulated stand-ins. */
export function isSimEnv(): boolean {
  return sim()
}

/** Public Cloudflare speed endpoints for the real-internet test. */
export const CF_PING_URL = "https://speed.cloudflare.com/__down?bytes=10000"
export const cfDownUrl = (bytes: number) => `https://speed.cloudflare.com/__down?bytes=${bytes}`
export const CF_UP_URL = "https://speed.cloudflare.com/__up"

export async function measurePing(host: string, count = 8, opts: RunOpts = {}): Promise<PingResult> {
  if (sim()) {
    const ping = 38 + Math.random() * 12
    for (let i = 0; i < count; i++) {
      await sleep(120)
      opts.onPing?.(ping + (Math.random() - 0.5) * 8)
    }
    return { ping: Math.round(ping), jitter: 2 + Math.random() * 2 }
  }
  const samples: number[] = []
  // A direct probe URL measures a fixed public endpoint (the internet
  // test). Otherwise pinging the server itself goes through its own tiny
  // endpoint, and any other target is an opaque cross-origin probe: the
  // reply is unreadable but the round trip is real, and it travels the
  // same route as everything else.
  const bare = !opts.pingUrl && opts.target && opts.target !== host && opts.target !== ""
  for (let i = 0; i < count; i++) {
    if (opts.signal?.aborted) break
    let url: string
    let mode: RequestMode
    if (opts.pingUrl) {
      url = `${opts.pingUrl}${opts.pingUrl.includes("?") ? "&" : "?"}r=${Math.random()}`
      mode = "no-cors"
    } else if (bare) {
      url = `https://${opts.target}/?qc=${Math.random()}`
      mode = "no-cors"
    } else {
      url = `${base(host)}/speed/down?bytes=1&r=${Math.random()}`
      mode = "cors"
    }
    const t0 = performance.now()
    try {
      await fetch(url, { cache: "no-store", signal: opts.signal, mode })
      const dt = performance.now() - t0
      samples.push(dt)
      opts.onPing?.(dt)
    } catch {
      /* a dropped probe is not fatal, keep sampling */
    }
  }
  if (!samples.length) return { ping: 0, jitter: 0 }
  let diff = 0
  for (let i = 1; i < samples.length; i++) diff += Math.abs(samples[i] - samples[i - 1])
  return {
    ping: Math.round(Math.min(...samples)),
    jitter: samples.length > 1 ? Number((diff / (samples.length - 1)).toFixed(1)) : 0,
  }
}

export async function measureDownload(host: string, opts: RunOpts = {}): Promise<number> {
  const seconds = opts.seconds ?? 9
  if (sim()) return simulated("down", seconds, opts)
  const deadline = performance.now() + seconds * 1000
  // Cumulative bytes with their timestamps. The rate is
  // (bytes at the last sample - bytes at the first sample) / that time, and
  // never the sum of the chunks in the window: a chunk's bytes were on the
  // wire BEFORE the timestamp that records them, so summing them counts time
  // that is not in the denominator. On a fast link the window holds one big
  // chunk and that reads roughly double the real speed.
  const win: Array<[number, number]> = []
  let total = 0
  let chunk = 1 << 20
  let best = 0
  const dl = opts.downUrl ?? ((bytes: number) => `${base(host)}/speed/down?bytes=${bytes}&r=${Math.random()}`)
  while (performance.now() < deadline && !opts.signal?.aborted) {
    const t0 = performance.now()
    let got = 0
    try {
      const r = await fetch(dl(chunk), {
        cache: "no-store",
        signal: opts.signal,
      })
      got = (await r.arrayBuffer()).byteLength
    } catch (e) {
      if (opts.signal?.aborted) break
      throw e
    }
    const t1 = performance.now()
    if (!got) break
    total += got
    win.push([t1, total])
    while (win.length > 2 && t1 - win[0][0] > 1500) win.shift()
    const span = (t1 - win[0][0]) / 1000
    const bytes = win[win.length - 1][1] - win[0][1]
    // Below half a second the window is one chunk's tail and the number is
    // noise, so it reports nothing until there is a real interval to average.
    const speed = span >= 0.5 ? (bytes * 8) / span / 1e6 : 0
    if (speed > best) best = speed
    opts.onTick?.(speed)
    const dt = (t1 - t0) / 1000
    if (dt < 0.7 && chunk < 32 << 20) chunk = Math.min(chunk * 2, 32 << 20)
    else if (dt > 2.5 && chunk > 256 << 10) chunk = Math.max(chunk / 2, 256 << 10)
  }
  return best
}

export async function measureUpload(host: string, opts: RunOpts = {}): Promise<number> {
  const seconds = opts.seconds ?? 9
  if (sim()) return simulated("up", seconds, opts)
  const url = opts.upUrl ?? `${base(host)}/speed/up?r=${Math.random()}`
  const deadline = performance.now() + seconds * 1000
  let size = 4 << 20
  let best = 0
  while (performance.now() < deadline && !opts.signal?.aborted) {
    const round = performance.now()
    await uploadRound(url, size, (v) => {
      if (v > best) best = v
      opts.onTick?.(v)
    }, opts.signal)
    const dt = (performance.now() - round) / 1000
    if (dt < 1.2 && size < 64 << 20) size *= 2
  }
  return best
}

function uploadRound(
  url: string,
  size: number,
  onProgress: (mbps: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    // random data defeats any compression on the way up
    const body = new Uint8Array(size)
    for (let i = 0; i < size; i += 4096) body[i] = (Math.random() * 255) | 0
    // Same rolling window as the download: cumulative loaded bytes, at least
    // half a second of interval, so a single TCP window's burst cannot be
    // reported as the link's speed.
    const win: Array<[number, number]> = []
    xhr.upload.onprogress = (e) => {
      const now = performance.now()
      win.push([now, e.loaded])
      while (win.length > 2 && now - win[0][0] > 1500) win.shift()
      const span = (now - win[0][0]) / 1000
      if (span >= 0.5) onProgress(((e.loaded - win[0][1]) * 8) / span / 1e6)
    }
    xhr.onload = () => resolve()
    xhr.onerror = () => reject(new Error("upload failed"))
    xhr.onabort = () => reject(new Error("aborted"))
    signal?.addEventListener("abort", () => xhr.abort(), { once: true })
    xhr.open("POST", url)
    xhr.setRequestHeader("Content-Type", "application/octet-stream")
    xhr.send(body)
  })
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Preview/dev stand-in so the gauge can be seen without a live server. */
async function simulated(phase: "down" | "up", seconds: number, opts: RunOpts): Promise<number> {
  const peak = phase === "down" ? 240 + Math.random() * 40 : 34 + Math.random() * 8
  const steps = Math.round((seconds * 1000) / 120)
  let best = 0
  for (let i = 0; i < steps; i++) {
    if (opts.signal?.aborted) break
    const t = i / steps
    const value = peak * (1 - Math.exp(-6 * t)) * (1 - 0.08 * Math.sin(t * 22))
    if (value > best) best = value
    opts.onTick?.(value)
    await sleep(120)
  }
  return best
}
