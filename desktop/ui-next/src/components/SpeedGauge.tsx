import { useEffect, useRef, useState } from "react"
import { animate, motion } from "motion/react"

export type GaugePhase = "idle" | "ping" | "download" | "upload" | "done"

const TICKS = [0, 5, 10, 50, 100, 250, 500, 750, 1000]
const MAX = 1000
const START = 135
const SWEEP = 270
const SIZE = 320
const C = SIZE / 2
const R = 132
const STROKE = 8

const toFrac = (v: number) => Math.log10(1 + Math.min(Math.max(v, 0), MAX)) / Math.log10(1 + MAX)

function polar(r: number, deg: number): [number, number] {
  const a = (deg * Math.PI) / 180
  return [C + r * Math.cos(a), C + r * Math.sin(a)]
}

function arcPath(r: number, f0: number, f1: number): string {
  const a0 = START + f0 * SWEEP
  const a1 = START + f1 * SWEEP
  const [x0, y0] = polar(r, a0)
  const [x1, y1] = polar(r, a1)
  const large = (f1 - f0) * SWEEP > 180 ? 1 : 0
  return `M ${x0.toFixed(2)} ${y0.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`
}

/**
 * Thin 270 degree dial: hairline track, one accent arc, tapered needle and a
 * light numeral. Both arc and needle are Motion-driven; the number counts
 * with them so a new sample never snaps.
 */
export function SpeedGauge({
  value,
  unit,
  phase,
  caption,
}: {
  value: number
  unit: string
  phase: GaugePhase
  caption: string
}) {
  const [shown, setShown] = useState(0)
  const from = useRef(0)

  useEffect(() => {
    const controls = animate(from.current, value, {
      duration: phase === "idle" ? 0.35 : 0.5,
      ease: [0.1, 0.9, 0.2, 1],
      onUpdate: (v) => setShown(v),
      onComplete: () => {
        from.current = value
      },
    })
    return () => controls.stop()
  }, [value, phase])

  const f = toFrac(value)
  const angle = -135 + f * SWEEP
  const accent = phase === "upload" ? "#63a8bb" : phase === "ping" ? "var(--amber)" : "var(--brand)"
  const shownText =
    unit === "ms" ? shown.toFixed(0) : shown >= 100 ? shown.toFixed(0) : shown >= 10 ? shown.toFixed(1) : shown.toFixed(2)

  return (
    <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="size-[320px]" role="img" aria-label={`${shownText} ${unit}`}>
      <defs>
        <linearGradient id="needle" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#5b6070" />
          <stop offset="100%" stopColor="#3a3f4d" />
        </linearGradient>
      </defs>

      <path d={arcPath(R, 0, 1)} stroke="var(--line-strong)" strokeWidth={STROKE} fill="none" strokeLinecap="round" />
      <motion.path
        d={arcPath(R, 0, 1)}
        pathLength={1}
        stroke={accent}
        strokeWidth={STROKE}
        fill="none"
        strokeLinecap="round"
        initial={{ pathLength: 0 }}
        animate={{ pathLength: f }}
        transition={{ duration: phase === "idle" ? 0.35 : 0.5, ease: [0.1, 0.9, 0.2, 1] }}
      />

      {TICKS.map((tick) => {
        const tf = toFrac(tick)
        const a = START + tf * SWEEP
        const [tx, ty] = polar(R - 30, a)
        const lit = value >= tick && value > 0
        return (
          <text
            key={tick}
            x={tx}
            y={ty + 4}
            textAnchor="middle"
            fontSize="12"
            fontWeight="500"
            fill={lit ? "var(--txt2)" : "var(--txt3)"}
          >
            {tick >= 1000 ? "1000" : tick}
          </text>
        )
      })}

      <motion.g
        style={{ transformOrigin: `${C}px ${C}px` }}
        initial={{ rotate: -135 }}
        animate={{ rotate: angle }}
        transition={{ duration: phase === "idle" ? 0.35 : 0.5, ease: [0.1, 0.9, 0.2, 1] }}
      >
        <polygon points={`${C - 3},${C} ${C},${C - (R - 18)} ${C + 3},${C}`} fill="url(#needle)" />
        <circle cx={C} cy={C} r="7" fill="#2a2f3c" stroke="var(--line-strong)" strokeWidth="1" />
      </motion.g>

      <text x={C} y={C + 62} textAnchor="middle" fontSize="46" fontWeight="300" fill="var(--txt)" letterSpacing="0.02em">
        {shownText}
      </text>
      <g transform={`translate(${C - 34}, ${C + 84})`}>
        <circle cx="7" cy="7" r="7" fill={value > 0 ? "var(--brand)" : "var(--line-strong)"} />
        <path
          d="M4 7.4l2 2 3.6-3.9"
          fill="none"
          stroke="#08111f"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <text x="20" y="11" fontSize="13" fill="var(--txt)">
          {unit}
        </text>
      </g>
      <text x={C} y={C + 112} textAnchor="middle" fontSize="12.5" fill="var(--txt3)">
        {caption}
      </text>
    </svg>
  )
}

/** Five thin stars: how the measured numbers rate for a given use. */
export function Stars({ score }: { score: number }) {
  return (
    <div className="flex items-center gap-[3px]">
      {[1, 2, 3, 4, 5].map((n) => (
        <Star key={n} on={n <= score} />
      ))}
    </div>
  )
}

function Star({ on }: { on: boolean }) {
  return (
    <svg viewBox="0 0 24 24" className="size-[11px]" aria-hidden>
      <path
        d="M12 3.6l2.6 5.3 5.8.8-4.2 4.1 1 5.8-5.2-2.8-5.2 2.8 1-5.8L3.6 9.7l5.8-.8z"
        fill={on ? "var(--txt)" : "none"}
        stroke={on ? "var(--txt)" : "var(--txt3)"}
        strokeWidth={on ? 0.6 : 1.1}
      />
    </svg>
  )
}
