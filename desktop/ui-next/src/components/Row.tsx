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
        "flex gap-4 border-b border-line px-4 py-3 last:border-b-0",
        align === "center" ? "items-center" : "items-start",
      )}
    >
      <div className="w-[148px] shrink-0 pt-[7px] text-[12.5px] text-txt2">{label}</div>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  )
}

export function Panel({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("overflow-hidden rounded-[16px] border bg-card", className)}>{children}</div>
}

export function GroupLabel({ children }: { children: ReactNode }) {
  return <div className="px-1 pb-2 text-[11px] font-medium tracking-[0.07em] text-txt3 uppercase">{children}</div>
}

export function PageTitle({ children, sub }: { children: ReactNode; sub?: string }) {
  return (
    <div className="px-1">
      <h1 className="text-[15px] font-semibold text-txt">{children}</h1>
      {sub && <p className="mt-0.5 text-[12.5px] text-txt3">{sub}</p>}
    </div>
  )
}
