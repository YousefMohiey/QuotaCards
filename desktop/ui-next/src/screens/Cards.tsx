import { useState } from "react"
import { Check, Copy, Link as LinkIcon, Plus, Trash2 } from "lucide-react"
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
import { PickerDialog, type PickerItem } from "@/components/PickerDialog"
import { Segmented } from "@/components/Segmented"
import { Panel } from "@/components/Row"
import { useApp } from "@/state/app"
import { useI18n } from "@/lib/i18n"
import { CUSTOM_SNI, DEFAULT_SNI, SNIS, labelForSni } from "@/lib/snis"
import { parseCardLink } from "@/lib/cardlink"
import { cn } from "@/lib/utils"

type Kind = "Gamerz" | "Streamerz"

export function Cards() {
  const { t } = useI18n()
  const { cards, cardUuid, pickCard, generateCard, importCard, revokeCard, copyCard } = useApp()

  const [open, setOpen] = useState(false)
  const [kind, setKind] = useState<Kind>("Gamerz")
  const [name, setName] = useState("")
  const [sni, setSni] = useState<string>(DEFAULT_SNI.Gamerz)
  const [custom, setCustom] = useState("")
  const [domainOpen, setDomainOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState("")

  const [pasteOpen, setPasteOpen] = useState(false)
  const [pasted, setPasted] = useState("")
  const [pasteNote, setPasteNote] = useState("")

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

  const submitPaste = async () => {
    const parsed = parseCardLink(pasted)
    if (!parsed) {
      setPasteNote(t("badCard"))
      return
    }
    setBusy(true)
    const r = await importCard(parsed.uuid, parsed.name, parsed.kind, parsed.sni)
    setBusy(false)
    setPasteNote(r.msg || t("cardAdded"))
    if (r.ok) {
      setTimeout(() => {
        setPasteOpen(false)
        setPasted("")
        setPasteNote("")
      }, 700)
    }
  }

  const domainItems: PickerItem[] = [
    ...SNIS[kind].map(([label, domain]) => ({ value: domain, label, sub: domain })),
    { value: CUSTOM_SNI, label: t("customDomainOpt") },
  ]

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3 px-1">
        <h2 className="text-[15px] font-semibold text-txt">
          {t("myCards")}
          <span className="ms-2 text-[12.5px] font-normal text-txt3">{cards.length}</span>
        </h2>
        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            className="h-8 gap-1.5 rounded-[10px] px-3 text-[12.5px]"
            onClick={() => {
              setPasteNote("")
              setPasted("")
              setPasteOpen(true)
            }}
          >
            <LinkIcon className="size-3.5" aria-hidden />
            {t("addCardLink")}
          </Button>
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
                  "glass-tile rounded-[14px] p-4 transition-colors",
                  inUse ? "border-[var(--brand-line)]" : "hover:bg-white/[0.02]",
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

      {/* new card: name, kind, then the domain through the list picker */}
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
                setCustom("")
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
              <Label className="text-[12.5px] text-txt2">{t("domainSni")}</Label>
              <button
                type="button"
                onClick={() => setDomainOpen(true)}
                className="flex h-9 w-full items-center justify-between gap-2 rounded-[10px] border border-line bg-white/[0.02] px-3 text-[13px] text-txt transition-colors hover:border-[var(--brand-line)]"
              >
                <span className="truncate">
                  {sni === CUSTOM_SNI
                    ? custom.trim() || t("customDomainOpt")
                    : `${labelForSni(sni)} · ${sni}`}
                </span>
                <span className="text-[11.5px] text-txt3">{t("domainSni")}</span>
              </button>
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
            <Button variant="ghost" className="h-9 rounded-[10px] text-[13px]" onClick={() => setOpen(false)}>
              {t("cancel")}
            </Button>
            <Button className="h-9 rounded-[10px] text-[13px]" disabled={busy} onClick={() => void submit()}>
              {busy ? t("measuring") : t("generateCard")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* add a card that came from somewhere else */}
      <Dialog open={pasteOpen} onOpenChange={setPasteOpen}>
        <DialogContent className="max-w-[440px] gap-5 rounded-[16px] border-line bg-[var(--popover)]">
          <DialogHeader>
            <DialogTitle className="text-[15px]">{t("pasteTitle")}</DialogTitle>
            <DialogDescription className="text-[12.5px] text-txt3">{t("pasteHint")}</DialogDescription>
          </DialogHeader>

          <Input
            autoFocus
            value={pasted}
            onChange={(e) => setPasted(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void submitPaste()
            }}
            placeholder={t("pastePlaceholder")}
            aria-label={t("pasteTitle")}
            className="h-9 rounded-[10px] border-line bg-white/[0.02] font-mono text-[12px]"
          />

          {pasteNote && <p className="text-[12px] text-txt3">{pasteNote}</p>}

          <DialogFooter className="gap-2">
            <Button variant="ghost" className="h-9 rounded-[10px] text-[13px]" onClick={() => setPasteOpen(false)}>
              {t("cancel")}
            </Button>
            <Button className="h-9 rounded-[10px] text-[13px]" disabled={busy || !pasted.trim()} onClick={() => void submitPaste()}>
              {t("add")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <PickerDialog
        open={domainOpen}
        onOpenChange={setDomainOpen}
        title={t("domainSni")}
        search={t("sheetSearch")}
        items={domainItems}
        value={sni}
        onPick={(v) => {
          setSni(v)
          if (v !== CUSTOM_SNI) setCustom("")
        }}
      />
    </div>
  )
}
