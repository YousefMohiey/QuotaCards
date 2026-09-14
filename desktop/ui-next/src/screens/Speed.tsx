import { useRef, useState } from "react"
import { ArrowDown, ArrowUp, Activity } from "lucide-react"
import { Button } from "@/components/ui/button"
import { SpeedGauge, type GaugePhase } from "@/components/SpeedGauge"
import { Panel, PageTitle } from "@/components/Row"
import { useApp } from "@/state/app"
import { useI18n } from "@/lib/i18n"
import { measureDownload, measurePing, measureUpload } from "@/lib/speedtest"
import { cn } from "@/lib/utils"

const fmt = (v: number | null, digits = 1) => (v === null ? "—" : v.toFixed(digits))

export function Speed() {
  const { t } = useI18n()
  const { serverIp, card } = useApp()
  const [phase, setPhase] = useState<GaugePhase>("idle")
  const [value, setValue] = useState(0)
  const [unit, setUnit] = useState<"Mbps" | "ms">("Mbps")
  const [ping, setPing] = useState<number | null>(null)
  const [jitter, setJitter] = useState<number | null>(null)
  const [down, setDown] = useState<number | null>(null)
  const [up, setUp] = useState<number | null>(null)
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
    setUnit("ms")
    setValue(0)
    setHint(t("pingHint"))
    try {
      const r = await measurePing(host, 8, {
        signal,
        onPing: (ms) => setValue(ms),
      })
      setPing(r.ping)
      setJitter(r.jitter)
      setValue(r.ping)
      setHint(t("pingHint"))
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
    setUnit("Mbps")
    setValue(0)
    setHint(kind === "down" ? t("downHint") : t("upHint"))
    try {
      const fn = kind === "down" ? measureDownload : measureUpload
      const mbps = await fn(host, { seconds: 9, signal, onTick: (v) => setValue(v) })
      if (kind === "down") setDown(mbps)
      else setUp(mbps)
      setValue(mbps)
    } catch {
      setHint(t("noReply"))
    } finally {
      setPhase("done")
    }
  }

  const caption =
    phase === "ping"
      ? t("pingTitle")
      : phase === "download"
        ? t("chDown")
        : phase === "upload"
          ? t("chUp")
          : phase === "done"
            ? t("ready")
            : t("idle")

  return (
    <div className="flex flex-col gap-4">
      <PageTitle>{t("tabSpeed")}</PageTitle>

      <Panel className="flex flex-col items-center px-6 py-7">
        <SpeedGauge value={value} unit={unit} phase={phase} caption={caption} />

        <div className="mt-6 grid w-full max-w-[520px] grid-cols-4 gap-2">
          <Metric label={t("pingTitle")} value={fmt(ping, 0)} unit={t("ms")} />
          <Metric label={t("jitter")} value={fmt(jitter, 1)} unit={t("ms")} />
          <Metric label={t("chDown")} value={fmt(down, 1)} unit={t("mbps")} />
          <Metric label={t("chUp")} value={fmt(up, 1)} unit={t("mbps")} />
        </div>

        <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
          <Button
            variant="secondary"
            className="h-9 gap-2 rounded-[10px] px-3.5 text-[13px]"
            disabled={running && phase !== "ping"}
            onClick={() => void runPing()}
          >
            <Activity className="size-4" aria-hidden />
            {phase === "ping" ? t("measuring") : t("pingBtn")}
          </Button>
          <Button
            variant="secondary"
            className="h-9 gap-2 rounded-[10px] px-3.5 text-[13px]"
            disabled={running && phase !== "download"}
            onClick={() => void run("down")}
          >
            <ArrowDown className="size-4" aria-hidden />
            {phase === "download" ? t("measuring") : t("downBtn")}
          </Button>
          <Button
            variant="secondary"
            className="h-9 gap-2 rounded-[10px] px-3.5 text-[13px]"
            disabled={running && phase !== "upload"}
            onClick={() => void run("up")}
          >
            <ArrowUp className="size-4" aria-hidden />
            {phase === "upload" ? t("measuring") : t("upBtn")}
          </Button>
        </div>

        <p aria-live="polite" className="mt-4 min-h-[18px] text-center text-[12px] text-txt3">
          {hint || t("speedIdle")}
        </p>
      </Panel>

      <p className="px-1 text-[11.5px] text-txt3">
        {t("serverLabel")}: {card?.sni || "—"}
      </p>
    </div>
  )
}

function Metric({ label, value, unit }: { label: string; value: string; unit: string }) {
  return (
    <div className={cn("rounded-[12px] border border-line bg-white/[0.02] px-3 py-2.5 text-center")}>
      <div className="text-[11px] text-txt3">{label}</div>
      <div className="mt-1 text-[15px] font-medium text-txt">
        {value}
        <span className="ml-1 text-[11px] font-normal text-txt3">{unit}</span>
      </div>
    </div>
  )
}
