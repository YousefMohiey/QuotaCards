// A small angular V mark for the Valorant page, drawn to sit beside the
// stroke icons at the same optical weight. Inherits currentColor.
export function ValorantMark({ className }: { className?: string; strokeWidth?: number; "aria-hidden"?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden className={className}>
      <path d="M2.6 3.4h5.1c.4 0 .8.24.96.62l3.34 8.06 3.34-8.06c.16-.38.55-.62.96-.62h5.1L12 21.2 2.6 3.4Z" />
    </svg>
  )
}
