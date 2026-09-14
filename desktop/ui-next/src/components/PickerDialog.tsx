import { useMemo, useState, type ReactNode } from "react"
import { Check, Search } from "lucide-react"
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"

export type PickerItem = { value: string; label: string; sub?: string }

/**
 * The list picker from the 0.2.x sheets: search on top, plain rows, a check on
 * the one in use. Used for the domain choice and for the ping target, so both
 * read exactly like the picker that was already there.
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
      <DialogContent className="max-w-[380px] gap-0 overflow-hidden rounded-[16px] border-line bg-[var(--popover)] p-0">
        <div className="border-b border-line px-4 pb-3.5 pt-4">
          <DialogTitle className="text-[14px] font-semibold text-txt">{title}</DialogTitle>
          <div className="relative mt-3">
            <Search className="absolute start-2.5 top-1/2 size-3.5 -translate-y-1/2 text-txt3" aria-hidden />
            <Input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={search}
              aria-label={search}
              className="h-9 rounded-[10px] border-line bg-white/[0.02] ps-8 text-[13px]"
            />
          </div>
        </div>

        <div className="max-h-[360px] overflow-y-auto p-1.5">
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
                  "flex w-full items-center justify-between gap-3 rounded-[10px] px-3 py-2.5 text-start transition-colors hover:bg-white/[0.035]",
                  on && "bg-white/[0.03]",
                )}
              >
                <span className="min-w-0">
                  <span className="block truncate text-[13px] text-txt">{it.label}</span>
                  {it.sub && <span className="block truncate text-[11.5px] text-txt3">{it.sub}</span>}
                </span>
                {on && <Check className="size-4 shrink-0 text-brand-strong" aria-hidden />}
              </button>
            )
          })}
          {filtered.length === 0 && <p className="px-3 py-7 text-center text-[12.5px] text-txt3">—</p>}
        </div>

        {children}
      </DialogContent>
    </Dialog>
  )
}
