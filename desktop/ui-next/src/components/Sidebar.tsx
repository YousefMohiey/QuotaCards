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
  const { phase, card, version, update, updateState } = useApp()

  const state =
    phase === "connecting"
      ? "working"
      : phase === "on"
        ? "connected"
        : phase === "stopping"
          ? "connecting"
          : "ready"

  const stateLabel =
    state === "connected"
      ? t("vpnConnected")
      : state === "working"
        ? t("working")
        : state === "connecting"
          ? t("connecting")
          : t("ready")

  return (
    <aside className="glass-side flex w-[236px] shrink-0 flex-col">
      {/* identity: the mark, the build, and whatever the app is doing now */}
      <div className="px-3.5 pb-3 pt-4">
        <div className="flex items-center gap-3">
          <img
            src="/icon.png"
            alt=""
            aria-hidden
            className="size-12 shrink-0 rounded-[14px] ring-1 ring-[rgb(255_255_255/0.12)] shadow-[0_10px_26px_rgb(0_0_0/0.5)]"
          />
          <div className="min-w-0">
            <div className="flex items-baseline gap-2">
              <span className="truncate text-[15px] font-semibold text-txt">QuotaCards</span>
              {version && <span className="shrink-0 text-[10.5px] text-txt3">v{version}</span>}
            </div>
            <div className="mt-1 flex items-center gap-1.5 text-[11.5px] text-txt3">
              <span
                aria-hidden
                className={cn(
                  "size-1.5 rounded-full",
                  state === "connected" && "bg-[var(--green)]",
                  state === "working" && "pulse-dot bg-[var(--brand)]",
                  state === "connecting" && "pulse-dot bg-[var(--amber)]",
                  state === "ready" && "bg-txt3",
                )}
              />
              <span className="truncate">{stateLabel}</span>
            </div>
          </div>
        </div>

        {/* the card this app is set to spend from */}
        {card && (
          <button
            type="button"
            onClick={() => onTab("cards")}
            title={card.name}
            className="glass-tile mt-3 w-full rounded-[12px] px-2.5 py-2 text-start transition-colors hover:bg-white/[0.03]"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="truncate text-[12px] font-medium text-txt">{card.name.split(" (")[0]}</span>
              <span className="shrink-0 rounded-full border border-line-strong px-1.5 py-[1px] text-[10px] text-txt3">
                {card.card_type}
              </span>
            </div>
            <div className="mt-0.5 truncate text-[11px] text-txt3">{card.sni}</div>
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
              className="mt-2 flex w-full items-center gap-2 rounded-[12px] border border-[var(--brand-line)] bg-[var(--brand-bg)] px-2.5 py-2 text-start transition-colors hover:border-[var(--brand)]"
            >
              <span className="relative grid size-4 shrink-0 place-items-center" aria-hidden>
                <span className="soft-ping absolute inset-0 rounded-full bg-[var(--brand)]" />
                <ArrowDownToLine className="relative size-3.5 text-brand-strong" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[11.5px] font-medium text-brand-strong">
                  {t("updRemind")} · v{update.latest}
                </span>
                <span className="block truncate text-[10.5px] text-txt3">{t("updRemindSub")}</span>
              </span>
            </motion.button>
          )}
        </AnimatePresence>
      </div>

      <nav className="mt-1.5 flex flex-col gap-1 px-2.5" aria-label="Main">
        {PRIMARY.map(({ id, icon: Icon, key }) => {
          const active = tab === id || (id === "home" && tab === "apps")
          return (
            <button
              key={id}
              onClick={() => onTab(id)}
              aria-current={active ? "page" : undefined}
              className={cn(
                "relative flex h-10 items-center gap-3 rounded-[12px] px-3.5 text-[13.5px] outline-none transition-colors",
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
              <Icon className="size-[18px] shrink-0" strokeWidth={1.75} aria-hidden />
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
          <SettingsIcon className="size-[18px] shrink-0" strokeWidth={1.75} aria-hidden />
          <span>{t("tabSettings")}</span>
        </button>
      </div>
    </aside>
  )
}
