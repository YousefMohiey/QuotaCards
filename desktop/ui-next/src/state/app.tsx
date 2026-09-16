import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react"
import { api, type Card, type CmdResult, type UpdateInfo } from "@/lib/ipc"
import { useI18n } from "@/lib/i18n"
import { DEFAULT_SNI } from "@/lib/snis"

export type AppsMode = "all" | "allow" | "block"
export type Transport = "vless" | "wg" | "hy2"
export type PresetKind = "Gamerz" | "Streamerz"
/** One dial state that both the hero and the sidebar read. */
export type Phase = "idle" | "connecting" | "on" | "stopping"

type Value = {
  ready: boolean
  serverIp: string
  cards: Card[]
  card: Card | undefined
  cardUuid: string
  appsMode: AppsMode
  apps: string[]
  transport: Transport
  vpnOn: boolean
  connected: boolean
  busy: boolean
  phase: Phase
  status: string
  rx: number
  tx: number
  sessionStart: number | null
  update: UpdateInfo | null
  updateState: "idle" | "checking" | "latest" | "available" | "error"
  version: string
  refresh: () => Promise<void>
  generateCard: (name: string, kind: string, sni: string) => Promise<CmdResult>
  importCard: (uuid: string, name: string, kind: string, sni: string) => Promise<CmdResult>
  revokeCard: (uuid: string) => Promise<CmdResult>
  revokeCardOptimistic: (uuid: string) => Promise<CmdResult>
  ensurePresetCard: (p: PresetKind) => Promise<CmdResult>
  copyCard: (uuid: string) => Promise<CmdResult>
  copyLog: () => Promise<CmdResult>
  pickCard: (uuid: string) => void
  preset: PresetKind
  setPreset: (p: PresetKind) => void
  setAppsMode: (m: AppsMode) => void
  setApps: (list: string[]) => void
  setTransport: (t: Transport) => void
  toggle: () => void
  checkUpdates: () => void
  applyUpdate: () => void
  loadApps: () => Promise<Array<{ pkg: string; label: string }>>
}

const Ctx = createContext<Value | null>(null)

const read = <T,>(key: string, fallback: T): T => {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}
const write = (key: string, value: unknown) => {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* private mode */
  }
}

