import { useEffect, useState } from "react"
import { AnimatePresence, motion } from "motion/react"
import { Sidebar, type Tab } from "@/components/Sidebar"
import { Home } from "@/screens/Home"
import { Speed } from "@/screens/Speed"
import { Voice } from "@/screens/Voice"
import { SpeedHistory } from "@/screens/SpeedHistory"
import { SpeedResult } from "@/screens/SpeedResult"
import { Settings } from "@/screens/Settings"
import { Apps } from "@/screens/Apps"

const EASE_OUT = [0.1, 0.9, 0.2, 1] as const

export default function App() {
  // The hash is the router: #speed, #settings, #apps. Small, but it
  // makes each screen linkable and lets the preview harness open one cold.
  const [tab, setTab] = useState<Tab>(() => {
    const h = (typeof location !== "undefined" ? location.hash.slice(1) : "") as Tab
    return (["home", "speed", "voice", "history", "result", "apps", "settings"] as Tab[]).includes(h) ? h : "home"
  })
  // The stored run opened in the result view, if any.
  const [resultAt, setResultAt] = useState<number | null>(null)

  const go = (t: Tab) => {
    setTab(t)
    try {
      history.replaceState(null, "", "#" + t)
    } catch {
      /* file:// */
    }
  }

  const openResult = (at: number) => {
    setResultAt(at)
    go("result")
  }

  // Back/forward and anything else that moves the hash keeps the shell in step.
  useEffect(() => {
    const onHash = () => {
      const h = location.hash.slice(1) as Tab
      if ((["home", "speed", "voice", "history", "result", "apps", "settings"] as Tab[]).includes(h)) setTab(h)
    }
    window.addEventListener("hashchange", onHash)
    return () => window.removeEventListener("hashchange", onHash)
  }, [])

  return (
    <>
      {/* the night scene the glass refracts: fixed, inert, behind everything */}
      <div className="scene" aria-hidden>
        <span className="orb orb-a" />
        <span className="orb orb-b" />
        <span className="orb orb-c" />
        <span className="orb orb-d" />
      </div>
      <div className="relative z-10 flex h-full">
        <Sidebar tab={tab} onTab={go} />
        <main id="content" className="min-w-0 flex-1 overflow-y-auto scroll-pb-6">
          <div className="mx-auto w-full max-w-[900px] px-8 py-6">
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={tab}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.2, ease: EASE_OUT }}
              >
                {tab === "home" && <Home onOpenApps={() => go("apps")} />}
                {tab === "speed" && <Speed onOpenHistory={() => go("history")} />}
                {tab === "voice" && <Voice />}
                {tab === "history" && <SpeedHistory onBack={() => go("speed")} onOpenResult={openResult} />}
                {tab === "result" && <SpeedResult runAt={resultAt} onBack={() => go("history")} />}
                {tab === "settings" && <Settings />}
                {tab === "apps" && <Apps onBack={() => go("home")} />}
              </motion.div>
            </AnimatePresence>
          </div>
        </main>
      </div>
    </>
  )
}
