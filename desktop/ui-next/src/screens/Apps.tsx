import { useEffect, useMemo, useState } from "react"
import { ArrowLeft, Check, Search } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Segmented } from "@/components/Segmented"
import { useApp, type AppsMode } from "@/state/app"
import { useI18n } from "@/lib/i18n"
import { cn } from "@/lib/utils"

type Row = { pkg: string; label: string }

/**
 * Routing: a page, not a webpage in a box. The list runs straight down the
 * content area on hairline separators, the page is the only thing that
 * scrolls, and the toolbar holds the mode and the search on one line.
 */
export function Apps({ onBack }: { onBack: () => void }) {
  const { t } = useI18n()
  const { appsMode, setAppsMode, apps, setApps, loadApps } = useApp()
  const [list, setList] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState("")

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

  const status =
    appsMode === "all" ? t("appsStatusAll") : appsMode === "allow" ? t("appsStatusAllow") : t("appsStatusBlock")

  return (
    <div className="flex flex-col gap-[var(--gap-3)]">
      {/* toolbar: back, mode, search all on the same baseline */}
      <div className="flex flex-wrap items-center gap-2.5">
        <Button
          variant="ghost"
          size="sm"
          className="-ms-2 h-[var(--ctl-h-sm)] gap-1.5 rounded-[var(--r-ctl)] px-2 text-[12.5px]"
          onClick={onBack}
        >
          <ArrowLeft className="size-3.5" aria-hidden />
          {t("back")}
        </Button>
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
        <div className="relative ms-auto">
          <Search className="absolute start-2.5 top-1/2 size-3.5 -translate-y-1/2 text-txt3" aria-hidden />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("appsSearch")}
            aria-label={t("appsSearch")}
            className="h-[var(--ctl-h-sm)] w-[220px] rounded-[var(--r-ctl)] border-line bg-white/[0.02] ps-8 text-[12.5px]"
          />
        </div>
      </div>

      <p aria-live="polite" className="px-0.5 text-[11.5px] text-txt3">
        {loading ? t("appsLoading") : status}
      </p>

      {/* the list itself: separators, no enclosing card, no inner scroll */}
      <div role="listbox" aria-multiselectable="true" className="list-sep border-t border-line">
        {filtered.length === 0 ? (
          <p className="py-6 text-[12.5px] text-txt3">{loading ? t("appsLoading") : t("appsEmpty")}</p>
        ) : (
          filtered.map((row) => {
            const on = apps.includes(row.pkg)
            return (
              <button
                key={row.pkg}
                type="button"
                role="checkbox"
                aria-checked={on}
                onClick={() => toggle(row.pkg)}
                className={cn(
                  "flex h-[46px] w-full items-center gap-3 px-1 text-start transition-colors duration-[var(--t-fast)] hover:bg-white/[0.025]",
                  appsMode === "all" && "opacity-60",
                )}
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] text-txt">{row.label}</span>
                  <span className="block truncate text-[11px] text-txt3">{row.pkg}</span>
                </span>
                <span
                  className={cn(
                    "grid size-4 shrink-0 place-items-center rounded-[5px] border transition-colors duration-[var(--t-fast)]",
                    on ? "border-[var(--brand-line)] bg-[var(--brand-bg)]" : "border-line-strong",
                  )}
                  aria-hidden
                >
                  {on && <Check className="size-3 text-brand-strong" />}
                </span>
              </button>
            )
          })
        )}
      </div>
    </div>
  )
}
