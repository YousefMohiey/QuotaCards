import { useEffect, useRef, useState } from "react"
import { animate } from "motion/react"

export type RunPhase = "idle" | "ping" | "download" | "upload" | "done"

const SIZE = 248
const C = SIZE / 2
const R = 104
const TRACK = 3.5
const BAR = 4.5
const CIRC = 2 * Math.PI * R

const fmt = (v: number, unit: string) =>
  unit === "ms" ? String(Math.round(v)) : v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v.toFixed(2)

/**
 * One thin ring, one number. Nothing else competes: the ring is how far the
 * current phase has got, the number is what it is reading right now. The
 * number tweens between samples so a jumpy link still reads smoothly.
 */
export function SpeedRing({
  value,
  unit,
  caption,
  phase,
  progress,
}: {
  value: number
  unit: string
  caption: string
  phase: RunPhase
  progress: number
}) {
  const [shown, setShown] = useState(0)
  const from = useRef(0)

  useEffect(() => {
    const controls = animate(from.current, value, {
      duration: 0.28,
      ease: [0.12, 0.9, 0.2, 1],
      onUpdate: (v) => setShown(v),
      onComplete: () => {
        from.current = value
      },
    })
    return () => controls.stop()
  }, [value])

  const accent = phase === "upload" ? "var(--cyan)" : phase === "ping" ? "var(--amber)" : "var(--brand)"
  const p = Math.min(Math.max(progress, 0), 1)
  const measuring = phase === "ping" || phase === "download" || phase === "upload"

  return (
    <div className="relative grid place-items-center" style={{ width: SIZE, height: SIZE }}>
      <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} className="-rotate-90" aria-hidden>
        <circle cx={C} cy={C} r={R} fill="none" stroke="rgb(255 255 255 / 0.08)" strokeWidth={TRACK} />
        <circle
          cx={C}
          cy={C}
          r={R}
          fill="none"
          stroke={accent}
          strokeWidth={BAR}
          strokeLinecap="round"
          strokeDasharray={CIRC}
          strokeDashoffset={CIRC * (1 - p)}
          style={{ transition: "stroke-dashoffset 0.24s linear, stroke 0.3s ease" }}
        />
      </svg>

      <div className="absolute inset-0 grid place-items-center">
        <div className="flex flex-col items-center">
          <div
            className="text-[60px] leading-none font-light tabular-nums text-txt"
            style={{ letterSpacing: "-0.02em" }}
            role="status"
            aria-live="polite"
            aria-label={`${fmt(shown, unit)} ${unit}`}
          >
            {fmt(shown, unit)}
          </div>
          <div className="mt-2 text-[12.5px] text-txt3">
            {unit} · {caption}
          </div>
          {measuring && (
            <span
              aria-hidden
              className="mt-3 h-[3px] w-[54px] overflow-hidden rounded-full bg-white/[0.07]"
            >
              <span
                className="block h-full rounded-full"
                style={{ width: `${Math.round(p * 100)}%`, background: accent, transition: "width 0.24s linear" }}
              />
            </span>
          )}
        </div>
      </div>
    </div>
  )
}
