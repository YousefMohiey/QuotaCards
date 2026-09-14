import { useEffect, useRef, useState } from "react"
import { ChevronDown, Globe, Users } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { PickerDialog, type PickerItem } from "@/components/PickerDialog"
import { SpeedGauge, type GaugePhase } from "@/components/SpeedGauge"
import { useApp } from "@/state/app"
import { useI18n } from "@/lib/i18n"
import { measureDownload, measurePing, measureUpload } from "@/lib/speedtest"
import { CUSTOM_SNI, SNIS } from "@/lib/snis"
import { cn } from "@/lib/utils"

export function Speed() {
  const { t } = useI18n()
  const { serverIp, card } = useApp()
  const [phase, setPhase] = useState<GaugePhase>("idle")
  const [label, setLabel] = useState(() => t("idle"))
  const [value, setValue] = useState(0)
  const [unit, setUnit] = useState<"Mbps" | "ms">("Mbps")
  const [badges, setBadges] = useState<number[]>([])
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
  const targetLabel = custom.trim() || (target ? target : t("targetServer"))

  // A different card is a different path: old numbers would be lies.
  useEffect(() => {
    setPing(null)
    setJitter(null)
    setDown(null)
    setUp(null)
    setBadges([])
    if (phase === "idle") setValue(0)
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

  const runPing = async (host: string, signal: AbortSignal) => {
    setPhase("ping")
    setLabel(t("pingTitle"))
    setUnit("ms")
    setValue(0)
    setBadges([])
    setHint(t("pingHint"))
    try {
      const r = await measurePing(host, 8, {
        signal,
        target: targetHost,
        onPing: (ms) => {
          setValue(ms)
          setBadges((prev) => [...prev.slice(-2), ms])
        },
      })
      setPing(r.ping)
      setJitter(r.jitter)
      setValue(r.ping)
      setLabel(t("pingTitle"))
    } catch {
      if (!signal.aborted) setHint(t("noReply"))
    }
  }

  const runThroughput = async (kindOf: "down" | "up", host: string, signal: AbortSignal) => {
    setPhase(kindOf === "down" ? "download" : "upload")
    setLabel(kindOf === "down" ? t("chDown") : t("chUp"))
    setUnit("Mbps")
    setValue(0)
    setHint(kindOf === "down" ? t("downHint") : t("upHint"))
    try {
      const fn = kindOf === "down" ? measureDownload : measureUpload
      const mbps = await fn(host, { seconds: 9, signal, onTick: (v) => setValue(v) })
      if (kindOf === "down") setDown(mbps)
      else setUp(mbps)
      setValue(mbps)
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

  const badgeColors = ["var(--amber)", "var(--green)", "#63a8bb"]

  return (
    <div className="mx-auto flex w-full max-w-[560px] flex-col items-center gap-6 pt-1">
      <div className="flex items-center gap-2">
        <span className="text-[14px] font-medium text-txt">
          {t("pingTitle")} <span className="text-[12px] font-normal text-txt3">{t("ms")}</span>
        </span>
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className={cn(
              "grid size-[26px] place-items-center rounded-full text-[12px] font-semibold",
              badges[i] === undefined ? "bg-white/[0.06] text-txt3" : "text-[#0b0f18]",
            )}
            style={badges[i] !== undefined ? { background: badgeColors[i % 3] } : undefined}
          >
            {badges[i] !== undefined ? Math.round(badges[i]!) : "—"}
          </span>
        ))}
      </div>

      <SpeedGauge value={value} unit={unit} phase={phase} caption={label} />

      {/* results, one column per phase; click a column to run just that part */}
      <div className="flex items-start gap-7">
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

      <Button
        className="h-9 rounded-full px-6 text-[13px]"
        disabled={running}
        onClick={() => void startAll()}
      >
        {running ? t("measuring") : t("startTest")}
      </Button>

      <p aria-live="polite" className="min-h-[18px] text-center text-[12px] text-txt3">
        {hint || t("speedIdle")}
      </p>

      {/* what the ping measures against, and a way to take the numbers away */}
      <div className="flex w-full flex-col gap-2 border-t border-line pt-3 pb-1">
        <div className="flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => setPickOpen(true)}
            className="flex items-center gap-1.5 text-[12.5px] text-txt3 transition-colors hover:text-txt"
          >
            {t("target")}:
            <span className="text-txt">{targetLabel}</span>
            <ChevronDown className="size-3.5" aria-hidden />
          </button>
          <button
            type="button"
            onClick={() => void copyResult()}
            className="text-[12.5px] text-txt3 transition-colors hover:text-txt"
          >
            {t("copyResult")}
          </button>
        </div>
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
            className="h-9 rounded-[10px] border-line bg-white/[0.02] text-[13px]"
          />
        )}
      </div>

      <div className="flex w-full items-start justify-between px-1 pb-3">
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
        "flex w-[86px] flex-col items-center gap-0.5 rounded-[10px] py-1 transition-colors",
        !disabled && "hover:bg-white/[0.03]",
        active && "text-brand-strong",
      )}
    >
      <span className={cn("text-[12px] text-txt3", active && "text-brand-strong")}>{title}</span>
      <span className={cn("text-[16px] font-medium text-txt tabular-nums", value === null && "text-txt3")}>
        {value === null ? "—" : unit === "ms" ? Math.round(value) : value.toFixed(1)}
      </span>
      <span className="text-[11px] text-txt3">{unit}</span>
    </button>
  )
}
