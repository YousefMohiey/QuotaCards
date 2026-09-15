import { AnimatePresence, motion } from "motion/react"
import { ArrowDownToLine, CreditCard, Gauge, Home, Settings as SettingsIcon } from "lucide-react"
import { cn } from "@/lib/utils"
import { useI18n, type StrKey } from "@/lib/i18n"
import { useApp } from "@/state/app"

export type Tab = "home" | "cards" | "speed" | "apps" | "settings"

const EASE_OUT = [0.1, 0.9, 0.2, 1] as const

const PRIMARY: Array<{ id: Tab; icon: typeof Home; key: StrKey }> = [
  { id: "home", icon: Home, key: "tabHome" },
  { id: "cards", icon: CreditCard, key: "tabCards" },
  { id: "speed", icon: Gauge, key: "tabSpeed" },
]

export function Sidebar({ tab, onTab }: { tab: Tab; onTab: (t: Tab) => void }) {
  const { t } = useI18n()
  const { card, version, update, updateState } = useApp()

  const navButton = (id: Tab, icon: typeof Home, label: string) => {
    const active = tab === id || (id === "home" && tab === "apps")
    const Icon = icon
    return (
      <button
        key={id}
        type="button"
        onClick={() => onTab(id)}
        aria-current={active ? "page" : undefined}
        className={cn(
          "nav-item relative flex w-full items-center gap-2.5 px-3 text-[13px] outline-none",
          active ? "bg-white/[0.055] font-medium text-txt" : "text-txt2 hover:bg-white/[0.035] hover:text-txt",
        )}
      >
        {active && (
          <motion.span
            layoutId="nav-accent"
            className="absolute inset-y-[8px] start-[-9px] w-[2.5px] rounded-full bg-brand"
            transition={{ type: "spring", stiffness: 520, damping: 40 }}
          />
        )}
        <Icon className="size-[17px] shrink-0" strokeWidth={1.75} aria-hidden />
        <span className="truncate">{label}</span>
      </button>
    )
  }

  return (
    <aside className="glass-side flex w-[214px] shrink-0 flex-col">
      {/* identity: the mark, the build, then whatever the app is set to use */}
      <div className="px-3 pb-2.5 pt-3.5">
        <div className="flex items-center gap-2.5">
          <img src="/icon.png" alt="" aria-hidden className="size-12 shrink-0" />
          <div className="min-w-0">
            <div className="flex items-baseline gap-1.5">
              <span className="truncate text-[14.5px] font-semibold text-txt">QuotaCards</span>
              {version && <span className="shrink-0 text-[10.5px] text-txt3">v{version}</span>}
            </div>
          </div>
        </div>

        {/* the card this app is set to spend from */}
        {card && (
          <button
            type="button"
            onClick={() => onTab("cards")}
            title={card.name}
            className="mt-2.5 w-full rounded-[var(--r-ctl)] border border-line bg-white/[0.02] px-2.5 py-1.5 text-start transition-colors duration-[var(--t-fast)] hover:bg-white/[0.045]"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="truncate text-[11.5px] font-medium text-txt">{card.name.split(" (")[0]}</span>
              <span className="shrink-0 rounded-full border border-line bg-white/[0.02] px-1.5 py-[1px] text-[10px] tracking-[0.04em] text-txt2 uppercase">
                {card.card_type}
              </span>
            </div>
            <div className="mt-0.5 truncate text-[10.5px] text-txt3">{card.sni}</div>
          </button>
        )}

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
              className="mt-2 flex w-full items-center gap-2 rounded-[var(--r-ctl)] border border-line bg-white/[0.02] px-2.5 py-1.5 text-start transition-colors duration-[var(--t-fast)] hover:border-line-strong"
            >
              <span className="relative grid size-4 shrink-0 place-items-center" aria-hidden>
                <span className="soft-ping absolute inset-0 rounded-full bg-[var(--brand)]" />
                <ArrowDownToLine className="relative size-3.5 text-brand-strong" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[11px] font-medium text-txt">
                  {t("updRemind")} · v{update.latest}
                </span>
                <span className="block truncate text-[10px] text-txt3">{t("updRemindSub")}</span>
              </span>
            </motion.button>
          )}
        </AnimatePresence>
      </div>

      <nav className="flex flex-col gap-0.5 px-2" aria-label="Main">
        {PRIMARY.map(({ id, icon, key }) => navButton(id, icon, t(key)))}
      </nav>

      <div className="mt-auto flex flex-col gap-0.5 p-2">
        {navButton("settings", SettingsIcon, t("tabSettings"))}
      </div>
    </aside>
  )
}
