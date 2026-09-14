/** Shared value formatting, ported from the 0.2.4 vanilla UI. */

export function fmtBytes(n: number): string {
  const v = Math.max(0, Math.floor(n))
  if (v < 1024) return v + " B"
  const units = ["KB", "MB", "GB"]
  let i = -1
  let x = v
  do {
    x /= 1024
    i++
  } while (x >= 1024 && i < units.length - 1)
  return (x >= 10 ? x.toFixed(0) : x.toFixed(1)) + " " + units[i]
}

export function fmtDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  const pad = (n: number) => String(n).padStart(2, "0")
  return h > 0 ? h + ":" + pad(m) + ":" + pad(sec) : pad(m) + ":" + pad(sec)
}

/**
 * The 0.2.4 build shows the server host as-is (masking was removed when the
 * hero slimmed down); keep the seam so a mask can be reintroduced in one place.
 */
export function displayHost(h?: string): string {
  if (!h) return "-"
  return h
}

export function mbps(v: number): string {
  if (!isFinite(v) || v <= 0) return "0"
  if (v >= 100) return v.toFixed(0)
  if (v >= 10) return v.toFixed(1)
  return v.toFixed(2)
}
