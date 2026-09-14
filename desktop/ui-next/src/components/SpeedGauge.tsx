import { useEffect, useRef, useState } from "react"
import { animate } from "motion/react"

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
 * Thin 270 degree dial. The needle is drawn as a segment whose endpoint is
 * computed from the angle, so it needs no transform at all: whatever the
 * animated value is, the needle points exactly at that fraction of the scale
 * and the numeral reads the same number. Nothing can drift apart.
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
      duration: 0.28,
      ease: [0.12, 0.9, 0.2, 1],
      onUpdate: (v) => setShown(v),
      onComplete: () => {
        from.current = value
      },
    })
    return () => controls.stop()
  }, [value])

  const f = toFrac(shown)
  const accent = phase === "upload" ? "#63a8bb" : phase === "ping" ? "var(--amber)" : "var(--brand)"
  const shownText =
    unit === "ms" ? shown.toFixed(0) : shown >= 100 ? shown.toFixed(0) : shown >= 10 ? shown.toFixed(1) : shown.toFixed(2)
  const [tipX, tipY] = polar(R - 20, START + f * SWEEP)

  return (
    <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="size-[320px]" role="img" aria-label={`${shownText} ${unit}`}>
      <defs>
        <linearGradient id="needle" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#5b6070" />
          <stop offset="100%" stopColor="#3a3f4d" />
        </linearGradient>
      </defs>

      <path d={arcPath(R, 0, 1)} stroke="var(--line-strong)" strokeWidth={STROKE} fill="none" strokeLinecap="round" />
      <path
        d={arcPath(R, 0, f)}
        stroke={accent}
        strokeWidth={STROKE}
        fill="none"
        strokeLinecap="round"
      />

      {TICKS.map((tick) => {
        const a = START + toFrac(tick) * SWEEP
        const [tx, ty] = polar(R - 30, a)
        const lit = shown >= tick && shown > 0
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
            {tick}
          </text>
        )
      })}

      <line x1={C} y1={C} x2={tipX} y2={tipY} stroke="url(#needle)" strokeWidth="3" strokeLinecap="round" />
      <circle cx={C} cy={C} r="7" fill="#2a2f3c" stroke="var(--line-strong)" strokeWidth="1" />

      <text x={C} y={C + 62} textAnchor="middle" fontSize="46" fontWeight="300" fill="var(--txt)" letterSpacing="0.02em">
        {shownText}
      </text>
      <g transform={`translate(${C - 34}, ${C + 84})`}>
        <circle cx="7" cy="7" r="7" fill={shown > 0 ? "var(--brand)" : "var(--line-strong)"} />
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
