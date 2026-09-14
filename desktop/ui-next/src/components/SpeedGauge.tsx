import { useEffect, useRef, useState } from "react"
import { animate, motion } from "motion/react"

export type GaugePhase = "idle" | "ping" | "download" | "upload" | "done"

const TICKS = [0, 1, 5, 10, 25, 50, 100, 250, 500, 1000]
const MAX = 1000
const START = 135
const SWEEP = 270
const SIZE = 264
const C = SIZE / 2
const R = 104

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
 * The speed circle: a custom SVG arc on a log scale (0 … 1 Gbps) with the
 * arc and the numeral both driven by Motion, so neither jumps when a sample
 * lands. No speedometer library, no needle.
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
      duration: phase === "idle" ? 0.35 : 0.55,
      ease: [0.1, 0.9, 0.2, 1],
      onUpdate: (v) => setShown(v),
      onComplete: () => {
        from.current = value
      },
    })
    return () => controls.stop()
  }, [value, phase])

  const f = toFrac(value)
  const colour =
    phase === "upload" ? "#63a8bb" : phase === "ping" ? "var(--amber)" : phase === "idle" ? "var(--line-strong)" : "var(--brand)"
  const shownText = unit === "ms" ? shown.toFixed(0) : shown >= 100 ? shown.toFixed(0) : shown >= 10 ? shown.toFixed(1) : shown.toFixed(2)

  return (
    <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="size-[264px]" role="img" aria-label={`${shownText} ${unit}`}>
      <path d={arcPath(R, 0, 1)} stroke="var(--line)" strokeWidth="10" fill="none" strokeLinecap="round" />
      <motion.path
        d={arcPath(R, 0, 1)}
        pathLength={1}
        stroke={colour}
        strokeWidth="10"
        fill="none"
        strokeLinecap="round"
        initial={false}
        animate={{ pathLength: f }}
        transition={{ duration: phase === "idle" ? 0.35 : 0.55, ease: [0.1, 0.9, 0.2, 1] }}
      />
      {TICKS.map((tick) => {
        const tf = toFrac(tick)
        const a = START + tf * SWEEP
        const [x0, y0] = polar(R - 16, a)
        const [x1, y1] = polar(R - 7, a)
        const [tx, ty] = polar(R - 26, a)
        const lit = value >= tick && value > 0
        return (
          <g key={tick}>
            <line
              x1={x0}
              y1={y0}
              x2={x1}
              y2={y1}
              stroke={lit ? "var(--brand-line)" : "var(--line)"}
              strokeWidth="1.5"
            />
            <text
              x={tx}
              y={ty + 3.5}
              textAnchor="middle"
              fontSize="10.5"
              fill={lit ? "var(--txt2)" : "var(--txt3)"}
            >
              {tick >= 1000 ? "1k" : tick}
            </text>
          </g>
        )
      })}
      <text x={C} y={C - 4} textAnchor="middle" fontSize="40" fontWeight="600" fill="var(--txt)" letterSpacing="-0.02em">
        {shownText}
      </text>
      <text x={C} y={C + 18} textAnchor="middle" fontSize="12" fill="var(--txt3)">
        {unit}
      </text>
      <text x={C} y={C + 42} textAnchor="middle" fontSize="11.5" fill="var(--txt2)">
        {caption}
      </text>
    </svg>
  )
}
