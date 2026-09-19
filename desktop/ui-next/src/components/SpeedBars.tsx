import { useMemo } from "react"

const BARS = 48

/**
 * The run's own shape: one thin bar per sample, filling from the LEFT as
 * the run goes (newest sample at the right end once the field is full).
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
  // Newest at the right, empty slots padded on the right so the first
  // seconds fill left-to-right like a scale, never from the right edge.
  const view = useMemo(() => {
    const tail = samples.slice(-BARS)
    return tail.length >= BARS ? tail : [...tail, ...new Array(BARS - tail.length).fill(0)]
  }, [samples])

  // One paint per frame at most is handled by the sample throttle upstream;
  // deriving straight from the prop keeps every bar in step with the readout.
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
