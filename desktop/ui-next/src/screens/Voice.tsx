import { useEffect, useState } from "react"
import { Power } from "lucide-react"
import { Panel } from "@/components/Row"
import { ValorantMark } from "@/components/ValorantMark"
import { useI18n } from "@/lib/i18n"
import { useApp } from "@/state/app"
import { api } from "@/lib/ipc"
import { cn } from "@/lib/utils"

// The Valorant helper: one job, one switch. Everything the switch needs to do
// under the hood (routing rules, ports, engine session) stays in the engine,
// nothing technical reaches this page.
export function Voice() {
  const { t } = useI18n()
  const { card, appsMode, apps, transport } = useApp()
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
        // Turning the helper off must not disturb the rest of the session:
        // a merged session restarts with the same setup minus the voice
        // rules, a voice-only session just stops.
        const merged = localStorage.getItem("qc-voice-merged") === "1"
        if (merged && card) {
          const r = await api.start(card.uuid, appsMode, apps, transport, false)
          if (!r.ok) setMsg(r.msg)
        } else {
          const r = await api.stop()
          setRunning(false)
          if (!r.ok) setMsg(r.msg)
        }
        localStorage.removeItem("qc-voice-active")
        localStorage.removeItem("qc-voice-merged")
      } else {
        if (!card) {
          setMsg(t("needCard"))
          return
        }
        // A running session keeps its configuration and gains the voice
        // rules; with nothing running this starts a voice-only session.
        const merged = running
        const r = await api.start(card.uuid, merged ? appsMode : "allow", merged ? apps : [], transport, true)
        if (r.ok) {
          localStorage.setItem("qc-voice-active", "1")
          localStorage.setItem("qc-voice-merged", merged ? "1" : "0")
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

  const steps: string[] = [t("voiceStep1"), t("voiceStep2"), t("voiceStep3")]

  return (
    <div className="flex flex-col gap-3">
      {/* header: the mark carries the page, the badge answers "is it on?" */}
      <div className="flex items-center gap-3.5 px-1">
        <span
          className="grid size-14 shrink-0 place-items-center rounded-[16px] border border-line bg-white/[0.03]"
          aria-hidden
        >
          <ValorantMark className="size-7 text-txt" />
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="text-[15px] font-semibold text-txt">{t("voiceTitle")}</h1>
          <p className="mt-0.5 text-[12.5px] text-txt3">{t("voiceSub")}</p>
        </div>
        <span
          className={cn(
            "inline-flex h-7 shrink-0 items-center gap-2 rounded-full border px-3 text-[12px] font-medium",
            on
              ? "border-[var(--brand-line)] bg-[var(--brand-bg)] text-brand-strong"
              : "border-line bg-white/[0.02] text-txt2",
          )}
        >
          <span className={cn("size-1.5 rounded-full", on ? "bg-brand" : "bg-white/25")} aria-hidden />
          {on ? t("voiceBadgeOn") : t("voiceBadgeOff")}
        </span>
      </div>

      {/* the one card that matters: what it is, and the switch */}
      <Panel>
        <div className="p-4">
          <h2 className="text-[13.5px] font-semibold text-txt">{t("voiceCardTitle")}</h2>
          <p className="mt-1 max-w-[62ch] text-[12.5px] leading-relaxed text-txt2">{t("voiceCardBody")}</p>

          <div
            className={cn(
              "mt-3.5 flex flex-wrap items-center gap-3 rounded-[14px] border px-3.5 py-3 transition-colors duration-200",
              on
                ? "border-[var(--brand-line)] bg-[var(--brand-bg)]"
                : "border-line bg-white/[0.02]",
            )}
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="text-[13px] font-semibold text-txt">{t("voiceHelper")}</span>
                {on && <span className="size-1.5 rounded-full bg-brand" aria-hidden />}
              </div>
              <p className="mt-0.5 text-[12px] leading-relaxed text-txt2">
                {on ? t("voiceHelperOn") : t("voiceHelperOff")}
              </p>
            </div>
            <button
              type="button"
              disabled={busy || !card}
              onClick={() => void toggle()}
              className={cn(
                "flex h-10 shrink-0 items-center justify-center gap-2 rounded-[10px] border px-5 text-[13px] font-semibold transition-colors duration-200 disabled:cursor-not-allowed disabled:opacity-60",
                on
                  ? "border-line bg-white/[0.03] text-txt hover:border-[var(--brand-line)]"
                  : "border-[var(--brand)] bg-[var(--brand-bg)] text-brand-strong hover:border-[var(--brand)]",
              )}
            >
              <Power className="size-3.5" aria-hidden />
              {busy ? "…" : on ? t("voiceTurnOff") : t("voiceTurnOn")}
            </button>
          </div>

          <p className="mt-2.5 text-[11.5px] text-txt3">{t("voiceNote")}</p>
          {msg && <p className="mt-2 text-[11.5px] text-txt2">{msg}</p>}
        </div>
      </Panel>

      {/* three steps, no networking in sight */}
      <Panel>
        <div className="border-b border-line px-4 py-2.5 text-[12px] font-medium text-txt2">
          {t("voiceHow")}
        </div>
        {steps.map((step, i) => (
          <div key={i} className="flex items-center gap-3 border-b border-line px-4 py-2.5 last:border-b-0">
            <span
              className="grid size-5 shrink-0 place-items-center rounded-full border border-line bg-white/[0.03] text-[10.5px] font-medium text-txt3 tabular-nums"
              aria-hidden
            >
              {i + 1}
            </span>
            <span className="min-w-0 text-[12.5px] text-txt2">{step}</span>
          </div>
        ))}
      </Panel>

      <Panel>
        <div className="p-4">
          <p className="text-[12.5px] font-medium text-txt2">{t("voiceInfoTitle")}</p>
          <p className="mt-1 max-w-[62ch] text-[12px] leading-relaxed text-txt2">{t("voiceInfoBody")}</p>
        </div>
      </Panel>
    </div>
  )
}
