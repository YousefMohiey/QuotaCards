import { useEffect, useMemo, useState } from "react"
import { ArrowLeft, Search } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { Panel } from "@/components/Row"
import { Segmented } from "@/components/Segmented"
import { useApp, type AppsMode } from "@/state/app"
import { useI18n } from "@/lib/i18n"

type Row = { pkg: string; label: string }

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

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return q ? list.filter((r) => r.label.toLowerCase().includes(q)) : list
  }, [list, query])

  const toggle = (pkg: string) => {
    if (appsMode === "all") return
    setApps(apps.includes(pkg) ? apps.filter((n) => n !== pkg) : [...apps, pkg])
  }

  const status =
    appsMode === "all" ? t("appsStatusAll") : appsMode === "allow" ? t("appsStatusAllow") : t("appsStatusBlock")

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3 px-1">
        <Button variant="ghost" size="sm" className="h-8 gap-1.5 rounded-[10px] px-2.5 text-[12.5px]" onClick={onBack}>
          <ArrowLeft className="size-3.5" aria-hidden />
          {t("back")}
        </Button>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
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
        <div className="relative">
          <Search className="absolute start-2.5 top-1/2 size-3.5 -translate-y-1/2 text-txt3" aria-hidden />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("appsSearch")}
            aria-label={t("appsSearch")}
            className="h-9 w-[240px] rounded-[10px] border-line bg-white/[0.02] ps-8 text-[13px]"
          />
        </div>
      </div>

      <p aria-live="polite" className="px-1 text-[12px] text-txt3">
        {loading ? t("appsLoading") : status}
      </p>

      <Panel>
        <div className="max-h-[520px] overflow-y-auto">
          {filtered.length === 0 ? (
            <p className="px-4 py-6 text-[12.5px] text-txt3">{loading ? t("appsLoading") : t("appsEmpty")}</p>
          ) : (
            filtered.map((row) => {
              const on = apps.includes(row.pkg)
              return (
                <div
                  key={row.pkg}
                  className="flex items-center justify-between gap-4 border-b border-line px-4 py-2.5 last:border-b-0"
                >
                  <div className="min-w-0">
                    <div className="truncate text-[13px] text-txt2">{row.label}</div>
                    <div className="truncate text-[11px] text-txt3">{row.pkg}</div>
                  </div>
                  <Switch
                    checked={on}
                    disabled={appsMode === "all"}
                    onCheckedChange={() => toggle(row.pkg)}
                    aria-label={row.label}
                  />
                </div>
              )
            })
          )}
        </div>
      </Panel>
    </div>
  )
}
