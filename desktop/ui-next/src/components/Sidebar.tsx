import { motion } from "motion/react"
import { CreditCard, Gauge, Home, Settings as SettingsIcon } from "lucide-react"
import { cn } from "@/lib/utils"
import { useI18n, type StrKey } from "@/lib/i18n"
import { useApp } from "@/state/app"

export type Tab = "home" | "cards" | "speed" | "apps" | "settings"

const PRIMARY: Array<{ id: Tab; icon: typeof Home; key: StrKey }> = [
  { id: "home", icon: Home, key: "tabHome" },
  { id: "cards", icon: CreditCard, key: "tabCards" },
  { id: "speed", icon: Gauge, key: "tabSpeed" },
]

export function Sidebar({ tab, onTab }: { tab: Tab; onTab: (t: Tab) => void }) {
  const { t } = useI18n()
  const { vpnOn, connected, busy } = useApp()

  const state = busy ? "working" : connected ? "connected" : vpnOn ? "connecting" : "ready"

  return (
    <aside className="flex w-[216px] shrink-0 flex-col border-e border-line">
      <div className="flex items-center gap-2.5 px-4 pt-4 pb-3">
        <img src="/icon.png" alt="" aria-hidden className="size-7 rounded-[8px]" />
        <div className="min-w-0">
          <div className="truncate text-[13px] font-semibold text-txt">QuotaCards</div>
          <div className="mt-0.5 flex items-center gap-1.5 text-[11.5px] text-txt3">
            <span
              className={cn(
                "size-1.5 rounded-full",
                state === "connected" && "bg-[var(--green)]",
                state === "working" && "pulse-dot bg-[var(--brand)]",
                state === "connecting" && "pulse-dot bg-[var(--amber)]",
                state === "ready" && "bg-txt3",
              )}
              aria-hidden
            />
            <span className="truncate">
              {state === "connected"
                ? t("vpnConnected")
                : state === "working"
                  ? t("working")
                  : state === "connecting"
                    ? t("connecting")
                    : t("ready")}
            </span>
          </div>
        </div>
      </div>

      <nav className="mt-1 flex flex-col gap-0.5 px-2" aria-label="Main">
        {PRIMARY.map(({ id, icon: Icon, key }) => {
          const active = tab === id || (id === "home" && tab === "apps")
          return (
            <button
              key={id}
              onClick={() => onTab(id)}
              aria-current={active ? "page" : undefined}
              className={cn(
                "relative flex h-9 items-center gap-2.5 rounded-[10px] px-3 text-[13px] outline-none transition-colors",
                active
                  ? "bg-white/[0.05] font-medium text-txt"
                  : "text-txt2 hover:bg-white/[0.035] hover:text-txt",
              )}
            >
              {active && (
                <motion.span
                  layoutId="nav-accent"
                  className="absolute inset-y-[7px] start-[-8px] w-[2px] rounded-full bg-brand"
                  transition={{ type: "spring", stiffness: 520, damping: 40 }}
                />
              )}
              <Icon className="size-4 shrink-0" strokeWidth={1.75} aria-hidden />
              <span className="truncate">{t(key)}</span>
            </button>
          )
        })}
      </nav>

      <div className="mt-auto flex flex-col gap-0.5 p-2">
        <button
          onClick={() => onTab("settings")}
          aria-current={tab === "settings" ? "page" : undefined}
          className={cn(
            "relative flex h-9 items-center gap-2.5 rounded-[10px] px-3 text-[13px] transition-colors",
            tab === "settings"
              ? "bg-white/[0.05] font-medium text-txt"
              : "text-txt2 hover:bg-white/[0.035] hover:text-txt",
          )}
        >
          {tab === "settings" && (
            <motion.span
              layoutId="nav-accent"
              className="absolute inset-y-[7px] start-[-8px] w-[2px] rounded-full bg-brand"
              transition={{ type: "spring", stiffness: 520, damping: 40 }}
            />
          )}
          <SettingsIcon className="size-4 shrink-0" strokeWidth={1.75} aria-hidden />
          <span>{t("tabSettings")}</span>
        </button>
      </div>
    </aside>
  )
}
