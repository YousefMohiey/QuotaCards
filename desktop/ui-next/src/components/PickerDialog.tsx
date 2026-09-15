import { useMemo, useState, type ReactNode } from "react"
import { Check, Search } from "lucide-react"
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"

export type PickerItem = { value: string; label: string; sub?: string }

/**
 * The list picker from the 0.2.x sheets: search on top, plain rows, a check on
 * the one in use. Used for the domain choice, the ping target and the profile,
 * so all three read exactly like the picker that was already there.
 */
export function PickerDialog({
  open,
  onOpenChange,
  title,
  search,
  items,
  value,
  onPick,
  children,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  title: string
  search: string
  items: PickerItem[]
  value: string
  onPick: (v: string) => void
  children?: ReactNode
}) {
  const [q, setQ] = useState("")

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase()
    if (!s) return items
    return items.filter((i) => `${i.label} ${i.sub ?? ""}`.toLowerCase().includes(s))
  }, [items, q])

  const close = (o: boolean) => {
    onOpenChange(o)
    if (!o) setQ("")
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-w-[380px] gap-0 overflow-hidden rounded-[var(--r-modal)] p-0">
        <div className="px-4 pb-3 pt-3.5">
          <DialogTitle className="text-[13.5px] font-semibold text-txt">{title}</DialogTitle>
          <div className="relative mt-2.5">
            <Search className="absolute start-2.5 top-1/2 size-3.5 -translate-y-1/2 text-txt3" aria-hidden />
            <Input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={search}
              aria-label={search}
              className="h-[var(--ctl-h-sm)] rounded-[var(--r-ctl)] border-line bg-white/[0.02] ps-8 text-[12.5px]"
            />
          </div>
        </div>

        <div className="max-h-[340px] overflow-y-auto border-t border-line px-1.5 py-2">
          {filtered.map((it) => {
            const on = it.value === value
            return (
              <button
                key={it.value}
                type="button"
                role="option"
                aria-selected={on}
                onClick={() => {
                  onPick(it.value)
                  close(false)
                }}
                className={cn(
                  "flex h-[44px] w-full items-center gap-3 rounded-[var(--r-ctl)] px-2.5 text-start transition-colors duration-[var(--t-fast)] hover:bg-white/[0.035]",
                  on && "bg-[var(--brand-bg)] ring-1 ring-[var(--brand-line)]",
                )}
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] text-txt">{it.label}</span>
                  {it.sub && <span className="block truncate text-[11px] text-txt3">{it.sub}</span>}
                </span>
                {on && <Check className="size-4 shrink-0 text-brand-strong" aria-hidden />}
              </button>
            )
          })}
          {filtered.length === 0 && <p className="px-3 py-6 text-center text-[12.5px] text-txt3">-</p>}
        </div>

        {children}
      </DialogContent>
    </Dialog>
  )
}
