import { useRef, useState, type ReactNode } from "react"
import { Gamepad2, Globe, MonitorPlay, Users } from "lucide-react"
import { SpeedGauge, Stars, type GaugePhase } from "@/components/SpeedGauge"
import { useApp } from "@/state/app"
import { useI18n } from "@/lib/i18n"
import { measureDownload, measurePing, measureUpload } from "@/lib/speedtest"
import { cn } from "@/lib/utils"

/** Higher is better. 0 means "not measured yet". */
const up = (v: number | null, bands: [number, number, number, number]): number => {
  if (v === null) return 0
  if (v >= bands[0]) return 5
  if (v >= bands[1]) return 4
  if (v >= bands[2]) return 3
  if (v >= bands[3]) return 2
  return 1
}
/** Lower is better. */
const down = (v: number | null, bands: [number, number, number, number]): number => {
  if (v === null) return 0
  if (v <= bands[0]) return 5
  if (v <= bands[1]) return 4
  if (v <= bands[2]) return 3
  if (v <= bands[3]) return 2
  return 1
}

export function Speed() {
  const { t } = useI18n()
  const { serverIp, card } = useApp()
  const [phase, setPhase] = useState<GaugePhase>("idle")
  const [label, setLabel] = useState(() => t("idle"))
  const [value, setValue] = useState(0)
  const [unit, setUnit] = useState<"Mbps" | "ms">("Mbps")
  const [pings, setPings] = useState<number[]>([])
  const [ping, setPing] = useState<number | null>(null)
  const [jitter, setJitter] = useState<number | null>(null)
  const [downMbps, setDownMbps] = useState<number | null>(null)
  const [upMbps, setUpMbps] = useState<number | null>(null)
  const [hint, setHint] = useState("")
  const abort = useRef<AbortController | null>(null)

  const running = phase === "ping" || phase === "download" || phase === "upload"

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

  const start = (p: GaugePhase) => {
    abort.current?.abort()
    const ctl = new AbortController()
    abort.current = ctl
    setPhase(p)
    return ctl.signal
  }

  const runPing = async () => {
    const host = guard()
    if (!host || running) return
    const signal = start("ping")
    setLabel(t("pingTitle"))
    setUnit("ms")
    setValue(0)
    setPings([])
    setHint(t("pingHint"))
    try {
      const r = await measurePing(host, 8, {
        signal,
        onPing: (ms) => {
          setValue(ms)
          setPings((prev) => [...prev.slice(-2), ms])
        },
      })
      setPing(r.ping)
      setJitter(r.jitter)
      setValue(r.ping)
      setLabel(t("pingTitle"))
    } catch {
      setHint(t("noReply"))
    } finally {
      setPhase("done")
    }
  }

  const run = async (kind: "down" | "up") => {
    const host = guard()
    if (!host || running) return
    const signal = start(kind === "down" ? "download" : "upload")
    setLabel(kind === "down" ? t("chDown") : t("chUp"))
    setUnit("Mbps")
    setValue(0)
    setHint(kind === "down" ? t("downHint") : t("upHint"))
    try {
      const fn = kind === "down" ? measureDownload : measureUpload
      const mbps = await fn(host, { seconds: 9, signal, onTick: (v) => setValue(v) })
      if (kind === "down") setDownMbps(mbps)
      else setUpMbps(mbps)
      setValue(mbps)
    } catch {
      setHint(t("noReply"))
    } finally {
      setPhase("done")
    }
  }

  const badge = ["var(--amber)", "var(--green)", "#63a8bb"]

  return (
    <div className="mx-auto flex w-full max-w-[560px] flex-col items-center gap-7 pt-2">
      {/* Ping headline with the last three probes */}
      <div className="flex items-center gap-2">
        <span className="text-[14px] font-medium text-txt">
          {t("pingTitle")} <span className="font-normal text-txt3">{t("ms")}</span>
        </span>
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className={cn(
              "grid size-[26px] place-items-center rounded-full text-[12px] font-semibold",
              pings[i] === undefined ? "bg-white/[0.06] text-txt3" : "text-[#0b0f18]",
            )}
            style={pings[i] !== undefined ? { background: badge[i % 3] } : undefined}
          >
            {pings[i] !== undefined ? Math.round(pings[i]!) : "—"}
          </span>
        ))}
      </div>

      {/* What the numbers are good for */}
      <div className="flex w-full items-start justify-between px-8">
        <Activity icon={Globe} label="Web" score={Math.min(down(ping, [20, 40, 80, 150]), down(jitter, [5, 12, 25, 50]))} />
        <Activity icon={Gamepad2} label="Gaming" score={down(ping, [20, 40, 80, 150])} />
        <Activity icon={MonitorPlay} label="Streaming" score={up(downMbps, [200, 100, 50, 20])} />
        <Activity icon={Users} label="Social" score={up(upMbps, [50, 25, 10, 5])} />
      </div>

      <SpeedGauge value={value} unit={unit} phase={phase} caption={label} />

      <div className="flex items-center gap-2">
        <ThinButton onClick={() => void runPing()} active={phase === "ping"} disabled={running && phase !== "ping"}>
          {phase === "ping" ? t("measuring") : t("pingBtn")}
        </ThinButton>
        <ThinButton onClick={() => void run("down")} active={phase === "download"} disabled={running && phase !== "download"}>
          {phase === "download" ? t("measuring") : t("downBtn")}
        </ThinButton>
        <ThinButton onClick={() => void run("up")} active={phase === "upload"} disabled={running && phase !== "upload"}>
          {phase === "upload" ? t("measuring") : t("upBtn")}
        </ThinButton>
      </div>

      <p aria-live="polite" className="min-h-[18px] text-center text-[12px] text-txt3">
        {hint || t("speedIdle")}
      </p>

      {/* Server and profile footer */}
      <div className="flex w-full items-start justify-between px-4 pb-3">
        <div>
          <div className="text-[15px] font-medium text-txt">{serverIp || "—"}</div>
          <div className="mt-1 text-[12px] text-txt3">
            {ping !== null ? `${ping} ${t("ms")}` : "—"} · {jitter !== null ? `${jitter} ${t("ms")}` : "—"}
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
    </div>
  )
}

function Activity({ icon: Icon, label, score }: { icon: typeof Globe; label: string; score: number }) {
  return (
    <div className="flex flex-col items-center gap-2">
      <Icon className="size-8 text-txt" strokeWidth={1.4} aria-hidden />
      <Stars score={score} />
      <span className="text-[11.5px] text-txt3">{label}</span>
    </div>
  )
}

function ThinButton({
  children,
  onClick,
  active,
  disabled,
}: {
  children: ReactNode
  onClick: () => void
  active?: boolean
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "h-[30px] rounded-full border px-4 text-[12.5px] transition-colors disabled:opacity-45",
        active
          ? "border-[var(--brand-line)] text-brand-strong"
          : "border-line text-txt2 hover:border-[var(--brand-line)] hover:text-txt",
      )}
    >
      {children}
    </button>
  )
}
