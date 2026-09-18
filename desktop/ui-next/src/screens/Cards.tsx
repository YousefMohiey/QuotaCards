import { useEffect, useRef, useState } from "react"
import { Check, Plus, Trash2, TriangleAlert } from "lucide-react"
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
import { cn } from "@/lib/utils"

type Kind = "Gamerz" | "Streamerz"

export function Cards() {
  const { t } = useI18n()
  const { cards, cardUuid, pickCard, generateCard, revokeCardOptimistic } = useApp()

  const [open, setOpen] = useState(false)
  const [kind, setKind] = useState<Kind>("Gamerz")
  const [name, setName] = useState("")
  const [sni, setSni] = useState<string>(DEFAULT_SNI.Gamerz)
  const [custom, setCustom] = useState("")
  const [domainOpen, setDomainOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState("")
  const [noteBad, setNoteBad] = useState(false)

  // Two-tap revoke arm plus a page-level note for a failed optimistic revoke.
  const [armed, setArmed] = useState<string | null>(null)
  const [pageNote, setPageNote] = useState("")
  const [pageNoteBad, setPageNoteBad] = useState(false)

  // Roving focus across card tiles, mirroring the Apps list: DOM focus only
  // follows moves that come from the keyboard.
  const [focusIdx, setFocusIdx] = useState(0)
  const [listActive, setListActive] = useState(false)
  const tileRefs = useRef<Array<HTMLDivElement | null>>([])
  const pendingFocus = useRef<number | null>(null)

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
    setNote("")
    setNoteBad(false)
    try {
      const r = await generateCard(name.trim(), kind, effectiveSni)
      if (r.ok) {
        const okMsg = t("cardCreated")
        setNote(okMsg)
        setNoteBad(false)
        setPageNote(okMsg)
        setPageNoteBad(false)
        setBusy(false)
        // Brief in-dialog confirmation first, mirroring the add-from-link
        // flow, so the success is seen before the dialog closes.
        setTimeout(() => {
          setOpen(false)
          reset()
        }, 700)
        return
      }
      setNote(r.msg)
      setNoteBad(true)
      setPageNote(r.msg)
      setPageNoteBad(true)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setNote(msg)
      setNoteBad(true)
      setPageNote(msg)
      setPageNoteBad(true)
    }
    setBusy(false)
  }

  const domainItems: PickerItem[] = [
    ...SNIS[kind].map(([label, domain]) => ({ value: domain, label, sub: domain })),
    { value: CUSTOM_SNI, label: t("customDomainOpt") },
  ]

  // Focus survives list changes by moving to the first tile.
  useEffect(() => {
    setFocusIdx(0)
  }, [cards])

  useEffect(() => {
    if (pendingFocus.current === null || cards.length === 0) return
    const idx = Math.min(pendingFocus.current, cards.length - 1)
    pendingFocus.current = null
    const el = tileRefs.current[idx]
    if (el) {
      el.focus({ preventScroll: true })
      el.scrollIntoView({ block: "nearest" })
    }
  }, [focusIdx, cards.length])

  const moveFocus = (next: number) => {
    if (cards.length === 0) return
    const clamped = Math.max(0, Math.min(cards.length - 1, next))
    pendingFocus.current = clamped
    setFocusIdx(clamped)
  }

  // Optimistic revoke: the tile vanishes in this tick while the server call
  // reconciles behind it. A failure restores the tile with a note, and a
  // focused tile hands DOM focus to a survivor.
  const doRevoke = (uuid: string, index: number) => {
    const hadFocus = tileRefs.current[index]?.contains(document.activeElement) ?? false
    setArmed(null)
    void (async () => {
      const r = await revokeCardOptimistic(uuid)
      if (!r.ok) {
        setPageNote(r.msg)
        setPageNoteBad(true)
      } else {
        setPageNote("")
      }
      if (hadFocus) {
        const survivors = cards.filter((c) => c.uuid !== uuid)
        if (survivors.length > 0) moveFocus(Math.min(index, survivors.length - 1))
      }
    })()
  }

  const activeIdx = cards.length === 0 ? 0 : Math.min(focusIdx, cards.length - 1)
  const activeName = cards.find((c) => c.uuid === cardUuid)?.name.split(" (")[0]
  const summary = `${cards.length === 1 ? t("cardsCountOne") : t("cardsCount").replace("{n}", String(cards.length))} · ${activeName ? t("cardsActive").replace("{name}", "\u2068" + activeName + "\u2069") : t("cardsActiveNone")}`

  return (
    <div className="flex flex-col gap-4">
      {/* sticky header: title, actions and the live summary stay up on the
          page background while the card tiles scroll beneath them */}
      <div className="sticky top-0 z-10 flex flex-col gap-2 bg-[var(--bg)] pb-2">
        <div className="flex items-center justify-between gap-3 px-1">
          <h2 className="text-[15px] font-semibold text-txt">
            {t("myCards")}
            <span className="ms-2 text-[12.5px] font-normal text-txt3">{cards.length}</span>
          </h2>
          <div className="flex items-center gap-2">
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
        <p aria-live="polite" className="px-1 text-[12px] text-txt3">
          {summary}
        </p>
      </div>

      {pageNote && <Note text={pageNote} bad={pageNoteBad} />}

      {cards.length === 0 ? (
        <Panel className="p-5 text-[13px] text-txt3">{t("noCards")}</Panel>
      ) : (
        <div
          role="listbox"
          aria-label={t("myCards")}
          className="grid grid-cols-1 gap-3 xl:grid-cols-2"
          onFocus={() => setListActive(true)}
          onBlur={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node)) setListActive(false)
          }}
        >
          {cards.map((c, i) => {
            const inUse = c.uuid === cardUuid
            const focused = i === activeIdx && listActive
            const isArmed = armed === c.uuid
            return (
              <div
                key={c.uuid}
                ref={(el) => {
                  tileRefs.current[i] = el
                }}
                role="option"
                aria-selected={inUse}
                aria-label={c.name.split(" (")[0]}
                tabIndex={i === activeIdx ? 0 : -1}
                onFocus={() => setFocusIdx(i)}
                onKeyDown={(e) => {
                  // Inner action buttons keep their own keys: only the tile
                  // itself answers to arrows and Enter.
                  if (e.target !== e.currentTarget) return
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
                    moveFocus(cards.length - 1)
                  } else if (e.key === "Enter") {
                    e.preventDefault()
                    pickCard(c.uuid)
                  }
                }}
                style={{
                  ...(focused ? { borderColor: "var(--brand-line)" } : undefined),
                }}
                className={cn(
                  "glass-tile scroll-mt-20 rounded-[14px] p-3 transition-colors focus-visible:outline-2 focus-visible:outline-[var(--brand-line)] focus-visible:-outline-offset-2",
                  inUse ? "border-[var(--brand-line)]" : "hover:bg-white/[0.02]",
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-[14px] font-medium text-txt" dir="auto">{c.name.split(" (")[0]}</div>
                    <div className="mt-1 truncate text-[12px] text-txt3" dir="auto">{c.sni || "-"}</div>
                  </div>
                  <span className="shrink-0 truncate rounded-full border border-line-strong px-2 py-[3px] text-[11px] text-txt3">
                    {c.card_type === "Streamerz" ? t("kindStreamerz") : t("kindGamerz")}
                  </span>
                </div>

                <div className="mt-3 flex items-center gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    className={cn(
                      "h-8 gap-1.5 rounded-[10px] px-2.5 text-[12px] text-txt3 hover:text-[var(--red)]",
                      isArmed && "border border-[var(--red-line)] bg-[var(--red-bg)] text-[var(--red)]",
                    )}
                    onClick={() => {
                      if (isArmed) doRevoke(c.uuid, i)
                      else {
                        setArmed(c.uuid)
                        setPageNote("")
                      }
                    }}
                  >
                    <Trash2 className="size-3.5" aria-hidden />
                    {isArmed ? t("revokeSure") : t("revoke")}
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
                <span className="shrink-0 text-[11.5px] text-txt3">{t("domainSni")}</span>
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

            {note && <Note text={note} bad={noteBad} />}
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
        "flex items-center gap-2 rounded-[10px] px-3 py-2 text-[12px]",
        bad
          ? "border border-[var(--red-line)] bg-[var(--red-bg)] text-[var(--red)]"
          : "border border-[var(--green-line)] bg-[var(--green-bg)] text-[var(--green)]",
      )}
    >
      {bad ? (
        <TriangleAlert className="size-3.5 shrink-0" aria-hidden />
      ) : (
        <Check className="size-3.5 shrink-0" aria-hidden />
      )}
      {text}
    </p>
  )
}
