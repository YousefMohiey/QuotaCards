import { useEffect, useMemo, useRef, useState } from "react"
import { AnimatePresence, motion } from "motion/react"
import { cn } from "@/lib/utils"
import { useI18n } from "@/lib/i18n"
import { useApp } from "@/state/app"
import { Dial, type DialState } from "./Dial"
import { displayHost, fmtBytes, fmtDuration } from "@/lib/format"

const EASE_OUT = [0.1, 0.9, 0.2, 1] as const
const SPRING = { type: "spring", stiffness: 320, damping: 34 } as const

/** A one-second heartbeat for the session clock; polling still drives data. */
function useTick(ms: number, on: boolean) {
  const [, set] = useState(0)
  useEffect(() => {
    if (!on) return
    const id = window.setInterval(() => set((n) => n + 1), ms)
    return () => window.clearInterval(id)
  }, [ms, on])
}

export function Hero() {
  const { t } = useI18n()
  const { vpnOn, connected, busy, toggle, card, rx, tx, sessionStart, serverIp } = useApp()

  // The dial parks left from the moment Connect is pressed, not when the
  // tunnel finishes: a slow connect must not look like a dead button.
  const active = vpnOn || busy
  const state: DialState = vpnOn && connected ? "on" : vpnOn || busy ? "connecting" : "idle"
  const name = card?.name.split(" (")[0] ?? ""

  useTick(1000, connected)

  return (
    <section className="rounded-[16px] border bg-card p-6">
      <div className="flex min-h-[214px] items-center">
        <motion.div
          layout
          transition={SPRING}
          className={cn("flex w-full items-center", active ? "justify-start gap-8" : "justify-center")}
        >
          <motion.div layout transition={SPRING} className="shrink-0 text-center">
            <Dial state={state} onClick={toggle} disabled={busy} />
            <div className="mt-3 max-w-[190px] truncate text-[12.5px] text-txt2">{name}</div>
          </motion.div>

          <AnimatePresence mode="popLayout">
            {active && (
              <motion.div
                key="info"
                initial={{ opacity: 0, x: 16 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 12 }}
                transition={{ duration: 0.32, ease: EASE_OUT, delay: 0.06 }}
                className="min-w-0 flex-1"
              >
                <div className="flex items-center gap-2">
                  <span
                    aria-hidden
                    className={cn(
                      "size-1.5 rounded-full",
                      connected ? "bg-[var(--green)]" : "pulse-dot bg-[var(--brand)]",
                    )}
                  />
                  <span className="text-[12.5px] text-txt2">
                    {connected ? t("connected") : vpnOn ? t("connecting") : t("working")}
                  </span>
                  {card && (
                    <span className="rounded-full border border-line-strong px-2 py-[3px] text-[11px] text-txt3">
                      {card.card_type}
                    </span>
                  )}
                </div>

                <h1 className="mt-2 truncate text-[22px] font-semibold tracking-[-0.01em] text-txt">{name}</h1>
                <p className="mt-1 truncate text-[12.5px] text-txt3">
                  {connected ? displayHost(card?.sni) : t("talking")}
                </p>

                <AnimatePresence>
                  {connected && (
                    <motion.div
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.36, ease: EASE_OUT, delay: 0.12 }}
                    >
                      <Traffic rx={rx} tx={tx} />
                      <div className="mt-3 grid grid-cols-3 gap-2">
                        <StatTile
                          label={t("sessLabel")}
                          value={sessionStart ? fmtDuration((Date.now() - sessionStart) / 1000) : "-"}
                          sub={"↓ " + fmtBytes(rx) + "   ↑ " + fmtBytes(tx)}
                        />
                        <StatTile label={t("yourIp")} value={displayHost(serverIp)} />
                        <StatTile label={t("serverLabel")} value={displayHost(card?.sni)} />
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      </div>
    </section>
  )
}

function StatTile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-[12px] border border-line bg-white/[0.02] px-3 py-2.5">
      <div className="text-[11px] text-txt3">{label}</div>
      <div className="mt-1 truncate text-[13px] font-medium text-txt">{value}</div>
      {sub && <div className="mt-0.5 truncate text-[11.5px] text-txt3">{sub}</div>}
    </div>
  )
}

/** Live rate + rolling sparkline from the adapter counters. */
function Traffic({ rx, tx }: { rx: number; tx: number }) {
  const { t } = useI18n()
  const hist = useRef<number[]>([])
  const last = useRef({ rx: 0, tx: 0, t: Date.now() })

  useEffect(() => {
    const now = Date.now()
    const dt = Math.max(0.2, (now - last.current.t) / 1000)
    const delta = Math.max(0, rx - last.current.rx) + Math.max(0, tx - last.current.tx)
    last.current = { rx, tx, t: now }
    if (last.current.rx || last.current.tx) {
      hist.current = [...hist.current.slice(-59), delta / dt]
    }
  }, [rx, tx])

  const { line, area, rate } = useMemo(() => {
    const values = hist.current.length ? hist.current : [0, 0]
    const peak = Math.max(1, ...values)
    const w = 260
    const h = 44
    const step = w / Math.max(1, values.length - 1)
    const pts = values.map((v, i) => [i * step, h - (v / peak) * (h - 8) - 3] as const)
    const d = pts
      .map(([x, y], i) => `${i ? "L" : "M"} ${x.toFixed(1)} ${y.toFixed(1)}`)
      .join(" ")
    const current = values[values.length - 1] || 0
    return {
      line: d,
      area: `${d} L ${w} ${h} L 0 ${h} Z`,
      rate: current > 0 ? fmtBytes(current) + "/s" : "-",
    }
  }, [rx, tx])

  return (
    <div className="mt-4">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[11.5px] tracking-[0.04em] text-txt3">{t("liveLabel")}</span>
        <span className="text-[12.5px] text-txt2">{rate}</span>
      </div>
      <svg viewBox="0 0 260 44" preserveAspectRatio="none" className="mt-1 h-[44px] w-full" aria-hidden>
        <path d={area} fill="var(--brand-bg)" />
        <path
          d={line}
          fill="none"
          stroke="var(--brand)"
          strokeWidth="1.6"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      </svg>
    </div>
  )
}
