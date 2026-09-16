import { useMemo, useState } from "react"
import { ArrowLeft, Check, ChevronRight, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { useI18n } from "@/lib/i18n"
import { cn } from "@/lib/utils"
import { HistoryRow, loadHistory, saveHistory, type Run } from "./Speed"

type Pending = { kind: "one"; at: number } | { kind: "many" } | { kind: "all" } | null

/** Full run history, newest first. Rows open their result view; selecting
    turns the list into checkboxes so one or many runs can go at once, and
    nothing is ever removed without a confirmation. */
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

  const toggle = (at: number) =>
    setPicked((p) => (p.includes(at) ? p.filter((x) => x !== at) : [...p, at]))

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
              className="h-8 rounded-[10px] px-2.5 text-[12.5px]"
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
        <div className="flex flex-col gap-2">
          {history.map((h) => {
            const on = picked.includes(h.at)
            return selMode ? (
              <button
                key={h.at}
                type="button"
                aria-pressed={on}
                onClick={() => toggle(h.at)}
                className={cn(
                  "glass w-full rounded-[20px] px-4 py-3 text-start transition-colors",
                  on && "border-[var(--brand-line)] bg-[var(--brand-bg)]",
                )}
              >
                <HistoryRow
                  h={h}
                  trailing={
                    <span
                      className={cn(
                        "grid size-4 shrink-0 place-items-center self-center rounded-[5px] border transition-colors",
                        on ? "border-[var(--brand-line)] bg-[var(--brand-bg)]" : "border-line-strong",
                      )}
                      aria-hidden
                    >
                      {on && <Check className="size-3 text-brand-strong" />}
                    </span>
                  }
                />
              </button>
            ) : (
              <div key={h.at} className="glass group flex items-center rounded-[20px] transition-colors hover:border-line-strong">
                <button
                  type="button"
                  onClick={() => onOpenResult(h.at)}
                  className="min-w-0 flex-1 px-4 py-3 text-start"
                >
                  <HistoryRow
                    h={h}
                    trailing={
                      <ChevronRight
                        className="size-4 shrink-0 self-center text-txt3 transition-[color,transform] duration-200 group-hover:translate-x-0.5 group-hover:text-brand-strong"
                        aria-hidden
                      />
                    }
                  />
                </button>
                <button
                  type="button"
                  aria-label={t("delete")}
                  title={t("delete")}
                  onClick={() => setPending({ kind: "one", at: h.at })}
                  className="me-2 mt-1.5 grid size-7 shrink-0 self-start place-items-center rounded-[8px] text-txt3 opacity-0 transition-opacity duration-150 hover:bg-[var(--red-bg)] hover:text-[var(--red)] focus-visible:opacity-100 group-hover:opacity-100"
                >
                  <Trash2 className="size-3.5" aria-hidden />
                </button>
              </div>
            )
          })}
        </div>
      )}

      {/* selection bar: what will go, and the one button that does it */}
      {selMode && (
        <div className="glass sticky bottom-0 flex items-center justify-between gap-3 rounded-[20px] px-4 py-2.5">
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
        <DialogContent className="max-w-[380px] gap-3.5">
          <DialogHeader>
            <DialogTitle className="text-[14.5px]">{title}</DialogTitle>
            <DialogDescription className="text-[12.5px] text-txt3">{body}</DialogDescription>
          </DialogHeader>
          <p className="text-[12.5px] text-txt2">
            {t("history")}: <span className="tabular-nums">{rowsToGo}</span>
          </p>
          <DialogFooter className="gap-2">
            <Button
              variant="ghost"
              className="h-[var(--ctl-h)] rounded-[var(--r-ctl)] text-[13px]"
              onClick={() => setPending(null)}
            >
              {t("cancel")}
            </Button>
            <Button
              className="h-[var(--ctl-h)] gap-1.5 rounded-[var(--r-ctl)] bg-[var(--red)] text-[13px] text-white hover:bg-[var(--red)]/90"
              onClick={confirm}
            >
              <Trash2 className="size-3.5" aria-hidden />
              {t("delete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
