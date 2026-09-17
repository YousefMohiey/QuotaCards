import { useEffect, useState } from "react"
import { Power } from "lucide-react"
import { Panel, Row } from "@/components/Row"
import { ValorantMark } from "@/components/ValorantMark"
import { useI18n } from "@/lib/i18n"
import { useApp } from "@/state/app"
import { api } from "@/lib/ipc"
import { cn } from "@/lib/utils"

// Voice boost: only VALORANT's voice channels ride the tunnel, the game itself
// keeps the user's own connection. The engine session is flagged in
// localStorage so this page can tell a voice session apart from a normal one.
export function Voice() {
  const { t } = useI18n()
  const { card } = useApp()
  const [running, setRunning] = useState(false)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState("")

  useEffect(() => {
    let alive = true
    const poll = async () => {
      try {
        const st = await api.status()
        if (alive) setRunning(st.running)
      } catch {
        /* engine not reachable yet */
      }
    }
    void poll()
    const id = window.setInterval(() => void poll(), 2000)
    return () => {
      alive = false
      window.clearInterval(id)
    }
  }, [])

  const on = running && localStorage.getItem("qc-voice-active") === "1"

  const toggle = async () => {
    setBusy(true)
    setMsg("")
    try {
      if (on) {
        const r = await api.stop()
        localStorage.removeItem("qc-voice-active")
        setRunning(false)
        if (!r.ok) setMsg(r.msg)
      } else {
        if (!card) {
          setMsg(t("needCard"))
          return
        }
        // allow-mode with the Riot processes; the engine turns that into the
        // voice-only rule set (voice ports and Vivox proxy, rest direct).
        const r = await api.start(card.uuid, "allow", [], "vless", true)
        if (r.ok) {
          localStorage.setItem("qc-voice-active", "1")
          setRunning(true)
        } else {
          setMsg(r.msg)
        }
      }
    } catch (e) {
      setMsg(typeof e === "string" ? e : String(e))
    } finally {
      setBusy(false)
    }
  }

  const routes: Array<[string, string]> = [
    [t("voiceRoutePorts"), t("voiceProxy")],
    [t("voiceRouteVivox"), t("voiceProxy")],
    [t("voiceRouteRest"), t("voiceDirect")],
  ]

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-start gap-3 px-1">
        <span
          className="grid size-10 shrink-0 place-items-center rounded-[12px] border border-line bg-white/[0.02] text-brand-strong"
          aria-hidden
        >
          <ValorantMark className="size-[21px]" />
        </span>
        <div className="min-w-0">
          <h1 className="text-[15px] font-semibold text-txt">{t("voiceTitle")}</h1>
          <p className="mt-0.5 text-[12.5px] leading-relaxed text-txt3">{t("voiceSub")}</p>
        </div>
      </div>

      <Panel>
        <Row label={t("voiceState")}>
          <span
            className={cn(
              "inline-flex h-7 items-center gap-2 rounded-full border px-3 text-[12px] font-medium",
              on
                ? "border-[var(--brand-line)] bg-[var(--brand-bg)] text-brand-strong"
                : "border-line bg-white/[0.02] text-txt2",
            )}
          >
            <span className={cn("size-1.5 rounded-full", on ? "bg-brand" : "bg-white/25")} aria-hidden />
            {on ? t("voiceStateOn") : t("voiceStateOff")}
          </span>
        </Row>
        <div className="px-4 pb-4 pt-1">
          <button
            type="button"
            disabled={busy || !card}
            onClick={() => void toggle()}
            className={cn(
              "flex h-11 w-full items-center justify-center gap-2 rounded-[12px] border text-[13px] font-semibold transition-colors duration-200 disabled:cursor-not-allowed disabled:opacity-60",
              on
                ? "border-line bg-white/[0.03] text-txt hover:border-[var(--brand-line)]"
                : "border-[var(--brand-line)] bg-[var(--brand-bg)] text-brand-strong hover:border-[var(--brand)]",
            )}
          >
            <Power className="size-4" aria-hidden />
            {busy ? "…" : on ? t("voiceTurnOff") : t("voiceTurnOn")}
          </button>
          <p className="mt-2 text-[11.5px] text-txt3">{t("voiceNote")}</p>
          {msg && <p className="mt-2 text-[11.5px] text-txt2">{msg}</p>}
        </div>
      </Panel>

      <Panel>
        <div className="border-b border-line px-4 py-2.5 text-[12px] font-medium text-txt2">
          {t("voiceRoutesTitle")}
        </div>
        {routes.map(([what, where], i) => (
          <div key={i} className="flex items-center justify-between gap-3 border-b border-line px-4 py-2.5 last:border-b-0">
            <span className="min-w-0 truncate text-[12.5px] text-txt2">{what}</span>
            <span className={cn("shrink-0 text-[11.5px]", on ? "text-brand-strong" : "text-txt3")}>{where}</span>
          </div>
        ))}
      </Panel>
    </div>
  )
}
