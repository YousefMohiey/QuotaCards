import { useEffect, useRef, useState } from "react"
import { ChevronDown, Copy, Play, RotateCcw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { PickerDialog, type PickerItem } from "@/components/PickerDialog"
import { SpeedRing, type RunPhase } from "@/components/SpeedRing"
import { useApp } from "@/state/app"
import { useI18n } from "@/lib/i18n"
import { measureDownload, measurePing, measureUpload } from "@/lib/speedtest"
import { CUSTOM_SNI, SNIS } from "@/lib/snis"
import { cn } from "@/lib/utils"

const PING_PROBES = 8
const PHASE_SECONDS = 9

type Result = { ping: number | null; jitter: number | null; down: number | null; up: number | null }

const EMPTY: Result = { ping: null, jitter: null, down: null, up: null }

export function Speed() {
  const { t } = useI18n()
  const { serverIp, card } = useApp()

  const [phase, setPhase] = useState<RunPhase>("idle")
  const [caption, setCaption] = useState(() => t("idle"))
  const [value, setValue] = useState(0)
  const [unit, setUnit] = useState<"Mbps" | "ms">("Mbps")
  const [progress, setProgress] = useState(0)
  const [result, setResult] = useState<Result>(EMPTY)
  const [hint, setHint] = useState("")
  const [target, setTarget] = useState("")
  const [custom, setCustom] = useState("")
  const [customOpen, setCustomOpen] = useState(false)
  const [pickOpen, setPickOpen] = useState(false)

  const abort = useRef<AbortController | null>(null)
  const gate = useRef(0)
  const phaseStart = useRef(0)

  const running = phase === "ping" || phase === "download" || phase === "upload"
  const kind = card?.card_type === "Streamerz" ? "Streamerz" : "Gamerz"
  const targetHost = custom.trim() || (target || serverIp)
  const targetLabel = custom.trim() || target || serverIp || t("targetServer")

  // A different card is a different path: the old numbers would be lies.
  useEffect(() => {
    setResult(EMPTY)
    setValue(0)
    setProgress(0)
    setCaption(t("idle"))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [card?.uuid])

  useEffect(() => {
    // Leaving the screen mid-test must not leave sockets running.
    return () => abort.current?.abort()
  }, [])

  const say = (v: number, isMs: boolean, force = false) => {
    const now = performance.now()
    if (!force && now - gate.current < 100) return
    gate.current = now
    setValue(v)
    if (!isMs) setProgress(Math.min((now - phaseStart.current) / (PHASE_SECONDS * 1000), 1))
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
    setProgress(0)
    setHint(t("pingHint"))
    let seen = 0
    try {
      const r = await measurePing(host, PING_PROBES, {
        signal,
        target: targetHost,
        onPing: (ms) => {
          seen += 1
          setProgress(Math.min(seen / PING_PROBES, 1))
          say(ms, true, seen >= PING_PROBES)
        },
      })
      setResult((prev) => ({ ...prev, ping: r.ping, jitter: r.jitter }))
      say(r.ping, true, true)
      setProgress(1)
    } catch {
      if (!signal.aborted) setHint(t("noReply"))
    }
  }

  const runThroughput = async (direction: "down" | "up", host: string, signal: AbortSignal) => {
    setPhase(direction === "down" ? "download" : "upload")
    setCaption(direction === "down" ? t("chDown") : t("chUp"))
    setUnit("Mbps")
    setValue(0)
    setProgress(0)
    phaseStart.current = performance.now()
    setHint(direction === "down" ? t("downHint") : t("upHint"))
    try {
      const fn = direction === "down" ? measureDownload : measureUpload
      const mbps = await fn(host, { seconds: PHASE_SECONDS, signal, onTick: (v) => say(v, false) })
      setResult((prev) => (direction === "down" ? { ...prev, down: mbps } : { ...prev, up: mbps }))
      say(mbps, false, true)
      setProgress(1)
    } catch {
      if (!signal.aborted) setHint(t("noReply"))
    }
  }

  const run = async (which: "all" | "ping" | "down" | "up") => {
    const host = guard()
    if (!host || running) return
    abort.current?.abort()
    const ctl = new AbortController()
    abort.current = ctl
    const s = ctl.signal
    if (which === "all" || which === "ping") {
      await runPing(host, s)
      if (s.aborted) return
    }
    if (which === "all" || which === "down") {
      await runThroughput("down", host, s)
      if (s.aborted) return
    }
    if (which === "all" || which === "up") {
      await runThroughput("up", host, s)
      if (s.aborted) return
    }
    setPhase("done")
  }

  const reset = () => {
    abort.current?.abort()
    setResult(EMPTY)
    setValue(0)
    setProgress(0)
    setPhase("idle")
    setCaption(t("idle"))
    setHint("")
  }

  const copyResult = async () => {
    const bits = [
      `Ping ${result.ping ?? "-"} ms`,
      `Jitter ${result.jitter ?? "-"} ms`,
      `Down ${result.down !== null ? result.down.toFixed(1) : "-"} Mbps`,
      `Up ${result.up !== null ? result.up.toFixed(1) : "-"} Mbps`,
      targetHost ? `Target ${targetLabel}` : "",
      card ? `Card ${card.name.split(" (")[0]} (${card.sni})` : "",
    ].filter(Boolean)
    try {
      await navigator.clipboard.writeText(bits.join(" | "))
      setHint(t("copied"))
    } catch {
      setHint(bits.join(" | "))
    }
  }

  const items: PickerItem[] = [
    { value: "", label: t("targetServer"), sub: serverIp },
    ...SNIS[kind].map(([name, domain]) => ({ value: domain, label: name, sub: domain })),
    { value: CUSTOM_SNI, label: t("targetCustom") },
  ]

  const measured = result.ping !== null || result.down !== null || result.up !== null

  return (
    <div className="mx-auto flex w-full max-w-[600px] flex-col gap-5">
      <section className="glass rounded-[24px] px-6 pb-5 pt-5">
        <div className="flex items-center justify-between gap-3">
          <div className="text-[13px] font-semibold text-txt">{t("tabSpeed")}</div>
          <button
            type="button"
            onClick={() => setPickOpen(true)}
            className="flex max-w-[62%] items-center gap-1.5 rounded-full border border-[rgb(255_255_255/0.12)] px-2.5 py-1 text-[12px] text-txt3 transition-colors hover:text-txt"
          >
            <span className="truncate">{targetLabel}</span>
            <ChevronDown className="size-3.5 shrink-0" aria-hidden />
          </button>
        </div>

        <div className="mt-2 flex justify-center">
          <SpeedRing value={value} unit={unit} phase={phase} caption={caption} progress={progress} />
        </div>

        {/* the reading, as four plain numbers; each one restarts its own phase */}
        <div className="mt-4 grid grid-cols-4 divide-x divide-line">
          <Reading title={t("pingTitle")} value={result.ping} unit={t("ms")} onClick={() => void run("ping")} disabled={running} />
          <Reading
            title={t("jitter")}
            value={result.jitter}
            unit={t("ms")}
            onClick={() => void run("ping")}
            disabled={running}
          />
          <Reading
            title={t("chDown")}
            value={result.down}
            unit={t("mbps")}
            onClick={() => void run("down")}
            disabled={running}
          />
          <Reading title={t("chUp")} value={result.up} unit={t("mbps")} onClick={() => void run("up")} disabled={running} />
        </div>
      </section>

      <div className="flex items-center gap-3">
        <Button
          className="h-11 flex-1 gap-2 rounded-[14px] text-[13.5px]"
          disabled={running}
          onClick={() => void run("all")}
        >
          <Play className="size-3.5" aria-hidden />
          {running ? t("measuring") : t("startTest")}
        </Button>
        <Button
          variant="secondary"
          className="h-11 gap-2 rounded-[14px] px-4 text-[13px]"
          onClick={() => void copyResult()}
          disabled={!measured}
        >
          <Copy className="size-3.5" aria-hidden />
          {t("copyResult")}
        </Button>
        {measured && (
          <Button variant="ghost" className="h-11 gap-2 rounded-[14px] px-3 text-[13px]" onClick={reset}>
            <RotateCcw className="size-3.5" aria-hidden />
            {t("clear")}
          </Button>
        )}
      </div>

      <p aria-live="polite" className="min-h-[18px] px-1 text-[12px] text-txt3">
        {hint || t("speedIdle")}
      </p>

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

      <div className="mx-1 flex items-start justify-between border-t border-line px-1 pb-2 pt-3">
        <div>
          <div className="text-[14px] font-medium text-txt">{serverIp || "—"}</div>
          <div className="mt-1 text-[12px] text-txt3">
            {measured ? `↓ ${result.down !== null ? result.down.toFixed(1) : "—"} · ↑ ${result.up !== null ? result.up.toFixed(1) : "—"} ${t("mbps")}` : "—"}
          </div>
        </div>
        <div className="flex flex-col items-end">
          <div className="text-[13px] font-medium text-txt">{card?.name.split(" (")[0] ?? "—"}</div>
          <div className="text-[12px] text-txt3">{card?.sni ?? "—"}</div>
        </div>
      </div>

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
      className={cn(
        "flex flex-col items-center gap-1 py-1.5 transition-colors",
        !disabled && "hover:bg-white/[0.03]",
      )}
    >
      <span className="text-[11.5px] text-txt3">{title}</span>
      <span className={cn("text-[18px] font-medium tabular-nums", value === null ? "text-txt3" : "text-txt")}>
        {value === null ? "—" : unit === "ms" ? Math.round(value) : value.toFixed(1)}
      </span>
      <span className="text-[11px] text-txt3">{unit}</span>
    </button>
  )
}
