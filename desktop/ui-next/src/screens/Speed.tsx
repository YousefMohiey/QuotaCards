import { useEffect, useRef, useState } from "react"
import { ChevronDown, Copy, Globe, Play, Users } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { PickerDialog, type PickerItem } from "@/components/PickerDialog"
import { SpeedGauge, type GaugePhase } from "@/components/SpeedGauge"
import { useApp } from "@/state/app"
import { useI18n } from "@/lib/i18n"
import { measureDownload, measurePing, measureUpload } from "@/lib/speedtest"
import { CUSTOM_SNI, SNIS } from "@/lib/snis"
import { cn } from "@/lib/utils"

const CEILS_MS = [10, 20, 40, 60, 100, 160, 200, 300, 400, 600, 1000]
const CEILS_MB = [10, 20, 50, 100, 200, 300, 500, 750, 1000]

/** The first ceiling the number fits under, so quarter labels stay round. */
const pickCeil = (v: number, list: number[]) => list.find((c) => v <= c) ?? list[list.length - 1]

export function Speed() {
  const { t } = useI18n()
  const { serverIp, card } = useApp()
  const [phase, setPhase] = useState<GaugePhase>("idle")
  const [label, setLabel] = useState(() => t("idle"))
  const [value, setValue] = useState(0)
  const [unit, setUnit] = useState<"Mbps" | "ms">("Mbps")
  const [ceiling, setCeiling] = useState(100)
  const [ping, setPing] = useState<number | null>(null)
  const [jitter, setJitter] = useState<number | null>(null)
  const [down, setDown] = useState<number | null>(null)
  const [up, setUp] = useState<number | null>(null)
  const [hint, setHint] = useState("")
  const [target, setTarget] = useState("")
  const [custom, setCustom] = useState("")
  const [customOpen, setCustomOpen] = useState(false)
  const [pickOpen, setPickOpen] = useState(false)
  const abort = useRef<AbortController | null>(null)

  const running = phase === "ping" || phase === "download" || phase === "upload"
  const kind = card?.card_type === "Streamerz" ? "Streamerz" : "Gamerz"
  const targetHost = custom.trim() || (target || serverIp)
  // Show what will actually be pinged: the chosen domain, or the server itself.
  const targetLabel = custom.trim() || target || serverIp || t("targetServer")

  // A different card is a different path: old numbers would be lies.
  useEffect(() => {
    setPing(null)
    setJitter(null)
    setDown(null)
    setUp(null)
    setValue(0)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [card?.uuid])

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

  const lastLive = useRef(0)
  const live = (v: number, isMs: boolean, force = false) => {
    // Gauge updates are throttled: a progress event per chunk would re-render
    // the whole pane dozens of times a second and read as jitter. The final
    // value of a phase always lands, throttle or not.
    const now = performance.now()
    if (!force && now - lastLive.current < 110) return
    lastLive.current = now
    setValue(v)
    setCeiling((c) => {
      // Rescale only when the number is about to run off the dial; a rescale
      // mid sweep moves every label at once and looks like a glitch.
      if (v < c * 0.9) return c
      const want = pickCeil(v * 1.15, isMs ? CEILS_MS : CEILS_MB)
      return want > c ? want : c
    })
  }

  const runPing = async (host: string, signal: AbortSignal) => {
    setPhase("ping")
    setLabel(t("pingTitle"))
    setUnit("ms")
    setCeiling(100)
    setValue(0)
    setHint(t("pingHint"))
    try {
      const r = await measurePing(host, 8, {
        signal,
        target: targetHost,
        onPing: (ms) => live(ms, true),
      })
      setPing(r.ping)
      setJitter(r.jitter)
      live(r.ping, true, true)
      setCeiling(pickCeil(Math.max(r.ping, 8) * 1.15, CEILS_MS))
    } catch {
      if (!signal.aborted) setHint(t("noReply"))
    }
  }

  const runThroughput = async (direction: "down" | "up", host: string, signal: AbortSignal) => {
    setPhase(direction === "down" ? "download" : "upload")
    setLabel(direction === "down" ? t("chDown") : t("chUp"))
    setUnit("Mbps")
    setCeiling(100)
    setValue(0)
    setHint(direction === "down" ? t("downHint") : t("upHint"))
    try {
      const fn = direction === "down" ? measureDownload : measureUpload
      const mbps = await fn(host, { seconds: 9, signal, onTick: (v) => live(v, false) })
      if (direction === "down") setDown(mbps)
      else setUp(mbps)
      live(mbps, false, true)
    } catch {
      if (!signal.aborted) setHint(t("noReply"))
    }
  }

  const single = async (which: "ping" | "down" | "up") => {
    const host = guard()
    if (!host || running) return
    abort.current?.abort()
    const ctl = new AbortController()
    abort.current = ctl
    if (which === "ping") await runPing(host, ctl.signal)
    else await runThroughput(which, host, ctl.signal)
    if (!ctl.signal.aborted) setPhase("done")
  }

  const startAll = async () => {
    const host = guard()
    if (!host || running) return
    abort.current?.abort()
    const ctl = new AbortController()
    abort.current = ctl
    await runPing(host, ctl.signal)
    if (ctl.signal.aborted) return
    await runThroughput("down", host, ctl.signal)
    if (ctl.signal.aborted) return
    await runThroughput("up", host, ctl.signal)
    if (!ctl.signal.aborted) setPhase("done")
  }

  const copyResult = async () => {
    const bits = [
      `Ping ${ping ?? "-"} ms`,
      `Jitter ${jitter ?? "-"} ms`,
      `Down ${down !== null ? down.toFixed(1) : "-"} Mbps`,
      `Up ${up !== null ? up.toFixed(1) : "-"} Mbps`,
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

  return (
    <div className="mx-auto flex w-full max-w-[600px] flex-col gap-5">
      {/* the instrument: one glass pane holding everything that measures */}
      <section className="glass rounded-[24px] px-6 pb-6 pt-5">
        <div className="flex items-center justify-between gap-3">
          <div className="text-[13px] font-semibold text-txt">{t("tabSpeed")}</div>
          <button
            type="button"
            onClick={() => setPickOpen(true)}
            className="flex max-w-[60%] items-center gap-1.5 rounded-full border border-line px-2.5 py-1 text-[12px] text-txt3 transition-colors hover:border-[var(--glass-line)] hover:text-txt"
          >
            <span className="truncate">{targetLabel}</span>
            <ChevronDown className="size-3.5 shrink-0" aria-hidden />
          </button>
        </div>

        <div className="mt-3 flex flex-col items-center">
          <SpeedGauge value={value} unit={unit} phase={phase} caption={label} ceiling={ceiling} />
        </div>

        {/* one column per phase; click a column to run only that part */}
        <div className="mt-4 grid grid-cols-3 divide-x divide-line">
          <Phase
            title={t("pingTitle")}
            value={ping}
            unit={t("ms")}
            active={phase === "ping"}
            disabled={running}
            onClick={() => void single("ping")}
          />
          <Phase
            title={t("downBtn")}
            value={down}
            unit={t("mbps")}
            active={phase === "download"}
            disabled={running}
            onClick={() => void single("down")}
          />
          <Phase
            title={t("upBtn")}
            value={up}
            unit={t("mbps")}
            active={phase === "upload"}
            disabled={running}
            onClick={() => void single("up")}
          />
        </div>
      </section>

      <div className="flex items-center gap-3">
        <Button className="h-10 flex-1 gap-2 rounded-[14px] text-[13.5px]" disabled={running} onClick={() => void startAll()}>
          <Play className="size-3.5" aria-hidden />
          {running ? t("measuring") : t("startTest")}
        </Button>
        <Button
          variant="secondary"
          className="h-10 gap-2 rounded-[14px] px-4 text-[13px]"
          onClick={() => void copyResult()}
        >
          <Copy className="size-3.5" aria-hidden />
          {t("copyResult")}
        </Button>
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
            {down !== null || up !== null
              ? `↓ ${down !== null ? down.toFixed(1) : "—"} · ↑ ${up !== null ? up.toFixed(1) : "—"} ${t("mbps")}`
              : ping !== null
                ? `${t("pingTitle")} ${ping} ${t("ms")} · ${t("jitter")} ${jitter} ${t("ms")}`
                : "—"}
          </div>
        </div>
        <div className="flex flex-col items-end">
          <div className="flex items-center gap-2 text-txt2">
            <Globe className="size-5" strokeWidth={1.5} aria-hidden />
            <Users className="size-5" strokeWidth={1.5} aria-hidden />
          </div>
          <div className="mt-1 text-[13px] font-medium text-txt">{card?.name.split(" (")[0] ?? "—"}</div>
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

function Phase({
  title,
  value,
  unit,
  active,
  disabled,
  onClick,
}: {
  title: string
  value: number | null
  unit: string
  active?: boolean
  disabled?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "flex flex-col items-center gap-0.5 py-1 transition-colors",
        !disabled && "hover:bg-white/[0.03]",
      )}
    >
      <span className={cn("text-[12px] text-txt3", active && "text-brand-strong")}>{title}</span>
      <span
        className={cn(
          "text-[17px] font-medium tabular-nums",
          value === null ? "text-txt3" : active ? "text-brand-strong" : "text-txt",
        )}
      >
        {value === null ? "—" : unit === "ms" ? Math.round(value) : value.toFixed(1)}
      </span>
      <span className="text-[11px] text-txt3">{unit}</span>
    </button>
  )
}
