import { useState } from "react"
import { ChevronDown, ChevronRight } from "lucide-react"
import { Hero } from "@/components/Hero"
import { PickerDialog, type PickerItem } from "@/components/PickerDialog"
import { Panel, Row } from "@/components/Row"
import { Segmented } from "@/components/Segmented"
import { useApp } from "@/state/app"
import { useI18n } from "@/lib/i18n"

export function Home({ onOpenApps }: { onOpenApps: () => void }) {
  const { t } = useI18n()
  const { cards, card, pickCard, transport, setTransport, appsMode, apps } = useApp()
  const [pickOpen, setPickOpen] = useState(false)

  const cardItems: PickerItem[] = cards.map((c) => ({
    value: c.uuid,
    label: c.name.split(" (")[0],
    sub: `${c.card_type} · ${c.sni}`,
  }))

  const routing =
    appsMode === "all"
      ? `${t("vpnFor")} ${t("wholeDevice")}`
      : appsMode === "allow"
        ? t("appsOnly")
        : t("appsExcept")
  const routingCount = appsMode !== "all" && apps.length ? ` · ${apps.length}` : ""

  return (
    <div className="flex flex-col gap-[var(--gap-3)]">
      <Hero />

      <Panel>
        <Row label={t("cardForVpn")}>
          {/* the same list picker as the domain choice: search, rows, one check */}
          <button
            type="button"
            onClick={() => setPickOpen(true)}
            className="flex h-[var(--ctl-h)] w-full items-center justify-between gap-3 rounded-[var(--r-ctl)] border border-line bg-white/[0.02] px-3 text-[13px] text-txt transition-colors duration-[var(--t-fast)] hover:border-[var(--brand-line)]"
          >
            <span className="truncate">{card ? card.name.split(" (")[0] : t("needCard")}</span>
            <ChevronDown className="size-4 shrink-0 text-txt3" aria-hidden />
          </button>
        </Row>

        <Row label={t("routing")}>
          <button
            type="button"
            onClick={onOpenApps}
            className="group flex h-[var(--ctl-h)] w-full items-center justify-between gap-3 rounded-[var(--r-ctl)] border border-line bg-white/[0.02] px-3 text-[13px] text-txt transition-colors duration-[var(--t-fast)] hover:border-[var(--brand-line)]"
          >
            <span className="truncate">
              {routing}
              {routingCount}
            </span>
            <ChevronRight
              className="size-4 shrink-0 text-txt3 transition-transform duration-[var(--t-fast)] group-hover:translate-x-0.5 group-hover:text-brand-strong"
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
        search={t("searchList")}
        items={cardItems}
        value={card?.uuid ?? ""}
        onPick={(uuid) => pickCard(uuid)}
      />
    </div>
  )
}
