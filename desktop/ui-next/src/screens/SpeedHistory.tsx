import { useMemo, useState } from "react"
import { ArrowDown, ArrowLeft, ArrowUp, Check, ChevronRight, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { useI18n } from "@/lib/i18n"
import { cn } from "@/lib/utils"
import { loadHistory, saveHistory, type Run } from "./Speed"

type Pending = { kind: "one"; at: number } | { kind: "many" } | { kind: "all" } | null

const dayKey = (at: number) => {
  const d = new Date(at)
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
}

/** A run as a speed test states it: the download is the headline, upload,
    ping and jitter follow in one line, and the target it ran against sits
    where the eye lands first. */
function RunCard({
  h,
  select,
  picked,
  onAct,
  onDelete,
  deleteLabel,
  serverLabel,
}: {
  h: Run
  select: boolean
  picked: boolean
  onAct: () => void
  onDelete?: () => void
  deleteLabel: string
  serverLabel: string
}) {
  const { t } = useI18n()
  const num = (v: number | null, digits = 1) => (v === null ? "-" : v >= 100 ? v.toFixed(0) : v.toFixed(digits))
  const time = new Date(h.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
  return (
    <div
      className={cn(
        "glass group flex items-center rounded-[16px] transition-colors hover:border-line-strong",
        picked && "border-[var(--brand-line)] bg-[var(--brand-bg)]",
      )}
    >
      <button
        type="button"
        onClick={onAct}
        aria-pressed={select ? picked : undefined}
        className="min-w-0 flex-1 px-3.5 py-2.5 text-start"
      >
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-[11px] tabular-nums text-txt3">{time}</span>
          <span className="min-w-0 truncate text-[11.5px] text-txt2" dir="auto">
            {h.target || serverLabel}
          </span>
        </div>
        <div className="mt-1 flex items-center gap-1.5">
          <ArrowDown className="size-3.5 shrink-0 text-txt3" aria-hidden />
          <span className="text-[24px] leading-none font-light tabular-nums text-txt">{num(h.down)}</span>
          <span className="text-[11.5px] text-txt3">{t("mbps")}</span>
        </div>
        <div className="mt-1.5 grid grid-cols-3 divide-x divide-line text-[11px] text-txt3">
          <span className="flex min-w-0 items-center gap-1 ps-0">
            <ArrowUp className="size-3 shrink-0" aria-hidden />
            <span className="tabular-nums text-txt2">{num(h.up)}</span>
            <span>{t("mbps")}</span>
          </span>
          <span className="min-w-0 truncate ps-2">
            {t("pingTitle")} <span className="tabular-nums text-txt2">{num(h.ping, 0)}</span> {t("ms")}
          </span>
          <span className="min-w-0 truncate ps-2">
            {t("jitter")} <span className="tabular-nums text-txt2">{num(h.jitter, 0)}</span> {t("ms")}
          </span>
        </div>
      </button>
      <div className="flex shrink-0 items-center gap-1 pe-3">
        {select ? (
          <span
            className={cn(
              "grid size-4 place-items-center rounded-[5px] border transition-colors",
              picked ? "border-[var(--brand-line)] bg-[var(--brand-bg)]" : "border-line-strong",
            )}
            aria-hidden
          >
            {picked && <Check className="size-3 text-brand-strong" />}
          </span>
        ) : (
          <>
            <button
              type="button"
              aria-label={deleteLabel}
              title={deleteLabel}
              onClick={onDelete}
              className="grid size-7 place-items-center rounded-[8px] text-txt3 opacity-0 transition-opacity duration-150 hover:bg-[var(--red-bg)] hover:text-[var(--red)] focus-visible:opacity-100 group-hover:opacity-100"
            >
              <Trash2 className="size-3.5" aria-hidden />
            </button>
            <ChevronRight
              className="size-4 shrink-0 text-txt3 transition-[color,transform] duration-200 group-hover:translate-x-0.5 group-hover:text-brand-strong"
              aria-hidden
            />
          </>
        )}
      </div>
    </div>
  )
}

/** The log as a timeline: one node per day on a rail, the runs of that day
    hanging off it, and the best numbers of the whole log above it. Selecting
    turns the cards into checkboxes so one, several or everything can go, and
    nothing is removed without a confirmation. */
export function SpeedHistory({ onBack, onOpenResult }: { onBack: () => void; onOpenResult: (at: number) => void }) {
  const { t } = useI18n()
  const [history, setHistory] = useState<Run[]>(() => loadHistory())
  const [selMode, setSelMode] = useState(false)
  const [picked, setPicked] = useState<number[]>([])
  const [pending, setPending] = useState<Pending>(null)

  const write = (next: Run[]) => {
    setHistory(next)
    saveHistory(next)
  }

  const toggle = (at: number) => setPicked((p) => (p.includes(at) ? p.filter((x) => x !== at) : [...p, at]))

  const confirm = () => {
    if (!pending) return
    if (pending.kind === "one") write(history.filter((h) => h.at !== pending.at))
    else if (pending.kind === "many") write(history.filter((h) => !picked.includes(h.at)))
    else write([])
    setPicked([])
    setSelMode(false)
    setPending(null)
  }

  const title =
    pending?.kind === "one" ? t("delOne") : pending?.kind === "many" ? t("delMany") : t("clearTitle")
  const body = pending?.kind === "all" ? t("clearBody") : t("delBody")

  const rowsToGo = useMemo(() => {
    if (pending?.kind === "one") return 1
    if (pending?.kind === "many") return picked.length
    return history.length
  }, [pending, picked.length, history.length])

  /* newest first, cut into days */
  const days = useMemo(() => {
    const out: Array<{ key: string; at: number; runs: Run[] }> = []
    for (const h of history) {
      const key = dayKey(h.at)
      const last = out[out.length - 1]
      if (last && last.key === key) last.runs.push(h)
      else out.push({ key, at: h.at, runs: [h] })
    }
    return out
  }, [history])

  /* what the whole log says: the biggest numbers it ever produced */
  const best = useMemo(() => {
    const nums = (pick: (h: Run) => number | null) =>
      history.map(pick).filter((v): v is number => v !== null && Number.isFinite(v))
    const down = nums((h) => h.down)
    const up = nums((h) => h.up)
    const ping = nums((h) => h.ping)
    return {
      down: down.length ? Math.max(...down) : null,
      up: up.length ? Math.max(...up) : null,
      ping: ping.length ? Math.min(...ping) : null,
    }
  }, [history])

  const dayLabel = (at: number) => {
    const today = Date.now()
    if (dayKey(at) === dayKey(today)) return t("today")
    if (dayKey(at) === dayKey(today - 86400000)) return t("yesterday")
    return new Date(at).toLocaleDateString([], { month: "short", day: "numeric" })
  }

  const num = (v: number | null) => (v === null ? "-" : v >= 100 ? v.toFixed(0) : v.toFixed(1))

  return (
    <div className="mx-auto flex w-full max-w-[640px] flex-col gap-3">
      <div className="flex items-center gap-3 px-1">
        <Button variant="ghost" size="sm" className="h-8 gap-1.5 rounded-[10px] px-2.5 text-[12.5px]" onClick={onBack}>
          <ArrowLeft className="size-3.5" aria-hidden />
          {t("back")}
        </Button>
      </div>

      <div className="flex items-center justify-between gap-2 px-1">
        <div className="text-[11px] font-medium tracking-[0.08em] text-txt3 uppercase">
          {t("history")}
          {history.length > 0 && <span className="ms-2 font-normal tabular-nums">{history.length}</span>}
        </div>

        {history.length > 0 && (
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              className="h-8 rounded-[10px] border border-line px-2.5 text-[12.5px] hover:border-line-strong"
              onClick={() => {
                setSelMode((v) => !v)
                setPicked([])
              }}
            >
              {selMode ? t("done") : t("select")}
            </Button>
            {!selMode && (
              <Button
                variant="ghost"
                size="sm"
                className="h-8 gap-1.5 rounded-[10px] px-2.5 text-[12.5px] text-[var(--red)] hover:bg-[var(--red-bg)]"
                onClick={() => setPending({ kind: "all" })}
              >
                <Trash2 className="size-3.5" aria-hidden />
                {t("clearAll")}
              </Button>
            )}
          </div>
        )}
      </div>

      {history.length === 0 ? (
        <section className="glass rounded-[20px] px-4 py-3">
          <p className="px-1 py-6 text-[12.5px] text-txt3">{t("speedIdle")}</p>
        </section>
      ) : (
        <>
          {/* the log in three numbers */}
          <div className="glass grid grid-cols-3 divide-x divide-line rounded-[16px] px-1 py-2.5">
            {[
              { label: t("bestDown"), value: best.down, unit: t("mbps"), round: false },
              { label: t("bestUp"), value: best.up, unit: t("mbps"), round: false },
              { label: t("bestPing"), value: best.ping, unit: t("ms"), round: true },
            ].map((s) => (
              <div key={s.label} className="flex min-w-0 flex-col items-center gap-0.5 px-1">
                <span className="truncate text-[10.5px] text-txt3">{s.label}</span>
                <span
                  className={cn(
                    "text-[19px] leading-none font-light tabular-nums",
                    s.value === null ? "text-txt3" : "text-txt",
                  )}
                >
                  {s.round ? (s.value === null ? "-" : Math.round(s.value)) : num(s.value)}
                </span>
                <span className="text-[10px] text-txt3">{s.unit}</span>
              </div>
            ))}
          </div>

          {/* the timeline */}
          <div className="relative mt-0.5">
            <span aria-hidden className="absolute inset-y-3 start-[7px] w-px bg-[var(--line)]" />
            <div className="flex flex-col gap-1">
              {days.map((d) => (
                <div key={d.key}>
                  <div className="relative py-2">
                    <span
                      aria-hidden
                      className="absolute start-[3px] top-1/2 grid size-[15px] -translate-y-1/2 place-items-center rounded-full border border-line bg-[var(--bg)]"
                    >
                      <span
                        className={cn(
                          "size-1.5 rounded-full",
                          d.key === dayKey(Date.now()) ? "bg-[var(--brand-strong)]" : "bg-[var(--line-strong)]",
                        )}
                      />
                    </span>
                    <span className="block ps-[26px] text-[11px] font-medium tracking-[0.08em] text-txt3 uppercase">
                      {dayLabel(d.at)}
                    </span>
                  </div>
                  <div className="flex flex-col gap-2 ps-[26px]">
                    {d.runs.map((h) => {
                      const on = picked.includes(h.at)
                      return (
                        <RunCard
                          key={h.at}
                          h={h}
                          select={selMode}
                          picked={on}
                          onAct={() => (selMode ? toggle(h.at) : onOpenResult(h.at))}
                          onDelete={() => setPending({ kind: "one", at: h.at })}
                          deleteLabel={t("delete")}
                          serverLabel={t("targetServer")}
                        />
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {/* selection bar: what will go, and the one button that does it */}
      {selMode && (
        <div className="glass sticky bottom-0 flex items-center justify-between gap-3 rounded-[16px] px-4 py-2.5">
          <span className="text-[12.5px] text-txt3">
            {t("selected")}: <span className="tabular-nums text-txt2">{picked.length}</span>
          </span>
          <Button
            size="sm"
            className="h-8 gap-1.5 rounded-[10px] px-3 text-[12.5px]"
            disabled={picked.length === 0}
            onClick={() => setPending({ kind: "many" })}
          >
            <Trash2 className="size-3.5" aria-hidden />
            {t("delete")}
          </Button>
        </div>
      )}

      <Dialog open={pending !== null} onOpenChange={(o) => !o && setPending(null)}>
        <DialogContent className="max-w-[360px] gap-0 overflow-hidden rounded-[var(--r-card)] p-0">
          <div className="px-5 pb-4 pt-4">
            <DialogHeader className="gap-1.5">
              <DialogTitle className="text-[14px] font-semibold">{title}</DialogTitle>
              <DialogDescription className="text-[12.5px] leading-relaxed text-txt3">{body}</DialogDescription>
            </DialogHeader>
            <p className="mt-3 text-[12.5px] text-txt3">
              {t("history")}: <span className="tabular-nums text-txt2">{rowsToGo}</span>
            </p>
          </div>
          <div className="flex items-center justify-end gap-2 border-t border-line bg-[var(--panel)]/40 px-5 py-3">
            <Button
              variant="ghost"
              className="h-[var(--ctl-h)] rounded-[var(--r-ctl)] border border-line px-4 text-[13px] hover:border-line-strong"
              onClick={() => setPending(null)}
            >
              {t("cancel")}
            </Button>
            <Button
              className="h-[var(--ctl-h)] gap-1.5 rounded-[var(--r-ctl)] border border-[var(--red-line)] bg-[rgb(207_112_120/0.2)] px-4 text-[13px] font-medium text-[#e6999f] hover:bg-[rgb(207_112_120/0.26)]"
              onClick={confirm}
            >
              <Trash2 className="size-3.5" aria-hidden />
              {t("delete")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
