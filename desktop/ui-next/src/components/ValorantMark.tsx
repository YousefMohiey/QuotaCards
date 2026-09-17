// The Valorant mark, shipped as a public asset and applied as a CSS mask so it
// takes currentColor exactly like the stroke icons around it.
const mask = {
  WebkitMaskImage: "url(/valorant.png)",
  WebkitMaskSize: "contain",
  WebkitMaskRepeat: "no-repeat",
  WebkitMaskPosition: "center",
  maskImage: "url(/valorant.png)",
  maskSize: "contain",
  maskRepeat: "no-repeat",
  maskPosition: "center",
} as const

export function ValorantMark({ className }: { className?: string; strokeWidth?: number; "aria-hidden"?: boolean }) {
  return <span aria-hidden className={`inline-block bg-current ${className ?? ""}`} style={mask} />
}
