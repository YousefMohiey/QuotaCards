import { useEffect, useRef, useState } from "react"
import { ChevronRight, Gamepad2, History, Play, Square, Tv, Video } from "lucide-react"
import { Button } from "@/components/ui/button"
import { SpeedBars } from "@/components/SpeedBars"
import { useApp } from "@/state/app"
import { useI18n, type StrKey } from "@/lib/i18n"
import { measureDownload, measurePing, measureUpload } from "@/lib/speedtest"
import { CLOUDFLARE, loadPool, pickFastest, type SpeedServer } from "@/lib/speedservers"
import { isTauri, netInfo } from "@/lib/ipc"
import { cn } from "@/lib/utils"

const PING_PROBES = 8
const PHASE_SECONDS = 9
const BARS_MEMORY = 96

type Phase = "idle" | "ping" | "download" | "upload" | "done"
type Result = { ping: number | null; jitter: number | null; down: number | null; up: number | null }
export type Run = { at: number; ping: number | null; jitter: number | null; down: number | null; up: number | null; target: string }
/** A history page is only useful if it keeps more than a handful, so the
    store holds a long list (the old inline strip capped it at 3). */
const HISTORY_MAX = 100
type NetInfo = { ip: string; isp: string; place: string }

const EMPTY: Result = { ping: null, jitter: null, down: null, up: null }

export function loadHistory(): Run[] {
  try {
    const raw = localStorage.getItem("qc-speed-history")
    const arr = raw ? (JSON.parse(raw) as Array<Partial<Run>>) : []
    if (!Array.isArray(arr)) return []
    return arr
      .filter((h) => h && typeof h === "object")
      .map((h) => ({
        at: typeof h.at === "number" ? h.at : Date.now(),
        ping: typeof h.ping === "number" ? h.ping : null,
        jitter: typeof h.jitter === "number" ? h.jitter : null,
        down: typeof h.down === "number" ? h.down : null,
        up: typeof h.up === "number" ? h.up : null,
        target: typeof h.target === "string" ? h.target : "",
      }))
      .slice(0, HISTORY_MAX)
  } catch {
    return []
  }
}

/** Where a run measures against. Cloudflare's speed endpoints are the public
    reference (that is the site's own API, CORS-open); the QuotaCards server
    option measures the card's own path through the tunnel. */
export type TestServer = "cloudflare" | "own"

export type RunUrls = {
  ping: string
  down: (bytes: number) => string
  up: string
}

/** Exit IP plus provider for the speed page. Both services are HTTPS and
    CORS-open; with the tunnel up this reports the server's address, which is
    what a speed test should show. Failure just means no provider line. */
async function resolveNetInfo(signal: AbortSignal): Promise<NetInfo | null> {
  // In the app the backend resolves this first: the webview is at the mercy
  // of whatever the host network or a policy does to these JSON APIs, the
  // Rust client is not. Whatever it returns wins; otherwise fall through to
  // the browser chain so the preview still shows something real.
  if (isTauri()) {
    try {
      const r = await netInfo()
      if (r && r.ip) return r
    } catch {
      /* keep going */
    }
  }
  const timeout = AbortSignal.timeout(8000)
  try {
    const r = await fetch("https://ipwho.is/", { signal: timeout, cache: "no-store" })
    if (r.ok) {
      const d = await r.json()
      if (d && d.success !== false && typeof d.ip === "string" && d.ip) {
        const isp = String(d.connection?.isp || d.connection?.org || "")
        const place = [d.city, d.country].filter(Boolean).join(", ")
        return { ip: d.ip, isp, place }
      }
    }
  } catch {
    /* try the next one */
  }
  try {
    const r = await fetch("https://ipapi.co/json/", { signal: timeout, cache: "no-store" })
    if (r.ok) {
      const d = await r.json()
      if (d && typeof d.ip === "string" && d.ip) {
        return {
          ip: d.ip,
          isp: String(d.org || ""),
          place: [d.city, d.country_name].filter(Boolean).join(", "),
        }
      }
    }
  } catch {
    /* no provider line then */
  }
  if (signal.aborted) return null
  return null
}

