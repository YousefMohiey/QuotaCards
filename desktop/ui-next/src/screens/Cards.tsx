import { useState } from "react"
import { Check, ChevronDown, Copy, Link as LinkIcon, Plus, Trash2, TriangleAlert } from "lucide-react"
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
import { Panel, PageTitle } from "@/components/Row"
import { useApp } from "@/state/app"
import { useI18n } from "@/lib/i18n"
import { CUSTOM_SNI, DEFAULT_SNI, SNIS, labelForSni } from "@/lib/snis"
import { parseCardLink } from "@/lib/cardlink"
import { cn } from "@/lib/utils"

type Kind = "Gamerz" | "Streamerz"

const FIELD = "h-[var(--ctl-h)] rounded-[var(--r-ctl)] border-line bg-white/[0.02] text-[13px]"

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
  const [noteBad, setNoteBad] = useState(false)

  const [pasteOpen, setPasteOpen] = useState(false)
  const [pasted, setPasted] = useState("")
  const [pasteNote, setPasteNote] = useState("")
  const [pasteBad, setPasteBad] = useState(false)

  const effectiveSni = sni === CUSTOM_SNI ? custom.trim() : sni

  const reset = () => {
    setName("")
    setKind("Gamerz")
    setSni(DEFAULT_SNI.Gamerz)
    setCustom("")
    setNote("")
  }

  const submit = async () => {
    if (!name.trim()) {
      setNote(t("warnName"))
      setNoteBad(true)
      return
    }
    if (!effectiveSni) {
      setNote(t("warnDomain"))
      setNoteBad(true)
      return
    }
    setBusy(true)
    const r = await generateCard(name.trim(), kind, effectiveSni)
    setBusy(false)
    setNote(r.msg)
    setNoteBad(!r.ok)
    if (r.ok) {
      setOpen(false)
      reset()
    }
  }

  const submitPaste = async () => {
    const parsed = parseCardLink(pasted)
    if (!parsed) {
      setPasteNote(t("badCard"))
      setPasteBad(true)
      return
    }
    setBusy(true)
    const r = await importCard(parsed.uuid, parsed.name, parsed.kind, parsed.sni)
    setBusy(false)
    setPasteNote(r.msg || t("cardAdded"))
    setPasteBad(!r.ok)
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
    <div className="flex flex-col gap-[var(--gap-3)]">
      <PageTitle sub={t("cardsSub")}>{t("myCards")}</PageTitle>

      <div className="flex items-center gap-2">
        <Button
          variant="secondary"
          className="h-[var(--ctl-h-sm)] gap-1.5 rounded-[var(--r-ctl)] px-3 text-[12.5px]"
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
          className="h-[var(--ctl-h-sm)] gap-1.5 rounded-[var(--r-ctl)] px-3 text-[12.5px]"
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
        <Panel className="p-5 text-[13px] text-txt3">{t("noCards")}</Panel>
      ) : (
        <div className="grid grid-cols-1 gap-2.5 xl:grid-cols-2">
          {cards.map((c) => {
            const inUse = c.uuid === cardUuid
            return (
              <div
                key={c.uuid}
                className={cn(
                  "glass flex flex-col gap-3 rounded-[var(--r-card)] p-3.5 transition-colors duration-[var(--t-base)]",
                  inUse ? "border-[var(--brand-line)]" : "hover:border-[var(--glass-line)]",
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-[13.5px] font-semibold text-txt">{c.name.split(" (")[0]}</div>
                    <div className="mt-0.5 truncate text-[11.5px] text-txt3">{c.sni || "-"}</div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <span className="rounded-full border border-line bg-white/[0.02] px-1.5 py-[1px] text-[10px] tracking-[0.04em] text-txt2 uppercase">
                      {c.card_type}
                    </span>
                    {inUse && (
                      <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--green-line)] bg-[var(--green-bg)] px-2 py-[1px] text-[10.5px] text-[var(--green)]">
                        <span className="size-1.5 rounded-full bg-[var(--green)]" aria-hidden />
                        {t("inUse")}
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-1.5">
                  <Button
                    size="sm"
                    className="h-[var(--ctl-h-sm)] gap-1.5 rounded-[var(--r-ctl)] px-2.5 text-[12px]"
                    onClick={() => void copyCard(c.uuid)}
                  >
                    <Copy className="size-3.5" aria-hidden />
                    {t("copy")}
                  </Button>
                  {!inUse && (
                    <Button
                      variant="secondary"
                      size="sm"
                      className="h-[var(--ctl-h-sm)] rounded-[var(--r-ctl)] px-3 text-[12px]"
                      onClick={() => pickCard(c.uuid)}
                    >
                      {t("connect")}
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    className="ms-auto h-[var(--ctl-h-sm)] gap-1.5 rounded-[var(--r-ctl)] px-2.5 text-[12px] text-[var(--red)] opacity-75 transition-all duration-[var(--t-fast)] hover:bg-[var(--red-bg)] hover:opacity-100"
                    onClick={() => void revokeCard(c.uuid)}
                  >
                    <Trash2 className="size-3.5" aria-hidden />
                    {t("revoke")}
                  </Button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* new card: name, kind, then the domain through the list picker */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-[420px] gap-4">
          <DialogHeader>
            <DialogTitle className="text-[14.5px]">{t("newCard")}</DialogTitle>
            <DialogDescription className="text-[12.5px] text-txt3">{t("ptDomain")}</DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-3.5">
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
              <Label htmlFor="card-name" className="text-[12px] text-txt2">
                {t("cardName")}
              </Label>
              <Input
                id="card-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t("exName")}
                className={FIELD}
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label className="text-[12px] text-txt2">{t("domainSni")}</Label>
              <button
                type="button"
                onClick={() => setDomainOpen(true)}
                className={cn(
                  FIELD,
                  "flex w-full items-center justify-between gap-2 border px-3 text-txt transition-colors duration-[var(--t-fast)] hover:border-[var(--brand-line)]",
                )}
              >
                <span className="truncate">
                  {sni === CUSTOM_SNI ? custom.trim() || t("customDomainOpt") : `${labelForSni(sni)} · ${sni}`}
                </span>
                <ChevronDown className="size-4 shrink-0 text-txt3" aria-hidden />
              </button>
              {sni === CUSTOM_SNI && (
                <Input
                  value={custom}
                  onChange={(e) => setCustom(e.target.value)}
                  placeholder="example.com"
                  className={cn(FIELD, "mt-0.5")}
                />
              )}
            </div>

            {note && <Note text={note} bad={noteBad} />}
          </div>

          <DialogFooter className="gap-2">
            <Button
              variant="ghost"
              className="h-[var(--ctl-h)] rounded-[var(--r-ctl)] text-[13px]"
              onClick={() => setOpen(false)}
            >
              {t("cancel")}
            </Button>
            <Button
              className="h-[var(--ctl-h)] rounded-[var(--r-ctl)] text-[13px]"
              disabled={busy}
              onClick={() => void submit()}
            >
              {busy ? t("measuring") : t("generateCard")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* add a card that came from somewhere else */}
      <Dialog open={pasteOpen} onOpenChange={setPasteOpen}>
        <DialogContent className="max-w-[440px] gap-4">
          <DialogHeader>
            <DialogTitle className="text-[14.5px]">{t("pasteTitle")}</DialogTitle>
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
            className={cn(FIELD, "font-mono text-[12px]")}
          />

          {pasteNote && <Note text={pasteNote} bad={pasteBad} />}

          <DialogFooter className="gap-2">
            <Button
              variant="ghost"
              className="h-[var(--ctl-h)] rounded-[var(--r-ctl)] text-[13px]"
              onClick={() => setPasteOpen(false)}
            >
              {t("cancel")}
            </Button>
            <Button
              className="h-[var(--ctl-h)] rounded-[var(--r-ctl)] text-[13px]"
              disabled={busy || !pasted.trim()}
              onClick={() => void submitPaste()}
            >
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

/** One line that says whether the last action worked. */
function Note({ text, bad }: { text: string; bad: boolean }) {
  return (
    <p
      role={bad ? "alert" : "status"}
      className={cn(
        "flex items-center gap-2 rounded-[var(--r-ctl)] px-3 py-2 text-[12px]",
        bad
          ? "border border-[var(--red-line)] bg-[var(--red-bg)] text-[var(--red)]"
          : "border border-[var(--green-line)] bg-[var(--green-bg)] text-[var(--green)]",
      )}
    >
      {bad ? <TriangleAlert className="size-3.5 shrink-0" aria-hidden /> : <Check className="size-3.5 shrink-0" aria-hidden />}
      {text}
    </p>
  )
}