export function AppStateProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false)
  const [serverIp, setServerIp] = useState("")
  const [cards, setCards] = useState<Card[]>([])
  const [cardUuid, setCardUuid] = useState<string>(() => read("qc-card", ""))
  const [preset, setPresetState] = useState<PresetKind>(() => read<PresetKind>("qc-preset", "Gamerz"))
  const [appsMode, setAppsModeState] = useState<AppsMode>(() => read<AppsMode>("qc-apps-mode", "all"))
  const [apps, setAppsState] = useState<string[]>(() => read<string[]>("qc-apps", []))
  const [transport, setTransportState] = useState<Transport>(() => read<Transport>("qc-transport", "vless"))
  const [vpnOn, setVpnOn] = useState(false)
  const [connected, setConnected] = useState(false)
  const [busy, setBusy] = useState(false)
  const [phase, setPhase] = useState<Phase>("idle")
  const [status, setStatus] = useState("")
  const [rx, setRx] = useState(0)
  const [tx, setTx] = useState(0)
  const [sessionStart, setSessionStart] = useState<number | null>(null)
  const [update, setUpdate] = useState<UpdateInfo | null>(null)
  const [updateState, setUpdateState] = useState<Value["updateState"]>("idle")
  const [version, setVersion] = useState("")
  const busyRef = useRef(false)
  const vpnRef = useRef(false)
  // Guards the staged disconnect teardown below: any new connect run
  // invalidates a pending clear so fresh session data is never wiped.
  const teardownRef = useRef(0)
  const { t } = useI18n()

  busyRef.current = busy
  vpnRef.current = vpnOn
  const cardsRef = useRef<Card[]>([])
  const cardUuidRef = useRef("")
  cardsRef.current = cards
  cardUuidRef.current = cardUuid

  // ---- boot ------------------------------------------------------------
  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const st = await api.state()
        if (!alive) return
        setServerIp(st.server_ip)
        setCards(st.cards)
        setVersion(st.version)
        setCardUuid((cur) => (st.cards.some((c) => c.uuid === cur) ? cur : st.cards[0]?.uuid ?? ""))
        // The preset follows the first card when nothing was ever picked,
        // so a returning install opens on the kind it actually uses.
        try {
          if (localStorage.getItem("qc-preset") == null) {
            const first = st.cards.find((c) => c.card_type === "Gamerz" || c.card_type === "Streamerz")
            if (first) setPresetState(first.card_type as PresetKind)
          }
        } catch {
          /* private mode */
        }
        // An engine can outlive the window (tray close, crash re-open):
        // pick the live state back up instead of showing "ready".
        const tunnel = await api.status().catch(() => null)
        if (alive && tunnel?.running) {
          setVpnOn(true)
          setPhase("on")
          setSessionStart(Date.now())
        }
      } catch {
        /* the UI still renders, every action reports its own error */
      } finally {
        if (alive) setReady(true)
      }
    })()
    return () => {
      alive = false
    }
  }, [])

  // ---- poll while the tunnel is up -------------------------------------
  // A quiet check a few seconds after start. Nothing happens unless a new
  // build really exists, so it can never nag for no reason.
  useEffect(() => {
    const id = window.setTimeout(() => void checkUpdates(), 4000)
    return () => window.clearTimeout(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!vpnOn) return
    let alive = true
    const tick = async () => {
      try {
        const [st, tr] = await Promise.all([api.status(), api.traffic()])
        if (!alive) return
        setConnected(st.running && !st.error)
        setRx(tr.rx)
        setTx(tr.tx)
        if (st.error) setStatus(st.error)
      } catch {
        /* engine gone; the connect button will surface it */
      }
    }
    void tick()
    const id = window.setInterval(tick, 2000)
    return () => {
      alive = false
      window.clearInterval(id)
    }
  }, [vpnOn])

  const card = useMemo(() => cards.find((c) => c.uuid === cardUuid), [cards, cardUuid])

  const pickCard = useCallback((uuid: string) => {
    setCardUuid(uuid)
    write("qc-card", uuid)
  }, [])

  const setAppsMode = useCallback((m: AppsMode) => {
    setAppsModeState(m)
    write("qc-apps-mode", m)
  }, [])

  const setApps = useCallback((list: string[]) => {
    setAppsState(list)
    write("qc-apps", list)
  }, [])

  const setTransport = useCallback((t: Transport) => {
    setTransportState(t)
    write("qc-transport", t)
  }, [])

  const setPreset = useCallback((p: PresetKind) => {
    setPresetState(p)
    write("qc-preset", p)
  }, [])

  const connect = useCallback(async () => {
    teardownRef.current += 1
    // A routing mode with nothing behind it can never match: fall back to
    // the whole device instead of silently doing nothing.
    let mode = appsMode
    if (appsMode !== "all" && apps.length === 0) {
      mode = "all"
      setAppsMode("all")
      setStatus(t("appsEmptyFallback"))
    }
    setBusy(true)
    setPhase("connecting")
    if (mode === appsMode) setStatus("")
    try {
      // One-tap connect: make sure a card of the selected preset kind
      // exists first, creating it through the normal detached path.
      let uuid = cardUuid
      const current = cards.find((c) => c.uuid === uuid)
      if (!current || current.card_type !== preset) {
        const existing = cards.find((c) => c.card_type === preset)
        if (existing) {
          uuid = existing.uuid
        } else {
          const g = await api.generateCard(preset, preset, DEFAULT_SNI[preset])
          if (!g.ok) {
            setStatus(g.msg)
            setPhase("idle")
            return
          }
          const st = await api.state()
          setCards(st.cards)
          const created = st.cards.find((c) => c.card_type === preset)
          if (!created) {
            setStatus(g.msg)
            setPhase("idle")
            return
          }
          uuid = created.uuid
        }
        setCardUuid(uuid)
        write("qc-card", uuid)
      }
      await api.probeServer()
      const r = await api.start(uuid, mode, apps, transport)
      setStatus(r.msg)
      if (!r.ok) {
        setPhase("idle")
        return
      }
      setVpnOn(true)
      setSessionStart(Date.now())
      setRx(0)
      setTx(0)
      // Check the engine state before the first sleep so an already-up
      // engine (and the instant mock) resolves without paying a full wait.
      for (let i = 0; i < 8; i++) {
        const st = await api.status()
        if (st.running) break
        if (st.error) {
          setStatus(st.error)
          setPhase("idle")
          return
        }
        if (i < 7) await new Promise((res) => setTimeout(res, 900))
      }
      const probe = await api.probeTunnel().catch(() => null)
      setConnected(!!probe?.ok)
      setPhase("on")
      // Success messages (like the reachable line) stay out of the UI;
      // only a failed probe gets to speak.
      if (probe && !probe.ok && probe.msg) setStatus(probe.msg)
      else setStatus("")
    } catch (e) {
      setStatus(String(e))
      setPhase("idle")
    } finally {
      setBusy(false)
    }
  }, [apps, appsMode, cards, cardUuid, preset, t, transport])

  const disconnect = useCallback(async () => {
    setBusy(true)
    // Flip the dial first: waiting for the engine round-trip is what made
    // disconnecting feel like it lagged.
    setPhase("stopping")
    // Stop polling, but keep everything the panel shows mounted until the
    // slide-back lands; clearing it early is what made data vanish mid-move.
    setVpnOn(false)
    try {
      const r = await api.stop()
      if (!r.ok) {
        setStatus(r.msg)
        // engine still up: put the UI back where it was
        setVpnOn(true)
        setConnected(true)
        setPhase("on")
        return
      }
      // A clean stop says nothing: the dial and the panel already show the
      // state, and the backend's "VPN off." line read as noise under the name.
      setStatus("")
    } catch (e) {
      setStatus(String(e))
      setVpnOn(true)
      setConnected(true)
      setPhase("on")
      return
    } finally {
      setBusy(false)
    }
    // The slide-back settles in about four hundred milliseconds; clear the
    // session only once it lands, never under a moving dial. A fresh connect
    // invalidates this wait so new data is never wiped.
    const id = ++teardownRef.current
    await new Promise((res) => setTimeout(res, 420))
    if (teardownRef.current !== id) return
    setSessionStart(null)
    setRx(0)
    setTx(0)
    setConnected(false)
    setPhase("idle")
  }, [])

  const toggle = useCallback(() => {
    if (busyRef.current) return
    void (vpnRef.current ? disconnect() : connect())
  }, [connect, disconnect])

  const checkUpdates = useCallback(async () => {
    setUpdateState("checking")
    try {
      const info = await api.checkUpdate()
      setUpdate(info)
      setUpdateState(info.available ? "available" : "latest")
    } catch {
      setUpdateState("error")
    }
  }, [])

  const applyUpdate = useCallback(async () => {
    try {
      await api.applyUpdate()
    } catch (e) {
      setStatus(String(e))
    }
  }, [])

  const loadApps = useCallback(async () => {
    try {
      const raw = (await api.apps()).trim()
      if (!raw) return []
      // Windows sends a JSON array of {pkg, label}; the phone sends one
      // process name per line. Take either.
      if (raw.startsWith("[")) {
        const arr = JSON.parse(raw) as Array<{ pkg?: string; label?: string }>
        return arr
          .map((a) => ({ pkg: a.pkg ?? "", label: a.label ?? a.pkg ?? "" }))
          .filter((a) => a.pkg)
      }
      return raw
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean)
        .map((pkg) => ({ pkg, label: pkg }))
    } catch {
      return []
    }
  }, [])

  const refresh = useCallback(async () => {
    try {
      const st = await api.state()
      setServerIp(st.server_ip)
      setCards(st.cards)
      // Repair a selection that points at nothing (revoked active card, first
      // card landing on an empty selection) so every derived label re-renders
      // from fresh state in the same tick.
      if (!st.cards.some((c) => c.uuid === cardUuidRef.current)) {
        const fallback = st.cards[0]?.uuid ?? ""
        setCardUuid(fallback)
        write("qc-card", fallback)
      }
    } catch {
      /* the next action reports its own error */
    }
  }, [])

  const generateCard = useCallback(
    async (name: string, kind: string, sni: string) => {
      // The backend Err path (saved locally but server registration failed)
      // rejects the invoke, so convert it to a visible CmdResult and still
      // refresh: the local card stays in all cases.
      try {
        const r = await api.generateCard(name, kind, sni)
        await refresh()
        return r
      } catch (e) {
        await refresh()
        return { ok: false, msg: e instanceof Error ? e.message : String(e) }
      }
    },
    [refresh],
  )

  const importCard = useCallback(
    async (uuid: string, name: string, kind: string, sni: string) => {
      const r = await api.importCard(uuid, name, kind, sni)
      await refresh()
      return r
    },
    [refresh],
  )

  const revokeCard = useCallback(
    async (uuid: string) => {
      const r = await api.revokeCard(uuid)
      await refresh()
      return r
    },
    [refresh],
  )

  // One-tap preset support: flip the preset, make sure that kind exists
  // (generating it when missing), and select it. No connection involved.
  const presetBusyRef = useRef<PresetKind | null>(null)
  const ensurePresetCard = useCallback(
    async (p: PresetKind) => {
      if (presetBusyRef.current) return { ok: true, msg: "" }
      setPresetState(p)
      write("qc-preset", p)
      const existing = cardsRef.current.find((c) => c.card_type === p)
      if (existing) {
        setCardUuid(existing.uuid)
        write("qc-card", existing.uuid)
        return { ok: true, msg: "" }
      }
      presetBusyRef.current = p
      try {
        const g = await api.generateCard(p, p, DEFAULT_SNI[p])
        if (!g.ok) {
          setStatus(g.msg)
          return g
        }
        const st = await api.state()
        setServerIp(st.server_ip)
        setCards(st.cards)
        const created = st.cards.find((c) => c.card_type === p)
        if (created) {
          setCardUuid(created.uuid)
          write("qc-card", created.uuid)
        } else {
          setStatus(g.msg)
        }
        return g
      } catch (e) {
        const r = { ok: false, msg: String(e) }
        setStatus(r.msg)
        return r
      } finally {
        presetBusyRef.current = null
      }
    },
    [],
  )

  // Optimistic revoke: the tile leaves in this tick, the server reconciles in
  // the background. A failure puts the exact snapshot back.
  const revokeCardOptimistic = useCallback(
    async (uuid: string) => {
      const before = cardsRef.current
      const beforeUuid = cardUuidRef.current
      const survivors = before.filter((c) => c.uuid !== uuid)
      setCards(survivors)
      if (beforeUuid === uuid) {
        const fallback = survivors[0]?.uuid ?? ""
        setCardUuid(fallback)
        write("qc-card", fallback)
      }
      let r: CmdResult
      try {
        r = await api.revokeCard(uuid)
      } catch (e) {
        r = { ok: false, msg: String(e) }
      }
      if (!r.ok) {
        setCards(before)
        if (cardUuidRef.current !== beforeUuid) {
          setCardUuid(beforeUuid)
          write("qc-card", beforeUuid)
        }
      } else {
        await refresh()
      }
      return r
    },
    [refresh],
  )

  const copyCard = useCallback((uuid: string) => api.copyCard(uuid), [])
  const copyLog = useCallback(() => api.copyLog(), [])

  const value: Value = {
    ready,
    serverIp,
    cards,
    card,
    cardUuid,
    appsMode,
    apps,
    transport,
    vpnOn,
    connected,
    busy,
    phase,
    status,
    rx,
    tx,
    sessionStart,
    update,
    updateState,
    version,
    refresh,
    generateCard,
    importCard,
    revokeCard,
    revokeCardOptimistic,
    ensurePresetCard,
    copyCard,
    copyLog,
    pickCard,
    preset,
    setPreset,
    setAppsMode,
    setApps,
    setTransport,
    toggle,
    checkUpdates,
    applyUpdate,
    loadApps,
  }

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useApp(): Value {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error("useApp must be used inside AppStateProvider")
  return ctx
}
