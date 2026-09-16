import { useEffect, useMemo, useRef, useState } from "react"
import { ArrowLeft, Check, Search } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Panel } from "@/components/Row"
import { Segmented } from "@/components/Segmented"
import { useApp, type AppsMode } from "@/state/app"
import { useI18n } from "@/lib/i18n"
import { cn } from "@/lib/utils"

type Row = { pkg: string; label: string }

export function Apps({ onBack }: { onBack: () => void }) {
  const { t } = useI18n()
  const { appsMode, setAppsMode, apps, setApps, loadApps } = useApp()
  const [list, setList] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState("")
  // Roving focus over the visible rows. DOM focus only follows moves that come
  // from the keyboard; typing in search resets the index without stealing it.
  const [focusIdx, setFocusIdx] = useState(0)
  const [listActive, setListActive] = useState(false)
  const rowRefs = useRef<Array<HTMLButtonElement | null>>([])
  const pendingFocus = useRef<number | null>(null)

  useEffect(() => {
    let alive = true
    void loadApps().then((l) => {
      if (!alive) return
      setList(l)
      setLoading(false)
    })
    return () => {
      alive = false
    }
  }, [loadApps])

  // The 0.2.x list was alphabetical and stayed that way.
  const sorted = useMemo(
    () => [...list].sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: "base" })),
    [list],
  )

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return sorted
    return sorted.filter((r) => r.label.toLowerCase().includes(q) || r.pkg.toLowerCase().includes(q))
  }, [sorted, query])

  // Focus survives filtering by moving to the first match.
  useEffect(() => {
    setFocusIdx(0)
  }, [query, sorted])

  useEffect(() => {
    if (pendingFocus.current === null || filtered.length === 0) return
    const idx = Math.min(pendingFocus.current, filtered.length - 1)
    pendingFocus.current = null
    const el = rowRefs.current[idx]
    if (el) {
      el.focus({ preventScroll: true })
      el.scrollIntoView({ block: "nearest" })
    }
  }, [focusIdx, filtered.length])

  const moveFocus = (next: number) => {
    if (filtered.length === 0) return
    const clamped = Math.max(0, Math.min(filtered.length - 1, next))
    pendingFocus.current = clamped
    setFocusIdx(clamped)
  }

  const toggle = (pkg: string) => {
    // Picking anything while "all apps" is on means the user wants a subset,
    // so flip the mode instead of ignoring the tap.
    if (appsMode === "all") {
      setAppsMode("allow")
      setApps([pkg])
      return
    }
    setApps(apps.includes(pkg) ? apps.filter((n) => n !== pkg) : [...apps, pkg])
  }

  const selectMatches = () => {
    if (appsMode === "all" || filtered.length === 0) return
    setApps(filtered.map((r) => r.pkg))
  }

  const activeIdx = filtered.length === 0 ? 0 : Math.min(focusIdx, filtered.length - 1)
  const q = query.trim()
  const summary = loading
    ? t("appsLoading")
    : q
      ? t("appsSummaryMatch")
          .replace("{s}", String(apps.length))
          .replace("{t}", String(list.length))
          .replace("{m}", String(filtered.length))
          .replace("{q}", "\u2068" + q + "\u2069")
      : t("appsSummary").replace("{s}", String(apps.length)).replace("{t}", String(list.length))

  const bulkOff = appsMode === "all"

  return (
    <div className="flex flex-col gap-3">
      {/* sticky summary bar: back, mode, search and the live summary stay up
          on the page background while the list scrolls beneath them */}
      <div className="sticky top-0 z-10 flex flex-col gap-3 bg-[var(--bg)] pb-3">
        <div className="flex items-center gap-3 px-1">
          <Button variant="ghost" size="sm" className="h-8 gap-1.5 rounded-[10px] px-2.5 text-[12.5px]" onClick={onBack}>
            <ArrowLeft className="size-3.5" aria-hidden />
            {t("back")}
          </Button>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 px-1">
          <Segmented
            id="apps-mode"
            value={appsMode}
            onChange={(m: AppsMode) => setAppsMode(m)}
            options={[
              { value: "all", label: t("appsAll") },
              { value: "allow", label: t("appsOnly") },
              { value: "block", label: t("appsExcept") },
            ]}
          />
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative">
              <Search className="absolute start-2.5 top-1/2 size-3.5 -translate-y-1/2 text-txt3" aria-hidden />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") setQuery("")
                  else if (e.key === "ArrowDown") {
                    e.preventDefault()
                    moveFocus(0)
                  }
                }}
                placeholder={t("appsSearch")}
                aria-label={t("appsSearch")}
                className="h-9 w-[240px] rounded-[10px] border-line bg-white/[0.02] ps-8 text-[13px]"
              />
            </div>
            <Button
              variant="secondary"
              size="sm"
              className="h-9 gap-1.5 rounded-[10px] px-2.5 text-[12px]"
              disabled={bulkOff || filtered.length === 0}
              onClick={selectMatches}
            >
              {q
                ? t("appsSelectMatches").replace("{m}", String(filtered.length))
                : t("appsSelectAll").replace("{t}", String(list.length))}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              className="h-9 gap-1.5 rounded-[10px] px-2.5 text-[12px]"
              disabled={bulkOff || apps.length === 0}
              onClick={() => setApps([])}
            >
              {t("appsClearSel")}
            </Button>
          </div>
        </div>

        <p aria-live="polite" className="mt-1 px-1 text-[12px] text-txt3" dir="auto">
          {summary}
        </p>
      </div>

      <Panel>
        <div
          role="listbox"
          aria-multiselectable="true"
          className="p-2"
          onFocus={() => setListActive(true)}
          onBlur={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node)) setListActive(false)
          }}
        >
          {filtered.length === 0 ? (
            <p className="px-4 py-6 text-[12.5px] text-txt3">{loading ? t("appsLoading") : t("appsEmpty")}</p>
          ) : (
            <div className="flex flex-col gap-2">
              {filtered.map((row, i) => {
                const on = apps.includes(row.pkg)
                const focused = i === activeIdx && listActive
                return (
                  <button
                    key={row.pkg}
                    ref={(el) => {
                      rowRefs.current[i] = el
                    }}
                    type="button"
                    role="checkbox"
                    aria-checked={on}
                    tabIndex={i === activeIdx ? 0 : -1}
                    onClick={() => toggle(row.pkg)}
                    onFocus={() => setFocusIdx(i)}
                    onKeyDown={(e) => {
                      if (e.key === "ArrowDown") {
                        e.preventDefault()
                        moveFocus(i + 1)
                      } else if (e.key === "ArrowUp") {
                        e.preventDefault()
                        moveFocus(i - 1)
                      } else if (e.key === "Home") {
                        e.preventDefault()
                        moveFocus(0)
                      } else if (e.key === "End") {
                        e.preventDefault()
                        moveFocus(filtered.length - 1)
                      } else if (e.key === " ") {
                        e.preventDefault()
                        toggle(row.pkg)
                      }
                    }}
                    className={cn(
                      "flex w-full scroll-mt-32 items-center justify-between gap-4 rounded-[12px] border border-line px-3.5 py-2.5 text-start transition-colors focus-visible:border-[var(--brand-line)] focus-visible:outline-2 focus-visible:outline-[var(--brand-line)] focus-visible:-outline-offset-2",
                      appsMode === "all" && "opacity-70",
                      on ? "border-line-strong bg-[var(--brand-bg)]" : "bg-white/[0.02] hover:border-[var(--brand-line)]",
                      focused && "border-[var(--brand-line)]",
                    )}
                  >
                    <span className="min-w-0">
                      <span className={cn("block truncate text-[13px]", on ? "text-txt" : "text-txt2")} dir="auto">{row.label}</span>
                      <span className="block truncate text-[11px] text-txt3" dir="auto">{row.pkg}</span>
                    </span>
                    {on && <Check className="size-4 shrink-0 text-brand-strong" aria-hidden />}
                  </button>
                )
              })}
            </div>
          )}
        </div>
      </Panel>
    </div>
  )
}
