import { useState } from "react"
import { ArrowLeft } from "lucide-react"
import { Button } from "@/components/ui/button"
import { SpeedBars } from "@/components/SpeedBars"
import { useI18n } from "@/lib/i18n"
import { buildVerdicts, loadHistory, type Run } from "./Speed"
import { cn } from "@/lib/utils"

/** One stored run shown exactly like a finished Speed test: big display
    number, graph area, four readings, verdicts. Nothing is measured here;
    everything comes from the stored run. Back returns to the History list. */
export function SpeedResult({ runAt, onBack }: { runAt: number | null; onBack: () => void }) {
  const { t } = useI18n()
  const [history] = useState<Run[]>(() => loadHistory())
  const run = history.find((h) => h.at === runAt) ?? history[0] ?? null
  const verdicts = run ? buildVerdicts(run, t) : []

  const marquee = run?.down ?? run?.up ?? null
  const headline = marquee ?? run?.ping ?? null
  const headlineUnit = marquee !== null && marquee !== undefined ? t("mbps") : t("ms")
  const headlineText =
    headline === null || headline === undefined
      ? "-"
      : headlineUnit === t("ms")
        ? String(Math.round(headline))
        : headline >= 100
          ? headline.toFixed(0)
          : headline.toFixed(1)

  const readings = run
    ? [
        { key: "ping", title: t("pingTitle"), value: run.ping, unit: t("ms") },
        { key: "jitter", title: t("jitter"), value: run.jitter, unit: t("ms") },
        { key: "down", title: t("chDown"), value: run.down, unit: t("mbps") },
        { key: "up", title: t("chUp"), value: run.up, unit: t("mbps") },
      ]
    : []

  return (
    <div className="mx-auto flex w-full max-w-[640px] flex-col gap-3">
      <div className="flex items-center gap-3 px-1">
        <Button variant="ghost" size="sm" className="h-8 gap-1.5 rounded-[10px] px-2.5 text-[12.5px]" onClick={onBack}>
          <ArrowLeft className="size-3.5" aria-hidden />
          {t("back")}
        </Button>
      </div>

      {run === null ? (
        <section className="glass rounded-[20px] px-4 py-3">
          <p className="px-1 py-6 text-[12.5px] text-txt3">{t("speedIdle")}</p>
        </section>
      ) : (
        <section className="glass rounded-[24px] px-5 pb-3 pt-3">
          <div className="min-w-0">
            <div className="truncate text-[13px] font-semibold text-txt">
              {new Date(run.at).toLocaleDateString([], { month: "short", day: "numeric" })}
              {" "}
              {new Date(run.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
            </div>
            <div className="mt-0.5 truncate text-[11.5px] text-txt3" dir="auto">
              <bdi>{run.target || t("targetServer")}</bdi>
            </div>
          </div>

          <div className="mt-2.5 flex items-end justify-between gap-6">
            <div className="flex items-baseline gap-2">
              <span className="text-[46px] leading-none font-light tabular-nums text-txt" style={{ letterSpacing: "-0.02em" }}>
                {headlineText}
              </span>
              <span className="text-[13px] text-txt3">{headlineUnit}</span>
            </div>
          </div>

          <div className="mt-2.5">
            <SpeedBars samples={[]} accent="var(--brand)" active={false} />
          </div>

          <div className="mt-2.5 grid grid-cols-4 divide-x divide-line">
            {readings.map((r) => (
              <div key={r.key} className="flex flex-col items-center gap-0.5 py-1">
                <span className="text-[11.5px] text-txt3">{r.title}</span>
                <span className={cn("text-[17px] font-medium tabular-nums", r.value === null ? "text-txt3" : "text-txt")}>
                  {r.value === null ? "-" : r.unit === "ms" ? Math.round(r.value) : r.value.toFixed(1)}
                </span>
                <span className="text-[11px] text-txt3">{r.unit}</span>
              </div>
            ))}
          </div>

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
      )}
    </div>
  )
}
