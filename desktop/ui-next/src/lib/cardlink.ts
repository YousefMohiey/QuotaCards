import { DEFAULT_SNI, SNIS, type SniKind } from "./snis"

export type ParsedCard = { uuid: string; name: string; kind: SniKind; sni: string }

const UUID_RE = /^[0-9a-fA-F]{8}-?[0-9a-fA-F]{4}-?[0-9a-fA-F]{4}-?[0-9a-fA-F]{4}-?[0-9a-fA-F]{12}$/

/**
 * Takes whatever the user pasted: a vless link from the copy button, or a
 * bare UUID. The kind is inferred from the domain so the card lands in the
 * right group without another question.
 */
export function parseCardLink(text: string): ParsedCard | null {
  const raw = text.trim()
  if (!raw) return null

  if (raw.toLowerCase().startsWith("vless://")) {
    const body = raw.slice("vless://".length)
    const uuid = body.split("@")[0].split("?")[0].split("#")[0].trim()
    if (!UUID_RE.test(uuid)) return null

    const afterAt = body.includes("@") ? body.slice(body.indexOf("@") + 1) : ""
    const query = afterAt.includes("?") ? afterAt.slice(afterAt.indexOf("?") + 1).split("#")[0] : ""
    let sni = ""
    for (const pair of query.split("&")) {
      const [k, v] = pair.split("=")
      if (k && k.toLowerCase() === "sni" && v) sni = decodeURIComponent(v)
    }
    const frag = afterAt.includes("#") ? decodeURIComponent(afterAt.slice(afterAt.indexOf("#") + 1)) : ""
    const kind: SniKind = SNIS.Gamerz.some(([, d]) => d === sni) ? "Gamerz" : sni ? "Streamerz" : "Gamerz"
    return {
      uuid,
      name: frag.trim() || "Card",
      kind,
      sni: sni || DEFAULT_SNI[kind],
    }
  }

  if (UUID_RE.test(raw)) {
    return { uuid: raw, name: "Card", kind: "Gamerz", sni: DEFAULT_SNI.Gamerz }
  }
  return null
}
