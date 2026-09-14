import { useState } from "react"
import { Check, Copy, Plus, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Segmented } from "@/components/Segmented"
import { Panel } from "@/components/Row"
import { useApp } from "@/state/app"
import { useI18n } from "@/lib/i18n"
import { CUSTOM_SNI, DEFAULT_SNI, SNIS } from "@/lib/snis"
import { cn } from "@/lib/utils"

type Kind = "Gamerz" | "Streamerz"

export function Cards() {
  const { t } = useI18n()
  const { cards, cardUuid, pickCard, generateCard, revokeCard, copyCard } = useApp()
  const [open, setOpen] = useState(false)
  const [kind, setKind] = useState<Kind>("Gamerz")
  const [name, setName] = useState("")
  const [sni, setSni] = useState<string>(DEFAULT_SNI.Gamerz)
  const [custom, setCustom] = useState("")
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState("")

  const effectiveSni = sni === CUSTOM_SNI ? custom.trim() : sni

  const reset = () => {
    setName("")
    setKind("Gamerz")
    setSni(DEFAULT_SNI.Gamerz)
    setCustom("")
    setNote("")
  }

  const submit = async () => {
    if (!name.trim() || !effectiveSni) {
      setNote(!name.trim() ? t("cardName") : t("needDomain"))
      return
    }
    setBusy(true)
    const r = await generateCard(name.trim(), kind, effectiveSni)
    setBusy(false)
    setNote(r.msg)
    if (r.ok) {
      setOpen(false)
      reset()
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between px-1">
        <h2 className="text-[15px] font-semibold text-txt">
          {t("myCards")}
          <span className="ml-2 text-[12.5px] font-normal text-txt3">{cards.length}</span>
        </h2>
        <Button
          size="sm"
          className="h-8 gap-1.5 rounded-[10px] px-3 text-[12.5px]"
          onClick={() => {
            reset()
            setOpen(true)
          }}
        >
          <Plus className="size-3.5" aria-hidden />
          {t("newCard")}
        </Button>
      </div>

      {cards.length === 0 ? (
        <Panel className="p-6 text-[13px] text-txt3">{t("noCards")}</Panel>
      ) : (
        <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
          {cards.map((c) => {
            const inUse = c.uuid === cardUuid
            return (
              <div
                key={c.uuid}
                className={cn(
                  "rounded-[12px] border p-4 transition-colors",
                  inUse ? "border-[var(--brand-line)]" : "border-line hover:bg-white/[0.015]",
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-[14px] font-medium text-txt">{c.name.split(" (")[0]}</div>
                    <div className="mt-1 truncate text-[12px] text-txt3">{c.sni || "—"}</div>
                  </div>
                  <span className="shrink-0 rounded-full border border-line-strong px-2 py-[3px] text-[11px] text-txt3">
                    {c.card_type}
                  </span>
                </div>

                <div className="mt-4 flex items-center gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    className="h-8 gap-1.5 rounded-[10px] px-2.5 text-[12px]"
                    onClick={() => void copyCard(c.uuid)}
                  >
                    <Copy className="size-3.5" aria-hidden />
                    {t("copy")}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 gap-1.5 rounded-[10px] px-2.5 text-[12px] text-txt3 hover:text-[var(--red)]"
                    onClick={() => void revokeCard(c.uuid)}
                  >
                    <Trash2 className="size-3.5" aria-hidden />
                    {t("revoke")}
                  </Button>

                  <div className="ms-auto">
                    {inUse ? (
                      <span className="inline-flex items-center gap-1.5 text-[12px] text-[var(--green)]">
                        <Check className="size-3.5" aria-hidden />
                        {t("inUse")}
                      </span>
                    ) : (
                      <Button
                        variant="secondary"
                        size="sm"
                        className="h-8 rounded-[10px] px-3 text-[12px]"
                        onClick={() => pickCard(c.uuid)}
                      >
                        {t("connect")}
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-[420px] gap-5 rounded-[16px] border-line bg-[var(--popover)]">
          <DialogHeader>
            <DialogTitle className="text-[15px]">{t("newCard")}</DialogTitle>
            <DialogDescription className="text-[12.5px] text-txt3">{t("ptDomain")}</DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-4">
            <Segmented
              id="kind"
              value={kind}
              onChange={(k) => {
                setKind(k)
                setSni(DEFAULT_SNI[k])
              }}
              options={[
                { value: "Gamerz", label: t("kindGamerz") },
                { value: "Streamerz", label: t("kindStreamerz") },
              ]}
            />

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="card-name" className="text-[12.5px] text-txt2">
                {t("cardName")}
              </Label>
              <Input
                id="card-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t("exName")}
                className="h-9 rounded-[10px] border-line bg-white/[0.02] text-[13px]"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label className="text-[12.5px] text-txt2">{t("ptDomain")}</Label>
              <Select value={sni} onValueChange={setSni}>
                <SelectTrigger className="h-9 w-full rounded-[10px] border-line bg-white/[0.02] text-[13px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SNIS[kind].map(([label, domain]) => (
                    <SelectItem key={domain} value={domain}>
                      {label} · {domain}
                    </SelectItem>
                  ))}
                  <SelectItem value={CUSTOM_SNI}>{t("customDomain")}</SelectItem>
                </SelectContent>
              </Select>
              {sni === CUSTOM_SNI && (
                <Input
                  value={custom}
                  onChange={(e) => setCustom(e.target.value)}
                  placeholder="example.com"
                  className="mt-1 h-9 rounded-[10px] border-line bg-white/[0.02] text-[13px]"
                />
              )}
            </div>

            {note && <p className="text-[12px] text-txt3">{note}</p>}
          </div>

          <DialogFooter className="gap-2">
            <Button
              variant="ghost"
              className="h-9 rounded-[10px] text-[13px]"
              onClick={() => setOpen(false)}
            >
              {t("cancel")}
            </Button>
            <Button className="h-9 rounded-[10px] text-[13px]" disabled={busy} onClick={() => void submit()}>
              {busy ? t("measuring") : t("generateCard")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
