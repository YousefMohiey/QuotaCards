import { useEffect, useState } from "react"
import { getCurrentWindow } from "@tauri-apps/api/window"
import { Copy, Minus, Square, X } from "lucide-react"
import { cn } from "@/lib/utils"
import { useI18n } from "@/lib/i18n"
import { isTauri } from "@/lib/ipc"

// The window is undecorated: these are the caption buttons, plus the eight
// invisible resize edges Windows would normally draw. They ride above every
// screen and above the dialogs, the way a real title bar never goes away, and
// they borrow the app's own icon-button rhythm (36px hit area, 10px radius,
// the nav's resting and hover colours, 2px icon strokes) so they read as part
// of the product rather than chrome bolted on. Physical right/top classes on
// purpose: Arabic copy never mirrors the window controls.
const EDGES = [
  { dir: "North", cls: "left-3 right-3 top-0 h-[5px] cursor-ns-resize" },
  { dir: "South", cls: "bottom-0 left-3 right-3 h-[5px] cursor-ns-resize" },
  { dir: "West", cls: "bottom-3 left-0 top-3 w-[5px] cursor-ew-resize" },
  { dir: "East", cls: "bottom-3 right-0 top-3 w-[5px] cursor-ew-resize" },
  { dir: "NorthWest", cls: "left-0 top-0 size-3 cursor-nwse-resize" },
  { dir: "NorthEast", cls: "right-0 top-0 size-3 cursor-nesw-resize" },
  { dir: "SouthWest", cls: "bottom-0 left-0 size-3 cursor-nesw-resize" },
  { dir: "SouthEast", cls: "bottom-0 right-0 size-3 cursor-nwse-resize" },
] as const

const CAPTION =
  "grid size-9 place-items-center rounded-[10px] text-txt2 transition-colors hover:bg-white/[0.08] hover:text-txt active:bg-white/[0.12] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-line)]"

export function WindowControls() {
  const { t } = useI18n()
  const [maximized, setMaximized] = useState(false)

  useEffect(() => {
    if (!isTauri()) return
    const win = getCurrentWindow()
    let alive = true
    const read = () => void win.isMaximized().then((m) => alive && setMaximized(m))
    read()
    const unlisten = win.onResized(read)
    return () => {
      alive = false
      void unlisten.then((f) => f())
    }
  }, [])

  // In the browser preview there is no window to drive; the harness draws none.
  if (!isTauri()) return null
  const win = getCurrentWindow()

  return (
    <>
      {EDGES.map(({ dir, cls }) => (
        <div
          key={dir}
          aria-hidden
          data-no-drag
          className={cn("fixed z-40", cls)}
          onMouseDown={(e) => {
            if (e.button !== 0) return
            e.preventDefault()
            void win.startResizeDragging(dir).catch(() => {})
          }}
        />
      ))}

      <div className="fixed right-2.5 top-2 z-[60] flex items-center gap-1" data-no-drag>
        <button
          type="button"
          aria-label={t("winMin")}
          title={t("winMin")}
          className={CAPTION}
          onClick={() => void win.minimize().catch(() => {})}
        >
          <Minus className="size-4" strokeWidth={2} aria-hidden />
        </button>
        <button
          type="button"
          aria-label={maximized ? t("winRestore") : t("winMax")}
          title={maximized ? t("winRestore") : t("winMax")}
          className={CAPTION}
          onClick={() => void win.toggleMaximize().catch(() => {})}
        >
          {maximized ? (
            <Copy className="size-[15px]" strokeWidth={1.75} aria-hidden />
          ) : (
            <Square className="size-[14px]" strokeWidth={1.75} aria-hidden />
          )}
        </button>
        <button
          type="button"
          aria-label={t("winClose")}
          title={t("winClose")}
          className={cn(CAPTION, "hover:bg-[#e5484d]/20 hover:text-[#ff9aa0] active:bg-[#e5484d]/30")}
          onClick={() => void win.close().catch(() => {})}
        >
          <X className="size-4" strokeWidth={2} aria-hidden />
        </button>
      </div>
    </>
  )
}
