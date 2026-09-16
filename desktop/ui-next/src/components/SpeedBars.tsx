import { useEffect, useRef, useState } from "react"

const BARS = 48

/**
 * The run's own shape: one thin bar per sample, growing as the test goes.
 * Idle it is a flat row of dashes; during a run it is alive; when the run
 * ends it stays put as the fingerprint of that connection.
 */
export function SpeedBars({
  samples,
  accent,
  active,
}: {
  samples: number[]
  accent: string
  active: boolean
}) {
  const [view, setView] = useState<number[]>(() => new Array(BARS).fill(0))
  const raf = useRef(0)

  useEffect(() => {
    // One paint per frame at most: a burst of samples must not queue renders.
    cancelAnimationFrame(raf.current)
    raf.current = requestAnimationFrame(() => {
      setView((prev) => {
        const next = [...prev, ...samples.slice(-BARS)]
        return next.slice(-BARS)
      })
    })
    return () => cancelAnimationFrame(raf.current)
  }, [samples])

  const max = Math.max(1, ...view)
  const any = view.some((v) => v > 0)
  const height = view.map((v) => (v === 0 ? "2px" : `${Math.max(8, (v / max) * 100)}%`))
  const t = view.map((v) => v / max)

  return (
    <div className="relative">
      <div
        className="flex h-[96px] items-end gap-[3px]"
        role="img"
        aria-label={active ? "live throughput" : "last run shape"}
      >
        {/* Nothing measured yet: an empty scale with its hairline reads as
            intent, a row of stubs reads as a broken graph. */}
        {any &&
          view.map((v, i) => (
            <span
              key={i}
              className="flex-1 rounded-t-[3px]"
              style={{
                height: height[i],
                background: `color-mix(in oklab, ${accent} ${Math.round(18 + t[i] * 62)}%, rgb(255 255 255 / 0.10))`,
                opacity: v === 0 ? 0.28 : i === view.length - 1 && active ? 1 : 0.92,
                transition: "height 140ms linear, background 200ms linear",
              }}
            />
          ))}
      </div>
      {/* baseline: without it the row of bars reads as decoration, not a scale */}
      <div className="mt-1 h-px w-full bg-[rgb(255_255_255/0.10)]" />
    </div>
  )
}
