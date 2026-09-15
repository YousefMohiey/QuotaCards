import type { ReactNode } from "react"
import { cn } from "@/lib/utils"

/** One settings row: fixed label column, control that fills the rest. */
export function Row({
  label,
  children,
  align = "center",
}: {
  label: string
  children: ReactNode
  align?: "center" | "start"
}) {
  return (
    <div
      className={cn(
        "flex gap-4 px-[var(--pad-card)] py-3",
        align === "center" ? "items-center" : "items-start",
      )}
    >
      <div className="w-[136px] shrink-0 pt-[7px] text-[12.5px] text-txt2">{label}</div>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  )
}

/** The standard content card. One border, one radius, one shadow, no nesting. */
export function Panel({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("glass pane overflow-hidden", className)}>{children}</div>
}

/** Rows inside a Panel sit on hairlines, never on their own frames. */
export function Rows({ children }: { children: ReactNode }) {
  return <div className="flex flex-col">{children}</div>
}

export function GroupLabel({ children }: { children: ReactNode }) {
  return <div className="px-1 pb-1.5 text-[10.5px] font-medium tracking-[0.07em] text-txt3 uppercase">{children}</div>
}

/** Every page opens with the same heading block. */
export function PageTitle({ children, sub }: { children: ReactNode; sub?: string }) {
  return (
    <div className="page-head">
      <div className="min-w-0">
        <h1 className="page-title truncate">{children}</h1>
        {sub && <p className="page-sub truncate">{sub}</p>}
      </div>
    </div>
  )
}
