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

export type AppsMode = "all" | "allow" | "block"
export type Transport = "vless" | "wg" | "hy2"
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
  refresh: () => Promise<void>
  generateCard: (name: string, kind: string, sni: string) => Promise<CmdResult>
  revokeCard: (uuid: string) => Promise<CmdResult>
  copyCard: (uuid: string) => Promise<CmdResult>
  copyLog: () => Promise<CmdResult>
  pickCard: (uuid: string) => void
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
  const busyRef = useRef(false)
  const vpnRef = useRef(false)

  busyRef.current = busy
  vpnRef.current = vpnOn

  // ---- boot ------------------------------------------------------------
  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const st = await api.state()
        if (!alive) return
        setServerIp(st.server_ip)
        setCards(st.cards)
        setCardUuid((cur) => (st.cards.some((c) => c.uuid === cur) ? cur : st.cards[0]?.uuid ?? ""))
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

  const connect = useCallback(async () => {
    if (!cardUuid) {
      setStatus("Pick a profile first.")
      return
    }
    if (appsMode !== "all" && apps.length === 0) {
      setStatus("Pick at least one app for this routing mode.")
      return
    }
    setBusy(true)
    setPhase("connecting")
    setStatus("")
    try {
      await api.probeServer()
      const r = await api.start(cardUuid, appsMode, apps, transport)
      setStatus(r.msg)
      if (!r.ok) {
        setPhase("idle")
        return
      }
      setVpnOn(true)
      setSessionStart(Date.now())
      setRx(0)
      setTx(0)
      for (let i = 0; i < 8; i++) {
        await new Promise((res) => setTimeout(res, 900))
        const st = await api.status()
        if (st.running) break
        if (st.error) {
          setStatus(st.error)
          setPhase("idle")
          return
        }
      }
      const probe = await api.probeTunnel().catch(() => null)
      setConnected(!!probe?.ok)
      setPhase("on")
      if (probe?.msg) setStatus(probe.msg)
    } catch (e) {
      setStatus(String(e))
      setPhase("idle")
    } finally {
      setBusy(false)
    }
  }, [apps, appsMode, cardUuid, transport])

  const disconnect = useCallback(async () => {
    setBusy(true)
    // Flip the dial first: waiting for the engine round-trip is what made
    // disconnecting feel like it lagged.
    setPhase("stopping")
    setVpnOn(false)
    setConnected(false)
    try {
      const r = await api.stop()
      setStatus(r.msg)
      if (!r.ok) {
        // engine still up: put the UI back where it was
        setVpnOn(true)
        setConnected(true)
        setPhase("on")
        return
      }
    } catch (e) {
      setStatus(String(e))
      setVpnOn(true)
      setPhase("on")
      return
    } finally {
      setBusy(false)
    }
    setSessionStart(null)
    setRx(0)
    setTx(0)
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
    } catch {
      /* the next action reports its own error */
    }
  }, [])

  const generateCard = useCallback(
    async (name: string, kind: string, sni: string) => {
      const r = await api.generateCard(name, kind, sni)
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
    refresh,
    generateCard,
    revokeCard,
    copyCard,
    copyLog,
    pickCard,
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
