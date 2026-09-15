import { useEffect, useRef, useState } from "react"
import { animate } from "motion/react"

export type GaugePhase = "idle" | "ping" | "download" | "upload" | "done"

const START = 135
const SWEEP = 270
const SIZE = 320
const C = SIZE / 2
const R = 130
const STROKE = 15

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

const fmt = (v: number, unit: string) =>
  unit === "ms" ? String(Math.round(v)) : v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v.toFixed(2)

const fmtTick = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(v < 10 ? 1 : 0))

/**
 * Linear dial with a rescaling ceiling: the dial always fills with whatever
 * the connection actually does, instead of squeezing real numbers into a fixed
 * range. The needle is a line whose endpoint is computed from the angle, so it
 * cannot drift away from the number above it.
 */
export function SpeedGauge({
  value,
  unit,
  phase,
  caption,
  ceiling,
}: {
  value: number
  unit: string
  phase: GaugePhase
  caption: string
  ceiling: number
}) {
  const [shown, setShown] = useState(0)
  const from = useRef(0)

  useEffect(() => {
    const controls = animate(from.current, value, {
      duration: 0.26,
      ease: [0.12, 0.9, 0.2, 1],
      onUpdate: (v) => setShown(v),
      onComplete: () => {
        from.current = value
      },
    })
    return () => controls.stop()
  }, [value])

  const f = ceiling > 0 ? Math.min(Math.max(shown / ceiling, 0), 1) : 0
  const accent = phase === "upload" ? "#63a8bb" : phase === "ping" ? "var(--amber)" : "var(--brand)"
  const [tipX, tipY] = polar(R - 26, START + f * SWEEP)

  // quarter labels + an unlabeled minor tick between each pair
  const ticks = [0, 1, 2, 3, 4].map((i) => (ceiling * i) / 4)
  const minors = [0.5, 1.5, 2.5, 3.5].map((i) => (ceiling * i) / 4)

  return (
    <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="size-[320px]" role="img" aria-label={`${fmt(shown, unit)} ${unit}`}>
      <defs>
        <linearGradient id="needle" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#666b7b" />
          <stop offset="100%" stopColor="#3a3f4d" />
        </linearGradient>
      </defs>

      <path d={arcPath(R, 0, 1)} stroke="rgb(255 255 255 / 0.09)" strokeWidth={STROKE} fill="none" strokeLinecap="round" />
      <path d={arcPath(R, 0, f)} stroke={accent} strokeWidth={STROKE} fill="none" strokeLinecap="round" />

      {minors.map((t) => {
        const [x, y] = polar(R - 19, START + (t / ceiling) * SWEEP)
        return <circle key={t} cx={x} cy={y} r="1.7" fill="rgb(255 255 255 / 0.22)" />
      })}

      {ticks.map((t) => {
        const [tx, ty] = polar(R - 44, START + (t / ceiling) * SWEEP)
        const lit = shown >= t && shown > 0
        return (
          <text
            key={t}
            x={tx}
            y={ty + 4}
            textAnchor="middle"
            fontSize="11.5"
            fontWeight="500"
            fill={lit ? "var(--txt2)" : "var(--txt3)"}
          >
            {fmtTick(t)}
          </text>
        )
      })}

      <line x1={C} y1={C} x2={tipX} y2={tipY} stroke="url(#needle)" strokeWidth="3" strokeLinecap="round" />
      <circle cx={C} cy={C} r="7" fill="#2a2f3c" stroke="rgb(255 255 255 / 0.16)" strokeWidth="1" />

      <text x={C} y={C + 58} textAnchor="middle" fontSize="46" fontWeight="300" fill="var(--txt)" letterSpacing="0.02em">
        {fmt(shown, unit)}
      </text>
      <text x={C} y={C + 84} textAnchor="middle" fontSize="12.5" fill="var(--txt3)">
        {unit} · {caption}
      </text>
    </svg>
  )
}
