/** Same presets the 0.2.x builds offered, kept in one place. */
export const SNIS: Record<"Gamerz" | "Streamerz", Array<[string, string]>> = {
  Gamerz: [
    ["EA", "ea.com"],
    ["Valorant", "playvalorant.com"],
    ["Riot (LoL)", "riotgames.com"],
    ["Call of Duty", "callofduty.com"],
    ["Activision", "activision.com"],
    ["PUBG", "pubg.com"],
    ["PUBG Mobile", "pubgmobile.com"],
    ["Gameloft / Asphalt", "gameloft.com"],
    ["Steam", "store.steampowered.com"],
  ],
  Streamerz: [
    ["YouTube", "youtube.com"],
    ["Facebook", "facebook.com"],
    ["Instagram", "instagram.com"],
    ["Twitter / X", "twitter.com"],
    ["Snapchat", "snapchat.com"],
    ["Prime Video", "primevideo.com"],
    ["Apple TV", "tv.apple.com"],
    ["Shahid", "shahid.mbc.net"],
    ["OSN+", "osnplus.com"],
    ["TikTok", "tiktok.com"],
    ["Netflix", "netflix.com"],
  ],
}

export const DEFAULT_SNI: Record<"Gamerz" | "Streamerz", string> = {
  Gamerz: "ea.com",
  Streamerz: "youtube.com",
}

export const CUSTOM_SNI = "__custom"

export type SniKind = "Gamerz" | "Streamerz"

export const labelForSni = (sni: string): string => {
  for (const list of Object.values(SNIS)) {
    const hit = list.find(([, d]) => d === sni)
    if (hit) return hit[0]
  }
  return sni
}
