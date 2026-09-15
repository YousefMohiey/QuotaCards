import { useEffect, useRef, useState } from "react"
import { ChevronDown, Gamepad2, Play, RotateCcw, Tv, Video } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { PickerDialog, type PickerItem } from "@/components/PickerDialog"
import { SpeedBars } from "@/components/SpeedBars"
import { useApp } from "@/state/app"
import { useI18n, type StrKey } from "@/lib/i18n"
import { measureDownload, measurePing, measureUpload } from "@/lib/speedtest"
import { CUSTOM_SNI, SNIS } from "@/lib/snis"
import { cn } from "@/lib/utils"

const PING_PROBES = 8
const PHASE_SECONDS = 9
const BARS_MEMORY = 96

type Phase = "idle" | "ping" | "download" | "upload" | "done"
type Result = { ping: number | null; jitter: number | null; down: number | null; up: number | null }
type Run = { at: number; ping: number | null; jitter: number | null; down: number | null; up: number | null }

const EMPTY: Result = { ping: null, jitter: null, down: null, up: null }

/** Public resolvers, the same names every speed test uses as fixed anchors. */
const PUBLIC: Array<[string, string]> = [
  ["Cloudflare", "1.1.1.1"],
  ["Google DNS", "dns.google"],
  ["Quad9", "dns.quad9.net"],
  ["OpenDNS", "opendns.com"],
]

function loadHistory(): Run[] {
  try {
    const raw = localStorage.getItem("qc-speed-history")
    const arr = raw ? (JSON.parse(raw) as Run[]) : []
    return Array.isArray(arr) ? arr.slice(0, 3) : []
  } catch {
    return []
  }
}

