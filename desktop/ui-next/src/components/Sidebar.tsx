import { AnimatePresence, motion } from "motion/react"
import { ArrowDownToLine, Gauge, History as HistoryIcon, Home, Settings as SettingsIcon } from "lucide-react"
import type { ComponentType } from "react"
import { ValorantMark } from "@/components/ValorantMark"
import { cn } from "@/lib/utils"
import { useI18n, type StrKey } from "@/lib/i18n"
import { useApp } from "@/state/app"

export type Tab = "home" | "speed" | "voice" | "history" | "result" | "apps" | "settings"

const EASE_OUT = [0.1, 0.9, 0.2, 1] as const

const PRIMARY: Array<{ id: Tab; icon: ComponentType<{ className?: string; strokeWidth?: number; "aria-hidden"?: boolean }>; key: StrKey }> = [
  { id: "home", icon: Home, key: "tabHome" },
  { id: "speed", icon: Gauge, key: "tabSpeed" },
  { id: "voice", icon: ValorantMark, key: "tabVoice" },
  { id: "history", icon: HistoryIcon, key: "history" },
]

export function Sidebar({ tab, onTab }: { tab: Tab; onTab: (t: Tab) => void }) {
  const { t } = useI18n()
  const { version, update, updateState } = useApp()

  return (
    <aside className="glass-side flex w-[236px] shrink-0 flex-col">
      {/* identity: the mark plus the build on one baseline */}
      <div className="px-3.5 pb-3 pt-4">
        <div className="flex items-center gap-3">
          <img src="/icon.png" alt="" aria-hidden className="size-14 shrink-0" />
          <div className="min-w-0">
            <div className="flex items-baseline gap-3">
              <span className="truncate text-[15px] font-semibold text-txt">QuotaVPN</span>
              {version && <span className="shrink-0 text-[10.5px] text-txt3">v{version}</span>}
            </div>
          </div>
        </div>

        {/* one quiet line when a new build exists: it slides in, it never blocks */}
        <AnimatePresence initial={false}>
          {updateState === "available" && update && (
            <motion.button
              type="button"
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.3, ease: EASE_OUT }}
              onClick={() => onTab("settings")}
              className="mt-2 flex w-full items-center gap-2 rounded-[12px] border border-[var(--brand-line)] bg-[var(--brand-bg)] px-2.5 py-2 text-start transition-colors hover:border-[var(--brand)]"
            >
              <span className="relative grid size-4 shrink-0 place-items-center" aria-hidden>
                <ArrowDownToLine className="relative size-3.5 text-brand-strong" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[11.5px] font-medium text-brand-strong" dir="auto">
                  {t("updRemind")} · v{update.latest}
                </span>
                <span className="block truncate text-[10.5px] text-txt3" dir="auto">
                  {update.notes || t("updRemindSub")}
                </span>
              </span>
            </motion.button>
          )}
        </AnimatePresence>
      </div>

      <nav className="mt-1.5 flex flex-col gap-1 px-2.5" aria-label="Main">
        {PRIMARY.map(({ id, icon: Icon, key }) => {
          const active = tab === id || (id === "home" && tab === "apps") || (id === "history" && tab === "result")
          return (
            <button
              key={id}
              onClick={() => onTab(id)}
              aria-current={active ? "page" : undefined}
              className={cn(
                "relative flex h-10 items-center gap-3 rounded-[12px] px-3.5 text-[13.5px] transition-colors",
                active
                  ? "bg-white/[0.06] font-medium text-txt shadow-[inset_0_1px_0_rgb(255_255_255/0.06)]"
                  : "text-txt2 hover:bg-white/[0.04] hover:text-txt",
              )}
            >
              {active && (
                <motion.span
                  layoutId="nav-accent"
                  className="absolute inset-y-[9px] start-[-10px] w-[3px] rounded-full bg-brand"
                  transition={{ type: "spring", stiffness: 520, damping: 40 }}
                />
              )}
              <Icon className={cn("size-[20px] shrink-0", active ? "text-brand-strong" : "text-txt2")} strokeWidth={2} aria-hidden />
              <span className="truncate">{t(key)}</span>
            </button>
          )
        })}
      </nav>

      <div className="mt-auto flex flex-col gap-1 p-2.5">
        <button
          onClick={() => onTab("settings")}
          aria-current={tab === "settings" ? "page" : undefined}
          className={cn(
            "relative flex h-10 items-center gap-3 rounded-[12px] px-3.5 text-[13.5px] transition-colors",
            tab === "settings"
              ? "bg-white/[0.06] font-medium text-txt shadow-[inset_0_1px_0_rgb(255_255_255/0.06)]"
              : "text-txt2 hover:bg-white/[0.04] hover:text-txt",
          )}
        >
          {tab === "settings" && (
            <motion.span
              layoutId="nav-accent"
              className="absolute inset-y-[9px] start-[-10px] w-[3px] rounded-full bg-brand"
              transition={{ type: "spring", stiffness: 520, damping: 40 }}
            />
          )}
          <SettingsIcon className={cn("size-[20px] shrink-0", tab === "settings" ? "text-brand-strong" : "text-txt2")} strokeWidth={2} aria-hidden />
          <span>{t("tabSettings")}</span>
        </button>
      </div>
    </aside>
  )
}
