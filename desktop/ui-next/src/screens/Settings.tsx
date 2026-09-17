import { RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Panel, Row, GroupLabel, PageTitle } from "@/components/Row"
import { Segmented } from "@/components/Segmented"
import { useApp } from "@/state/app"
import { useI18n } from "@/lib/i18n"
import { displayHost } from "@/lib/format"

export function Settings() {
  const { t, lang, setLang } = useI18n()
  const { update, updateState, checkUpdates, applyUpdate, serverIp, cards } = useApp()

  const updateText =
    updateState === "checking"
      ? t("upChecking")
      : updateState === "latest" && update
        ? t("upLatest").replace("{v}", update.latest)
        : updateState === "available" && update
          ? t("upCur").replace("{v}", update.current)
          : updateState === "error"
            ? t("upFail")
            : t("upCur").replace("{v}", update?.current ?? "0.2.4")

  return (
    <div className="flex flex-col gap-4">
      <PageTitle>{t("tabSettings")}</PageTitle>

      <section>
        <GroupLabel>{t("secGeneral")}</GroupLabel>
        <Panel>
          <Row label={t("language")}>
            <Segmented
              id="lang"
              value={lang}
              onChange={(l) => setLang(l)}
              options={[
                { value: "en", label: "EN" },
                { value: "ar", label: "عربي" },
              ]}
            />
          </Row>

          <Row label={t("updRow")} align="start">
            <div className="flex flex-wrap items-center gap-3">
              <Button
                variant="secondary"
                className="h-9 gap-2 rounded-[10px] px-3.5 text-[13px]"
                onClick={() => void checkUpdates()}
                disabled={updateState === "checking"}
              >
                <RefreshCw className="size-4" aria-hidden />
                {updateState === "checking" ? t("upChecking") : t("upCheck")}
              </Button>
              {updateState === "available" && (
                <Button className="h-9 rounded-[10px] px-3.5 text-[13px]" onClick={() => void applyUpdate()}>
                  {t("upGet")}
                </Button>
              )}
              <span aria-live="polite" className="text-[12px] text-txt3">
                {updateText}
              </span>
            </div>
          </Row>
        </Panel>
      </section>

      <section>
        <GroupLabel>{t("secConnection")}</GroupLabel>
        <Panel>
          <Row label={t("host")}>
            <span className="text-[13px] text-txt">{displayHost(serverIp)}</span>
          </Row>
          <Row label={t("cardForVpn")}>
            <span className="text-[13px] text-txt2">
              {cards.length === 1 ? t("cardsCountOne") : t("cardsCount").replace("{n}", String(cards.length))}
            </span>
          </Row>
          <Row label={t("serverHint")}>
            <span className="text-[12px] text-txt3">{t("serverHint")}</span>
          </Row>
        </Panel>
      </section>
    </div>
  )
}
