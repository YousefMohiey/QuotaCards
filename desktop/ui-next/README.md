# QuotaVPN desktop UI (ui-next)

The Windows front end: React 19 + TypeScript + Vite, Tailwind v4, and the glass theme tokens in `src/index.css`. All user-facing strings live in `src/lib/i18n/` (English and formal Arabic).

## Commands

- `npm run dev` - dev server on port 1420 (the Tauri `devUrl`)
- `npm run build` - type check plus production build into `dist/` (what the app bundles)
- `npm run preview` - serve the built `dist/`
- `npm run lint` - oxlint

## Preview without the engine

Outside Tauri every call falls back to `src/lib/mock.ts`, so the whole UI renders in a plain browser:

- `?vpn=1` - connected state
- `?upd=1` - update reminder visible
- `#speed`, `#history`, `#apps`, `#settings` - cold-load a screen
- `localStorage.setItem("qc-lang","ar")` then reload for Arabic

## Rules

- Reuse the components in `src/components/` and the tokens in `index.css`; never invent a new visual language per screen.
- The searchable list picker is the house pattern for choosing things (no dropdowns).
- English and Arabic both ship; keep formal MSA in Arabic copy.
