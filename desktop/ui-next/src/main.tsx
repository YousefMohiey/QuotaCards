import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { TooltipProvider } from "@/components/ui/tooltip"
import { I18nProvider } from "@/lib/i18n"
import { AppStateProvider } from "@/state/app"
import App from "./App"
import "./index.css"

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
