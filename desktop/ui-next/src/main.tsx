import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { TooltipProvider } from "@/components/ui/tooltip"
import { I18nProvider } from "@/lib/i18n"
import { AppStateProvider } from "@/state/app"
import App from "./App"
import "./index.css"

// Right-click stays inside the app: the browser's own menu (Reload, Save
// as, Inspect) has no place in a shipped product window.
window.addEventListener("contextmenu", (e) => e.preventDefault())

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <I18nProvider>
      <AppStateProvider>
        <TooltipProvider>
          <App />
        </TooltipProvider>
      </AppStateProvider>
    </I18nProvider>
  </StrictMode>,
)
