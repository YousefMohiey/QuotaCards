import { ChevronRight, ShieldCheck } from "lucide-react"
import { Hero } from "@/components/Hero"
import { Panel, Row } from "@/components/Row"
import { Segmented } from "@/components/Segmented"
import { useApp } from "@/state/app"
import { useI18n } from "@/lib/i18n"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

export function Home({ onOpenApps }: { onOpenApps: () => void }) {
  const { t } = useI18n()
  const { cards, cardUuid, pickCard, transport, setTransport, appsMode, apps } = useApp()

  const routing =
    appsMode === "all"
      ? `${t("vpnFor")} ${t("wholeDevice")}`
      : appsMode === "allow"
        ? t("appsOnly")
        : t("appsExcept")
  const routingCount = appsMode !== "all" && apps.length ? ` · ${apps.length}` : ""

  return (
    <div className="flex flex-col gap-4">
      <Hero />

      <Panel>
        <Row label={t("cardForVpn")}>
          <Select value={cardUuid} onValueChange={pickCard}>
            <SelectTrigger className="h-9 w-full max-w-[400px] rounded-[10px] border-line bg-white/[0.02] text-[13px]">
              <SelectValue placeholder={t("needCard")} />
            </SelectTrigger>
            <SelectContent>
              {cards.map((c) => (
                <SelectItem key={c.uuid} value={c.uuid}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Row>

        <Row label={t("routing")}>
          <button
            type="button"
            onClick={onOpenApps}
            className="flex h-9 w-full items-center justify-between rounded-[10px] border border-line bg-white/[0.02] px-3 text-[13px] text-txt transition-colors hover:bg-white/[0.04]"
          >
            <span className="truncate">
              {routing}
              {routingCount}
            </span>
            <ChevronRight className="size-4 shrink-0 text-txt3" aria-hidden />
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
            <p className="mt-2 text-[11.5px] text-txt3">
              {transport === "vless" ? t("trNoteVless") : transport === "wg" ? t("trNoteWg") : t("trNoteHy2")}
            </p>
          </div>
        </Row>
      </Panel>

      <p className="flex items-center gap-2 px-1 text-[11.5px] text-txt3">
        <ShieldCheck className="size-3.5 shrink-0" aria-hidden />
        {t("ksFoot")}
      </p>
    </div>
  )
}