export function saveHistory(runs: Run[]) {
  try {
    localStorage.setItem("qc-speed-history", JSON.stringify(runs.slice(0, HISTORY_MAX)))
  } catch {
    /* private mode: history just does not stick */
  }
}

export function Speed({ onOpenHistory }: { onOpenHistory: () => void }) {
  const { t } = useI18n()
  const { card } = useApp()

  const [phase, setPhase] = useState<Phase>("idle")
  const [caption, setCaption] = useState(() => t("idle"))
  const [value, setValue] = useState(0)
  const [unit, setUnit] = useState<"Mbps" | "ms">("Mbps")
  const [samples, setSamples] = useState<number[]>([])
  const [result, setResult] = useState<Result>(EMPTY)
  const [hint, setHint] = useState("")
  const [history, setHistory] = useState<Run[]>(() => loadHistory())
  const [netInfo, setNetInfo] = useState<NetInfo | null>(null)
  const [pool, setPool] = useState<SpeedServer[]>([CLOUDFLARE])
  const [picked, setPicked] = useState<SpeedServer | null>(null)

  const abort = useRef<AbortController | null>(null)
  const gate = useRef(0)

  const running = phase === "ping" || phase === "download" || phase === "upload"
  const kind = card?.card_type === "Streamerz" ? "Streamerz" : "Gamerz"
  // Which server the run goes to. Loaded on arrival and picked by round trip,
  // like a speed test does, so the reading uses the nearest host instead of a
  // fixed one; Cloudflare stays in the pool as the always-available entry.
  useEffect(() => {
    const ctl = new AbortController()
    void loadPool(ctl.signal).then(async (pool) => {
      if (ctl.signal.aborted) return
      setPool(pool)
      const best = await pickFastest(pool, ctl.signal)
      if (!ctl.signal.aborted) setPicked(best)
    })
    return () => ctl.abort()
  }, [])

  // The exit address, resolved on arrival so the facts are on screen before a
  // run, not only after one. A failed lookup gets one quiet retry: the first
  // request after launch can race the network stack coming up.
  useEffect(() => {
    const ctl = new AbortController()
    let retry: number | undefined
    const look = (first: boolean) =>
      void resolveNetInfo(ctl.signal).then((info) => {
        if (ctl.signal.aborted) return
        if (info) setNetInfo(info)
        else if (first) retry = window.setTimeout(() => look(false), 4000)
      })
    look(true)
    return () => {
      ctl.abort()
      if (retry) window.clearTimeout(retry)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [card?.uuid])

  useEffect(() => {
    setResult(EMPTY)
    setValue(0)
    setSamples([])
    setCaption(t("idle"))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [card?.uuid])

  useEffect(() => () => abort.current?.abort(), [])

  const push = (v: number) => {
    const now = performance.now()
    if (now - gate.current < 90) return
    gate.current = now
    setValue(v)
    setSamples((prev) => [...prev.slice(-(BARS_MEMORY - 1)), v])
  }

  const runPing = async (srv: SpeedServer, signal: AbortSignal) => {
    setPhase("ping")
    setCaption(t("pingTitle"))
    setUnit("ms")
    setValue(0)
    setSamples([])
    setHint(t("pingHint"))
    try {
      const r = await measurePing("net", PING_PROBES, {
        signal,
        pingUrl: srv.ping,
        onPing: (ms) => push(ms),
      })
      setResult((prev) => ({ ...prev, ping: r.ping, jitter: r.jitter }))
      push(r.ping)
      setValue(r.ping)
      return r
    } catch {
      if (!signal.aborted) setHint(t("noReply"))
      return null
    }
  }

  const runThroughput = async (direction: "down" | "up", srv: SpeedServer, signal: AbortSignal) => {
    setPhase(direction === "down" ? "download" : "upload")
    setCaption(direction === "down" ? t("chDown") : t("chUp"))
    setUnit("Mbps")
    setValue(0)
    setSamples([])
    setHint(direction === "down" ? t("downHint") : t("upHint"))
    try {
      const fn = direction === "down" ? measureDownload : measureUpload
      const mbps = await fn("net", {
        seconds: PHASE_SECONDS,
        signal,
        onTick: (v) => push(v),
        ...(direction === "down" ? { downUrl: srv.down } : { upUrl: srv.up }),
      })
      setResult((prev) => (direction === "down" ? { ...prev, down: mbps } : { ...prev, up: mbps }))
      setValue(mbps)
      return mbps
    } catch {
      if (!signal.aborted) setHint(t("noReply"))
      return null
    }
  }

  const remember = (r: Result, label: string) => {
    if (r.ping === null && r.down === null && r.up === null) return
    const next = [{ at: Date.now(), ...r, target: label }, ...history].slice(0, HISTORY_MAX)
    setHistory(next)
    try {
      localStorage.setItem("qc-speed-history", JSON.stringify(next))
    } catch {
      /* private mode: history just does not stick */
    }
  }

  const run = async (which: "all" | "ping" | "down" | "up") => {
    if (running) return
    abort.current?.abort()
    const ctl = new AbortController()
    abort.current = ctl
    const s = ctl.signal
    const acc: Result = { ...result }

    // A run always has a server: if the arrival pick has not landed yet (slow
    // network, first second after launch), pick now rather than defaulting.
    let server = picked
    if (!server) {
      server = await pickFastest(pool, s)
      if (s.aborted) return
      setPicked(server)
    }
    const label = server.label

    setNetInfo(null)
    void resolveNetInfo(s).then((info) => {
      if (!s.aborted) setNetInfo(info)
    })
    // Each phase reports back here so the history line reflects the run that
    // just happened, not whatever the tiles happened to hold before.
    if (which === "all" || which === "ping") {
      const p = await runPing(server, s)
      if (p) {
        acc.ping = p.ping
        acc.jitter = p.jitter
      }
      if (s.aborted) return
    }
    if (which === "all" || which === "down") {
      const d = await runThroughput("down", server, s)
      if (d !== null) acc.down = d
      if (s.aborted) return
    }
    if (which === "all" || which === "up") {
      const u = await runThroughput("up", server, s)
      if (u !== null) acc.up = u
      if (s.aborted) return
    }
    setPhase("done")
    remember(acc, label)
  }

  const stop = () => {
    abort.current?.abort()
    setPhase("idle")
    setCaption(t("idle"))
    setHint(t("stopped"))
  }

  const measured = result.ping !== null || result.down !== null || result.up !== null
  const verdicts = buildVerdicts(result, t)
  const peak = samples.length ? Math.max(...samples) : 0

  return (
    <div className="mx-auto flex w-full max-w-[640px] flex-col gap-3">
      <section className="glass rounded-[24px] px-5 pb-3 pt-3">
        <div className="min-w-0">
          <div className="truncate text-[13px] font-semibold text-txt">{t("tabSpeed")}</div>
          <div className="mt-0.5 truncate text-[11.5px] text-txt3" dir="auto">
            <bdi>{card?.name.split(" (")[0] ?? "-"}</bdi> · <bdi>{kind === "Streamerz" ? t("kindStreamerz") : t("kindGamerz")}</bdi>
          </div>
        </div>

        {/* Both ends of the test, stated the way a speed test states them:
            who you are on the left, what is being measured against on the
            right. The provider is the headline, the address sits under it. */}
        <div className="mt-3 grid grid-cols-2 divide-x divide-line overflow-hidden rounded-[12px] border border-line">
          <div className="min-w-0 px-3.5 py-2.5">
            <div className="text-[10.5px] font-medium tracking-[0.08em] text-txt3 uppercase">
              {t("yourConn")}
            </div>
            <div className="mt-1 truncate text-[14.5px] font-semibold text-txt" dir="auto">
              {netInfo?.isp || netInfo?.ip || "-"}
            </div>
            <div className="mt-0.5 truncate text-[12px] tabular-nums text-txt2" dir="auto">
              {netInfo?.isp ? netInfo.ip : ""}
            </div>
            <div className="truncate text-[11.5px] text-txt3" dir="auto">
              {netInfo?.place ?? ""}
            </div>
          </div>
          <div className="min-w-0 px-3.5 py-2.5">
            <div className="text-[10.5px] font-medium tracking-[0.08em] text-txt3 uppercase">
              {t("targetServer")}
            </div>
            <div className="mt-1 truncate text-[14.5px] font-semibold text-txt" dir="auto">
              {(picked ?? CLOUDFLARE).label}
            </div>
            <div className="mt-0.5 truncate text-[12px] text-txt2" dir="auto">
              {(picked ?? CLOUDFLARE).host}
            </div>
            <div className="truncate text-[11.5px] text-txt3" dir="auto">
              {(picked ?? CLOUDFLARE).detail}
            </div>
          </div>
        </div>

        <div className="mt-2.5 flex items-end justify-between gap-6">
          <div className="min-w-0">
            <div className="flex items-baseline gap-2">
              <span className="text-[46px] leading-none font-light tabular-nums text-txt" style={{ letterSpacing: "-0.02em" }}>
                {unit === "ms" ? Math.round(value) : value >= 100 ? value.toFixed(0) : value.toFixed(1)}
              </span>
              <span className="text-[13px] text-txt3">{unit}</span>
            </div>
            <div className="mt-1.5 text-[12.5px] text-txt3">{caption}</div>
          </div>
          {samples.length > 0 && (
            <div className="text-[11px] text-txt3">
              {t("peak")} {unit === "ms" ? Math.round(peak) : peak.toFixed(1)} {unit}
            </div>
          )}
        </div>

        <div className="mt-2.5">
          <SpeedBars
            samples={samples}
            accent={phase === "upload" ? "var(--green)" : phase === "ping" ? "var(--amber)" : "var(--brand)"}
            active={running}
          />
        </div>

        <div className="mt-2.5 grid grid-cols-4 divide-x divide-line">
          <Reading title={t("pingTitle")} value={result.ping} unit={t("ms")} onClick={() => void run("ping")} disabled={running} />
          <Reading title={t("jitter")} value={result.jitter} unit={t("ms")} onClick={() => void run("ping")} disabled={running} />
          <Reading
            title={t("chDown")}
            value={phase === "download" ? value : result.down}
            unit={t("mbps")}
            onClick={() => void run("down")}
            disabled={running}
          />
          <Reading
            title={t("chUp")}
            value={phase === "upload" ? value : result.up}
            unit={t("mbps")}
            onClick={() => void run("up")}
            disabled={running}
          />
        </div>

        {/* what the numbers mean, in one row, inside the same pane */}
        {verdicts.length > 0 && (
          <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-line pt-2.5">
            {verdicts.map((v) => (
              <span key={v.label} className="flex items-center gap-2 text-[12px]">
                <v.icon className="size-3.5 shrink-0 text-txt3" strokeWidth={1.7} aria-hidden />
                <span
                  aria-hidden
                  className={cn(
                    "size-1.5 rounded-full",
                    v.tone === "ok" && "bg-[var(--green)]",
                    v.tone === "warn" && "bg-[var(--amber)]",
                    v.tone === "bad" && "bg-[var(--red)]",
                  )}
                />
                <span className="text-txt2">{v.text}</span>
              </span>
            ))}
          </div>
        )}
      </section>

      <div className="flex items-center gap-2.5">
        <Button className="h-11 flex-1 gap-2 rounded-[14px] text-[13.5px]" disabled={running} onClick={() => void run("all")}>
          <Play className="size-3.5" aria-hidden />
          {running ? t("measuring") : t("startTest")}
        </Button>
        {running && (
          <Button
            variant="ghost"
            className="h-11 gap-2 rounded-[14px] border border-line px-4 text-[13px] hover:border-line-strong"
            onClick={stop}
          >
            <Square className="size-3.5" aria-hidden />
            {t("stop")}
          </Button>
        )}
      </div>

      {/* the full history lives on its own page; this is the way in */}
      {history.length > 0 && (
        <button
          type="button"
          onClick={onOpenHistory}
          className="glass group flex w-full items-center justify-between gap-3 rounded-[16px] px-4 py-3 text-start transition-colors hover:border-line-strong"
        >
          <span className="flex min-w-0 items-center gap-2.5 text-[13px] text-txt2">
            <History className="size-4 shrink-0 text-txt3" strokeWidth={1.7} aria-hidden />
            <span className="truncate">{t("history")}</span>
            <span className="tabular-nums text-txt3">{history.length}</span>
          </span>
          <span className="flex shrink-0 items-center gap-1 text-[12px] text-txt3 transition-colors group-hover:text-brand-strong">
            {t("histOpen")}
            <ChevronRight
              className="size-4 transition-transform duration-200 group-hover:translate-x-0.5"
              aria-hidden
            />
          </span>
        </button>
      )}

      {(hint || !measured) && (
        <p aria-live="polite" className="px-1 text-[12px] text-txt3">
          {hint || t("speedIdle")}
        </p>
      )}
    </div>
  )
}

type Verdict = { icon: typeof Gamepad2; label: string; tone: "ok" | "warn" | "bad"; text: string }

/**
 * Plain language instead of raw numbers: what the line can actually do.
 * Thresholds are the published practical ones - competitive play needs jitter
 * under ~10 ms, 1080p needs ~25 Mbps, 4K wants 50+.
 */
export function buildVerdicts(r: Result, t: (k: StrKey) => string): Verdict[] {
  const { ping, jitter, down } = r
  const out: Verdict[] = []

  if (ping !== null && jitter !== null) {
    if (ping <= 45 && jitter <= 10) out.push({ icon: Gamepad2, label: t("vGaming"), tone: "ok", text: t("vCompReady") })
    else if (ping <= 80 && jitter <= 20) out.push({ icon: Gamepad2, label: t("vGaming"), tone: "warn", text: t("vCasual") })
    else out.push({ icon: Gamepad2, label: t("vGaming"), tone: "bad", text: t("vLag") })
  }

  if (down !== null) {
    if (down >= 50) out.push({ icon: Tv, label: t("vStreaming"), tone: "ok", text: t("v4k") })
    else if (down >= 25) out.push({ icon: Tv, label: t("vStreaming"), tone: "ok", text: t("v1080") })
    else if (down >= 12) out.push({ icon: Tv, label: t("vStreaming"), tone: "warn", text: t("v720") })
    else out.push({ icon: Tv, label: t("vStreaming"), tone: "bad", text: t("vSlow") })
  }

  if (ping !== null && jitter !== null) {
    if (jitter <= 15 && ping <= 80) out.push({ icon: Video, label: t("vCalls"), tone: "ok", text: t("vCallsOk") })
    else out.push({ icon: Video, label: t("vCalls"), tone: "warn", text: t("vCallsBad") })
  }

  return out
}

function Reading({
  title,
  value,
  unit,
  onClick,
  disabled,
}: {
  title: string
  value: number | null
  unit: string
  onClick: () => void
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={cn("flex flex-col items-center gap-0.5 py-1 transition-colors", !disabled && "hover:bg-white/[0.03]")}
    >
      <span className="text-[11.5px] text-txt3">{title}</span>
      <span className={cn("text-[17px] font-medium tabular-nums", value === null ? "text-txt3" : "text-txt")}>
        {value === null ? "-" : unit === "ms" ? Math.round(value) : value.toFixed(1)}
      </span>
      <span className="text-[11px] text-txt3">{unit}</span>
    </button>
  )
}
