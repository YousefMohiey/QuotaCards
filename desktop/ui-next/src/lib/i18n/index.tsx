import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react"
import { en } from "./en"
import { ar } from "./ar"

export type Lang = "en" | "ar"
export type StrKey = keyof typeof en

const DICTS: Record<Lang, Record<string, string>> = { en, ar }

type I18nValue = {
  lang: Lang
  setLang: (l: Lang) => void
  t: (k: StrKey) => string
}

const I18nContext = createContext<I18nValue | null>(null)

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLang] = useState<Lang>(() => {
    try {
      return localStorage.getItem("qc-lang") === "ar" ? "ar" : "en"
    } catch {
      return "en"
    }
  })

  useEffect(() => {
    // Arabic copy reads right to left, but the layout itself never mirrors:
    // the 0.2.x rule was "icons stay in place".
    document.documentElement.lang = lang
    try {
      localStorage.setItem("qc-lang", lang)
    } catch {
      /* private mode */
    }
  }, [lang])

  const t = useCallback(
    (k: StrKey) => DICTS[lang][k] ?? DICTS.en[k] ?? String(k),
    [lang],
  )

  const value = useMemo(() => ({ lang, setLang, t }), [lang, t])
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useI18n(): I18nValue {
  const ctx = useContext(I18nContext)
  if (!ctx) throw new Error("useI18n must be used inside I18nProvider")
  return ctx
}
