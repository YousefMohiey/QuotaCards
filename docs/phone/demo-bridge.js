/*
 * Demo bridge for the QuotaVPN website.
 * The phone app talks to the native side through __TAURI_INTERNALS__.invoke;
 * on the website there is no native side, so this shim answers the same
 * commands with the same shapes the Kotlin plugin returns. It is only used by
 * the copy of the UI served under /phone on the site - the shipped APK never
 * loads this file.
 */
(() => {
  const q = new URLSearchParams(location.search);
  let running = q.get("vpn") === "1";
  let rx = 0;
  let tx = 0;

  const cards = [
    { uuid: "11111111-1111-4111-8111-111111111111", name: "Gamerz", card_type: "Gamerz", sni: "playvalorant.com" },
    { uuid: "22222222-2222-4222-8222-222222222222", name: "Streamerz", card_type: "Streamerz", sni: "youtube.com" },
  ];

  const APPS = [
    ["com.discord", "Discord"], ["com.valvesoftware.android.valve1939", "Steam"],
    ["com.riotgames.mobile.leagueplay", "Riot Mobile"], ["com.google.android.youtube", "YouTube"],
    ["com.spotify.music", "Spotify"], ["org.telegram.messenger", "Telegram"],
    ["com.whatsapp", "WhatsApp"], ["com.zhiliaoapp.musically", "TikTok"],
    ["com.instagram.android", "Instagram"], ["com.microsoft.office.outlook", "Outlook"],
    ["com.google.android.apps.maps", "Maps"], ["com.netflix.mediaclient", "Netflix"],
  ].map(([pkg, label]) => ({ pkg, label, system: false }));

  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const ok = (msg) => ({ ok: true, msg });

  const handlers = {
    get_state: () => ({ cards, server_ip: "qc-speed.example.com", version: "0.3.5" }),
    probe_server: () => ok("Server reachable."),
    tunnel_start: () => { running = true; return ok("Engine started."); },
    tunnel_stop: () => { running = false; return ok("Engine stopped."); },
    tunnel_status: () => ({ running, error: "" }),
    tunnel_traffic: () => {
      if (running) {
        rx += 1_100_000 + Math.random() * 2_600_000;
        tx += 140_000 + Math.random() * 700_000;
      }
      return { rx, tx };
    },
    tunnel_apps: () => JSON.stringify(APPS),
    tunnel_bg_status: () => true,
    tunnel_open_vpn_settings: () => ({}),
    tunnel_open_bg_settings: () => ({}),
    copy_card: () => ({ ok: true, msg: "Card link copied." }),
    generate_card: (a) => {
      cards.push({
        uuid: "33333333-3333-4333-8333-" + String(Date.now()).slice(-12),
        name: a.name || "New card",
        card_type: a.kind || "Gamerz",
        sni: a.sni || "playvalorant.com",
      });
      return ok("Card created.");
    },
    revoke_card: (a) => {
      const i = cards.findIndex((c) => c.uuid === a.uuid);
      if (i >= 0) cards.splice(i, 1);
      return ok("Card revoked.");
    },
    resolve_host: () => "197.44.211.84",
    check_update: () => ({ current: "0.3.5", latest: "0.3.5", available: false, apk_url: "", url: "#" }),
    apply_update: () => ({}),
  };

  // No server behind the site copy: the speed screen ramps its own numbers.
  window.__QVPN_SPEED_SIM__ = true;

  window.__TAURI_INTERNALS__ = {
    invoke: async (cmd, args) => {
      await wait(40);
      const fn = handlers[cmd];
      return fn ? fn(args || {}) : ok();
    },
    transformCallback: (cb) => cb,
  };

  // The demo never runs the first-run coach: it is a tour, not a setup.
  try { if (!localStorage.getItem("qc-coach-done")) localStorage.setItem("qc-coach-done", "1"); } catch (e) {}
})();
