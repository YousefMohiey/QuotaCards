import { useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { ChevronDown, ChevronRight, Gamepad2, Play, RotateCcw, Tv, Video } from "lucide-react"
import { Button } from "@/components/ui/button"
import { PickerDialog, type PickerItem } from "@/components/PickerDialog"
import { SpeedBars } from "@/components/SpeedBars"
import { useApp } from "@/state/app"
import { useI18n, type StrKey } from "@/lib/i18n"
import { measureDownload, measurePing, measureUpload, CF_PING_URL, CF_UP_URL, cfDownUrl, isSimEnv } from "@/lib/speedtest"
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

export function runUrls(server: TestServer, host: string): RunUrls {
  if (server === "own" && host) {
    const base = `https://${host}`
    return {
      ping: `${base}/speed/down?bytes=1&r=${Math.random()}`,
      down: (bytes: number) => `${base}/speed/down?bytes=${bytes}&r=${Math.random()}`,
      up: `${base}/speed/up?r=${Math.random()}`,
    }
  }
  return { ping: CF_PING_URL, down: cfDownUrl, up: CF_UP_URL }
}

/** Exit IP plus provider for the speed page. Both services are HTTPS and
    CORS-open; with the tunnel up this reports the server's address, which is
    what a speed test should show. Failure just means no provider line. */
async function resolveNetInfo(signal: AbortSignal): Promise<NetInfo | null> {
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
  const { card, serverIp } = useApp()

  const [phase, setPhase] = useState<Phase>("idle")
  const [caption, setCaption] = useState(() => t("idle"))
  const [value, setValue] = useState(0)
  const [unit, setUnit] = useState<"Mbps" | "ms">("Mbps")
  const [samples, setSamples] = useState<number[]>([])
  const [result, setResult] = useState<Result>(EMPTY)
  const [hint, setHint] = useState("")
  const [history, setHistory] = useState<Run[]>(() => loadHistory())
  const [netInfo, setNetInfo] = useState<NetInfo | null>(null)
  const [server, setServer] = useState<TestServer>("cloudflare")
  const [serverOpen, setServerOpen] = useState(false)

  const abort = useRef<AbortController | null>(null)
  const gate = useRef(0)

  const running = phase === "ping" || phase === "download" || phase === "upload"
  const kind = card?.card_type === "Streamerz" ? "Streamerz" : "Gamerz"
  const serverLabel = server === "own" ? serverIp || t("targetServer") : "Cloudflare"
  const urls = useMemo(() => runUrls(server, serverIp), [server, serverIp])

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

  const runPing = async (host: string, signal: AbortSignal) => {
    setPhase("ping")
    setCaption(t("pingTitle"))
    setUnit("ms")
    setValue(0)
    setSamples([])
    setHint(t("pingHint"))
    try {
      const r = await measurePing(host, PING_PROBES, {
        signal,
        pingUrl: urls.ping,
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

  const runThroughput = async (direction: "down" | "up", host: string, signal: AbortSignal) => {
    setPhase(direction === "down" ? "download" : "upload")
    setCaption(direction === "down" ? t("chDown") : t("chUp"))
    setUnit("Mbps")
    setValue(0)
    setSamples([])
    setHint(direction === "down" ? t("downHint") : t("upHint"))
    try {
      const fn = direction === "down" ? measureDownload : measureUpload
      const mbps = await fn(host, {
        seconds: PHASE_SECONDS,
        signal,
        onTick: (v) => push(v),
        ...(direction === "down" ? { downUrl: urls.down } : { upUrl: urls.up }),
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
    if (server === "own" && !serverIp) {
      setHint(t("needServer"))
      return
    }
    const host = server === "own" ? serverIp : "net"
    abort.current?.abort()
    const ctl = new AbortController()
    abort.current = ctl
    const s = ctl.signal
    const acc: Result = { ...result }
    const label = serverLabel
    setNetInfo(null)
    if (!isSimEnv()) {
      void resolveNetInfo(s).then((info) => {
        if (!s.aborted) setNetInfo(info)
      })
    }
    // Each phase reports back here so the history line reflects the run that
    // just happened, not whatever the tiles happened to hold before.
    if (which === "all" || which === "ping") {
      const p = await runPing(host, s)
      if (p) {
        acc.ping = p.ping
        acc.jitter = p.jitter
      }
      if (s.aborted) return
    }
    if (which === "all" || which === "down") {
      const d = await runThroughput("down", host, s)
      if (d !== null) acc.down = d
      if (s.aborted) return
    }
    if (which === "all" || which === "up") {
      const u = await runThroughput("up", host, s)
      if (u !== null) acc.up = u
      if (s.aborted) return
    }
    setPhase("done")
    remember(acc, label)
  }

  const reset = () => {
    abort.current?.abort()
    setResult(EMPTY)
    setValue(0)
    setSamples([])
    setPhase("idle")
    setCaption(t("idle"))
    setHint("")
    setNetInfo(null)
  }

  const measured = result.ping !== null || result.down !== null || result.up !== null
  const verdicts = buildVerdicts(result, t)
  const peak = samples.length ? Math.max(...samples) : 0
  const serverItems: PickerItem[] = [
    { value: "cloudflare", label: "Cloudflare", sub: t("srvPublic") },
    { value: "own", label: serverIp || t("targetServer"), sub: t("srvOwnNote") },
  ]

  return (
    <div className="mx-auto flex w-full max-w-[640px] flex-col gap-3">
      <section className="glass rounded-[24px] px-5 pb-3 pt-3">
        <div className="min-w-0">
          <div className="truncate text-[13px] font-semibold text-txt">{t("tabSpeed")}</div>
          <div className="mt-0.5 truncate text-[11.5px] text-txt3" dir="auto">
            <bdi>{card?.name.split(" (")[0] ?? "-"}</bdi> · <bdi>{kind === "Streamerz" ? t("kindStreamerz") : t("kindGamerz")}</bdi>
          </div>
        </div>
        {netInfo && (
          <div className="mt-1.5 space-y-0.5 text-[11px] text-txt3">
            <div className="truncate">
              {t("yourIp")}:{" "}
              <span className="text-txt2">
                <bdi>{netInfo.ip}</bdi>
                {netInfo.isp ? <> · <bdi>{netInfo.isp}</bdi></> : null}
                {netInfo.place ? <> · <bdi>{netInfo.place}</bdi></> : null}
              </span>
            </div>
          </div>
        )}
        <button
          type="button"
          onClick={() => setServerOpen(true)}
          className="mt-1 flex items-center gap-1.5 text-[11px] text-txt3 transition-colors duration-150 hover:text-txt2"
        >
          {t("serverLabel")}: <span className="text-txt2">{serverLabel}</span>
          <ChevronDown className="size-3 shrink-0" aria-hidden />
        </button>

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
            accent={phase === "upload" ? "var(--cyan)" : phase === "ping" ? "var(--amber)" : "var(--brand)"}
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
        {measured && (
          <Button variant="ghost" className="h-11 gap-2 rounded-[14px] px-3.5 text-[13px]" onClick={reset}>
            <RotateCcw className="size-3.5" aria-hidden />
            {t("clear")}
          </Button>
        )}
      </div>

      {/* last run at a glance; the full history lives on its own page */}
      {history.length > 0 && (
        <button
          type="button"
          onClick={onOpenHistory}
          className="glass group w-full rounded-[20px] px-4 py-2.5 text-start transition-colors"
        >
          <div className="flex items-center justify-between gap-2">
            <div className="text-[11px] font-medium tracking-[0.08em] text-txt3 uppercase">
              {t("history")}
              <span className="ms-2 font-normal tabular-nums">{history.length}</span>
            </div>
            <span className="flex shrink-0 items-center gap-1 text-[12px] text-txt3 transition-colors group-hover:text-brand-strong">
              {t("histOpen")}
              <ChevronRight
                className="size-3.5 transition-transform duration-200 group-hover:translate-x-0.5"
                aria-hidden
              />
            </span>
          </div>
          <div className="mt-1">
            <HistoryRow h={history[0]} />
          </div>
        </button>
      )}

      {(hint || !measured) && (
        <p aria-live="polite" className="px-1 text-[12px] text-txt3">
          {hint || t("speedIdle")}
        </p>
      )}

      {/* pick the server the run measures against, the way a speed test does */}
      <PickerDialog
        open={serverOpen}
        onOpenChange={setServerOpen}
        title={t("pickServer")}
        search={t("searchList")}
        items={serverItems}
        value={server}
        onPick={(v) => setServer(v as TestServer)}
      />
    </div>
  )
}

type Verdict = { icon: typeof Gamepad2; label: string; tone: "ok" | "warn" | "bad"; text: string }

/** One stored run: date plus target on top, then the numbers as mini
    readings echoing the main block. Pane-less content: the history page wraps
    each run in glass, the Speed summary card embeds it in its own pane. */
export function HistoryRow({ h, trailing }: { h: Run; trailing?: ReactNode }) {
  const { t } = useI18n()
  const cells = [
    { key: "ping", title: t("pingTitle"), text: h.ping !== null ? String(Math.round(h.ping)) : "-", unit: t("ms"), show: true, empty: h.ping === null },
    { key: "down", title: t("chDown"), text: h.down !== null ? h.down.toFixed(0) : "-", unit: t("mbps"), show: true, empty: h.down === null },
    { key: "up", title: t("chUp"), text: h.up !== null ? h.up.toFixed(0) : "-", unit: t("mbps"), show: true, empty: h.up === null },
    { key: "jitter", title: t("jitter"), text: h.jitter !== null ? String(Math.round(h.jitter)) : "-", unit: t("ms"), show: h.jitter !== null, empty: false },
  ]
  const shown = cells.filter((c) => c.show)
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <span className="shrink-0 text-[11.5px] tabular-nums text-txt3">
          {new Date(h.at).toLocaleDateString([], { month: "short", day: "numeric" })}
          {" "}
          {new Date(h.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
        </span>
        <span className="min-w-0 flex-1 truncate text-end text-[12.5px] text-txt2" dir="auto">
          {h.target || t("targetServer")}
        </span>
        {trailing}
      </div>
      <div className={cn("mt-2 grid divide-x divide-line", shown.length > 3 ? "grid-cols-4" : "grid-cols-3")}>
        {shown.map((c) => (
          <div key={c.key} className="flex flex-col items-center gap-0.5 py-0.5">
            <span className="text-[10.5px] text-txt3">{c.title}</span>
            <span className={cn("text-[15px] font-medium tabular-nums", c.empty ? "text-txt3" : "text-txt")}>
              {c.text}
            </span>
            <span className="text-[10px] text-txt3">{c.unit}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

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
