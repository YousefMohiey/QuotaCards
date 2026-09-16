import { useState } from "react"
import { ChevronDown, ChevronRight, Gamepad2, Tv } from "lucide-react"
import { Hero } from "@/components/Hero"
import { PickerDialog, type PickerItem } from "@/components/PickerDialog"
import { Panel, Row } from "@/components/Row"
import { Segmented } from "@/components/Segmented"
import { useApp, type PresetKind } from "@/state/app"
import { useI18n } from "@/lib/i18n"
import { DEFAULT_SNI } from "@/lib/snis"
import { cn } from "@/lib/utils"

export function Home({ onOpenApps }: { onOpenApps: () => void }) {
  const { t } = useI18n()
  const { cards, card, pickCard, preset, setPreset, ensurePresetCard, transport, setTransport, appsMode, apps } = useApp()
  const [pickOpen, setPickOpen] = useState(false)
  // In-flight preset creation: the preset flips instantly, the tap below
  // creates and selects the missing card without any connection.
  const [creating, setCreating] = useState<PresetKind | null>(null)

  const cardItems: PickerItem[] = cards.map((c) => ({
    value: c.uuid,
    label: c.name.split(" (")[0],
    sub: `${c.card_type === "Streamerz" ? t("kindStreamerz") : t("kindGamerz")} · ${c.sni}`,
  }))

  const routing =
    appsMode === "all"
      ? `${t("vpnFor")} ${t("wholeDevice")}`
      : appsMode === "allow"
        ? t("appsOnly")
        : t("appsExcept")
  const routingCount = appsMode !== "all" && apps.length ? ` · ${apps.length}` : ""

  return (
    <div className="flex flex-col gap-3">
      <Hero />

      {/* one instrument panel: preset pair on top, then the card, routing
          and connection rows below it, all on the same glass surface */}
      <Panel>
        {/* one-tap preset: Streaming vs Gaming, each with its domain shown */}
        <div className="grid grid-cols-2 gap-3 border-b border-line p-3">
          {(["Gamerz", "Streamerz"] as const).map((kind: PresetKind) => {
            const mine = cards.find((c) => c.card_type === kind)
            const sni = mine?.sni ?? DEFAULT_SNI[kind]
            const isActive = preset === kind
            const Icon = kind === "Gamerz" ? Gamepad2 : Tv
            return (
              <button
                key={kind}
                type="button"
                aria-pressed={isActive}
                disabled={creating !== null}
                onClick={() => {
                  if (creating) return
                  if (mine) {
                    setPreset(kind)
                    pickCard(mine.uuid)
                    return
                  }
                  setCreating(kind)
                  void ensurePresetCard(kind).finally(() => setCreating(null))
                }}
                className={cn(
                  "flex min-h-[68px] flex-col items-start justify-center gap-1 rounded-[14px] border px-3.5 py-2.5 text-start transition-colors duration-200 disabled:cursor-wait disabled:opacity-70",
                  isActive
                    ? "border-[var(--brand-line)] bg-[var(--brand-bg)] shadow-[inset_0_1px_0_rgb(255_255_255/0.08)]"
                    : "border-line bg-white/[0.02] hover:border-[var(--brand-line)]",
                )}
              >
                <span className="flex min-w-0 max-w-full items-center gap-2">
                  <Icon className={cn("size-4 shrink-0", isActive ? "text-brand-strong" : "text-txt3")} aria-hidden />
                  <span className={cn("truncate text-[13.5px] font-semibold", isActive ? "text-txt" : "text-txt2")} dir="auto">
                    {t(kind === "Gamerz" ? "kindGamerz" : "kindStreamerz")}
                  </span>
                </span>
                <span className="w-full truncate ps-[24px] font-mono text-[11px] tabular-nums text-txt3">{sni}</span>
              </button>
            )
          })}
        </div>

        <Row label={t("cardForVpn")}>
          {/* the same list picker as the domain choice: search, rows, one check */}
          <button
            type="button"
            onClick={() => setPickOpen(true)}
            className="group flex h-11 w-full max-w-[400px] items-center justify-between gap-3 rounded-[12px] border border-line bg-white/[0.02] px-3.5 text-[13px] text-txt transition-colors duration-200 hover:border-[var(--brand-line)] hover:bg-[var(--brand-bg)]"
          >
            <span className="truncate" dir="auto">{card ? card.name.split(" (")[0] : t("needCard")}</span>
            <ChevronDown className="size-4 shrink-0 text-txt2 transition-[color,transform] duration-200 group-hover:translate-y-px group-hover:text-brand-strong" aria-hidden />
          </button>
        </Row>

        <Row label={t("routing")}>
          <button
            type="button"
            onClick={onOpenApps}
            className="group flex h-11 w-full max-w-[400px] items-center justify-between gap-3 rounded-[12px] border border-line bg-white/[0.02] px-3.5 text-[13px] text-txt transition-colors duration-200 hover:border-[var(--brand-line)] hover:bg-[var(--brand-bg)]"
          >
            <span className="truncate" dir="auto">
              {routing}
              {routingCount}
            </span>
            <ChevronRight
              className="size-4 shrink-0 text-txt2 transition-transform duration-200 group-hover:translate-x-0.5 group-hover:text-brand-strong"
              aria-hidden
            />
          </button>
        </Row>

        <Row label={t("transport")} align="start">
          <div>
            <Segmented
              id="transport"
              value={transport}
              onChange={setTransport}
              options={[
                { value: "vless", label: t("trStandard") },
                { value: "wg", label: t("trWg") },
                { value: "hy2", label: "Hysteria2" },
              ]}
            />
            <p className="mt-1.5 text-[11.5px] text-txt3">
              {transport === "vless" ? t("trNoteVless") : transport === "wg" ? t("trNoteWg") : t("trNoteHy2")}
            </p>
          </div>
        </Row>
      </Panel>

      <PickerDialog
        open={pickOpen}
        onOpenChange={setPickOpen}
        title={t("cardForVpn")}
        search={t("appsSearch")}
        items={cardItems}
        value={card?.uuid ?? ""}
        onPick={(uuid) => pickCard(uuid)}
      />
    </div>
  )
}
