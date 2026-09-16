import { useState } from "react"
import { ArrowLeft, ChevronRight } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useI18n } from "@/lib/i18n"
import { HistoryRow, loadHistory, type Run } from "./Speed"

/** Full run history, newest first, each run a small designed card. Tapping a
    card opens its result view; Back returns to Speed. */
export function SpeedHistory({ onBack, onOpenResult }: { onBack: () => void; onOpenResult: (at: number) => void }) {
  const { t } = useI18n()
  const [history] = useState<Run[]>(() => loadHistory())

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
      </div>

      {history.length === 0 ? (
        <section className="glass rounded-[20px] px-4 py-3">
          <p className="px-1 py-6 text-[12.5px] text-txt3">{t("speedIdle")}</p>
        </section>
      ) : (
        <div className="flex flex-col gap-2">
          {history.map((h) => (
            <button
              key={h.at}
              type="button"
              onClick={() => onOpenResult(h.at)}
              className="glass group w-full rounded-[20px] px-4 py-3 text-start transition-colors"
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
          ))}
        </div>
      )}
    </div>
  )
}