export function Speed() {
  const { t } = useI18n()
  const { serverIp, card } = useApp()

  const [phase, setPhase] = useState<Phase>("idle")
  const [caption, setCaption] = useState(() => t("idle"))
  const [value, setValue] = useState(0)
  const [unit, setUnit] = useState<"Mbps" | "ms">("Mbps")
  const [samples, setSamples] = useState<number[]>([])
  const [result, setResult] = useState<Result>(EMPTY)
  const [hint, setHint] = useState("")
  const [history, setHistory] = useState<Run[]>(() => loadHistory())
  const [target, setTarget] = useState("")
  const [custom, setCustom] = useState("")
  const [customOpen, setCustomOpen] = useState(false)
  const [pickOpen, setPickOpen] = useState(false)

  const abort = useRef<AbortController | null>(null)
  const gate = useRef(0)

  const running = phase === "ping" || phase === "download" || phase === "upload"
  const kind = card?.card_type === "Streamerz" ? "Streamerz" : "Gamerz"
  const targetHost = custom.trim() || (target || serverIp)
  const targetLabel = custom.trim() || target || serverIp || t("targetServer")

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

  const guard = (): string | null => {
    if (!serverIp) {
      setHint(t("needServer"))
      return null
    }
    if (!card) {
      setHint(t("needDomain"))
      return null
    }
    return serverIp
  }

  const runPing = async (host: string, signal: AbortSignal) => {
    setPhase("ping")
    setCaption(t("pingTitle"))
    setUnit("ms")
    setValue(0)
    setSamples([])
    setHint(t("pingHint"))
    try {
      const r = await measurePing(host, PING_PROBES, { signal, target: targetHost, onPing: (ms) => push(ms) })
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
      const mbps = await fn(host, { seconds: PHASE_SECONDS, signal, onTick: (v) => push(v) })
      setResult((prev) => (direction === "down" ? { ...prev, down: mbps } : { ...prev, up: mbps }))
      setValue(mbps)
      return mbps
    } catch {
      if (!signal.aborted) setHint(t("noReply"))
      return null
    }
  }

  const remember = (r: Result) => {
    if (r.ping === null && r.down === null && r.up === null) return
    const next = [{ at: Date.now(), ...r }, ...history].slice(0, 3)
    setHistory(next)
    try {
      localStorage.setItem("qc-speed-history", JSON.stringify(next))
    } catch {
      /* private mode: history just does not stick */
    }
  }

  const run = async (which: "all" | "ping" | "down" | "up") => {
    const host = guard()
    if (!host || running) return
    abort.current?.abort()
    const ctl = new AbortController()
    abort.current = ctl
    const s = ctl.signal
    const acc: Result = { ...result }
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
    remember(acc)
  }

  const reset = () => {
    abort.current?.abort()
    setResult(EMPTY)
    setValue(0)
    setSamples([])
    setPhase("idle")
    setCaption(t("idle"))
    setHint("")
  }

  const items: PickerItem[] = [
    { value: "", label: t("targetServer"), sub: serverIp },
    ...SNIS[kind].map(([name, domain]) => ({ value: domain, label: name, sub: domain })),
    ...PUBLIC.map(([name, domain]) => ({ value: domain, label: name, sub: domain })),
    { value: CUSTOM_SNI, label: t("targetCustom") },
  ]

  const measured = result.ping !== null || result.down !== null || result.up !== null
  const verdicts = buildVerdicts(result, t)
  const peak = samples.length ? Math.max(...samples) : 0

  return (
    <div className="mx-auto flex w-full max-w-[640px] flex-col gap-3.5">
      <section className="glass rounded-[24px] px-5 pb-4 pt-4">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="truncate text-[13px] font-semibold text-txt">{t("tabSpeed")}</div>
            <div className="mt-0.5 truncate text-[11.5px] text-txt3">
              {card?.name.split(" (")[0] ?? "—"} · {kind}
            </div>
          </div>
          <button
            type="button"
            onClick={() => setPickOpen(true)}
            className="flex max-w-[60%] items-center gap-1.5 rounded-full border border-[rgb(255_255_255/0.12)] px-2.5 py-1 text-[12px] text-txt3 transition-colors hover:text-txt"
          >
            <span className="truncate">{targetLabel}</span>
            <ChevronDown className="size-3.5 shrink-0" aria-hidden />
          </button>
        </div>

        <div className="mt-3 flex items-end justify-between gap-6">
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

        <div className="mt-3">
          <SpeedBars
            samples={samples}
            accent={phase === "upload" ? "var(--cyan)" : phase === "ping" ? "var(--amber)" : "var(--brand)"}
            active={running}
          />
        </div>

        <div className="mt-3 grid grid-cols-4 divide-x divide-line">
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
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-line pt-3">
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

      {/* last runs, one thin line, newest first */}
      {history.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-1 text-[11.5px] text-txt3">
          <span>{t("history")}</span>
          {history.map((h) => (
            <span key={h.at} className="tabular-nums">
              {new Date(h.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
              {" · "}
              {h.down !== null ? `${h.down.toFixed(0)}↓` : "—"}
              {" · "}
              {h.ping !== null ? `${Math.round(h.ping)}ms` : "—"}
            </span>
          ))}
        </div>
      )}

      {(hint || !measured) && (
        <p aria-live="polite" className="px-1 text-[12px] text-txt3">
          {hint || t("speedIdle")}
        </p>
      )}

      {customOpen && (
        <Input
          autoFocus
          value={custom}
          onChange={(e) => setCustom(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") setCustomOpen(false)
          }}
          placeholder="example.com"
          aria-label={t("targetCustom")}
          className="h-9 rounded-[12px] border-line bg-white/[0.02] text-[13px]"
        />
      )}

      <PickerDialog
        open={pickOpen}
        onOpenChange={setPickOpen}
        title={t("target")}
        search={t("searchTargets")}
        items={items}
        value={customOpen ? CUSTOM_SNI : target}
        onPick={(v) => {
          if (v === CUSTOM_SNI) {
            setCustomOpen(true)
            setTarget("")
            setCustom("")
            return
          }
          setCustomOpen(false)
          setCustom("")
          setTarget(v)
        }}
      />
    </div>
  )
}

type Verdict = { icon: typeof Gamepad2; label: string; tone: "ok" | "warn" | "bad"; text: string }

/**
 * Plain language instead of raw numbers: what the line can actually do.
 * Thresholds are the published practical ones - competitive play needs jitter
 * under ~10 ms, 1080p needs ~25 Mbps, 4K wants 50+.
 */
function buildVerdicts(r: Result, t: (k: StrKey) => string): Verdict[] {
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
        {value === null ? "—" : unit === "ms" ? Math.round(value) : value.toFixed(1)}
      </span>
      <span className="text-[11px] text-txt3">{unit}</span>
    </button>
  )
}
