import { useEffect, useState } from "react"
import { AnimatePresence, motion } from "motion/react"
import { Sidebar, type Tab } from "@/components/Sidebar"
import { Home } from "@/screens/Home"
import { Cards } from "@/screens/Cards"
import { Speed } from "@/screens/Speed"
import { Settings } from "@/screens/Settings"
import { Apps } from "@/screens/Apps"

const EASE_OUT = [0.1, 0.9, 0.2, 1] as const

export default function App() {
  // The hash is the router: #speed, #cards, #settings, #apps. Small, but it
  // makes each screen linkable and lets the preview harness open one cold.
  const [tab, setTab] = useState<Tab>(() => {
    const h = (typeof location !== "undefined" ? location.hash.slice(1) : "") as Tab
    return (["home", "cards", "speed", "apps", "settings"] as Tab[]).includes(h) ? h : "home"
  })

  const go = (t: Tab) => {
    setTab(t)
    try {
      history.replaceState(null, "", "#" + t)
    } catch {
      /* file:// */
    }
  }

  // Back/forward and anything else that moves the hash keeps the shell in step.
  useEffect(() => {
    const onHash = () => {
      const h = location.hash.slice(1) as Tab
      if ((["home", "cards", "speed", "apps", "settings"] as Tab[]).includes(h)) setTab(h)
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
        <main id="content" className="min-w-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-[900px] px-8 py-7">
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={tab}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.2, ease: EASE_OUT }}
              >
                {tab === "home" && <Home onOpenApps={() => go("apps")} />}
                {tab === "cards" && <Cards />}
                {tab === "speed" && <Speed />}
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
