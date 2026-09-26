const $ = (id) => document.getElementById(id);

// Tauri v2 bridge: the native side injects __TAURI_INTERNALS__ into every
// webview (bare `invoke` does NOT exist - that was why every button died).
function rawInvoke(cmd, args) {
  if (window.__TAURI_INTERNALS__ && window.__TAURI_INTERNALS__.invoke)
    return window.__TAURI_INTERNALS__.invoke(cmd, args);
  if (window.__TAURI__ && window.__TAURI__.core && window.__TAURI__.core.invoke)
    return window.__TAURI__.core.invoke(cmd, args);
  throw new Error("app bridge not ready");
}
const invoke = rawInvoke;

// Never let a thrown bridge error leave the UI stuck on "Working...".
async function call(cmd, args) {
  try {
    return await invoke(cmd, args);
  } catch (e) {
    return { ok: false, msg: "Failed: " + (e && e.message ? e.message : e) };
  }
}

// Same SNI presets as the desktop app.
const SNIS = {
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
};
const DEFAULT_SNI = { Gamerz: "ea.com", Streamerz: "youtube.com" };

// EN/AR strings. Rust-side messages stay English; everything the UI owns is here.
const STR = {
  en: {
    cardForVpn: "Server", route: "Gateway", protected: "Protected", wholeDevice: "Whole device",
    yourIp: "Your IP", newCard: "New card", cardName: "Card name", exName: "e.g. Yousef, PC, phone",
    domainSni: "Domain", customDomain: "custom domain…", customDomainOpt: "Custom domain…",
    generateCard: "Generate card", applyDomainBtn: "Apply", myCards: "My cards", serverHint: "Automatic configuration.",
    host: "Address", language: "Language", reconnect: "Reconnect", testPort: "Check server", copyLog: "Copy log",
    secStatus: "Status", secConnection: "Connection", secGeneral: "General", secProtection: "Protection",
    tabHome: "Home", tabSpeed: "Speed", tabCards: "Cards", tabServer: "Server", tabSettings: "Settings", howTo: "How to use",
    tabApps: "Apps", vpnFor: "VPN for", appsAll: "All apps", appsOnly: "Only these", appsExcept: "All but these",
    appsHint: "Changes apply next time you connect.", appsSearch: "Search apps…",
    appsLoading: "Loading apps…", appsEmpty: "No applications found.",
    appsNeedPick: "Pick at least one app first.", appsPicked: "Applies next time you connect.",
    transport: "Connection", trStandard: "Standard", trGame: "Game", trWg: "WireGuard",
    trNoteVless: "Standard (Default traffic).",
    trNoteHy2: "Game: fastest for play, counts from general quota.",
    trNoteWg: "WireGuard: fastest, needs the server prepared once.",
    wgWarnT: "WireGuard spends from main quota, not your packages",
    wgWarnB: "Usage on this mode will not count from your Gamerz/Streamerz quota. Use Standard mode for packages.",
    hyWarnT: "Game spends from main quota, not your Gamerz package",
    hyWarnB: "Usage on this mode counts from general quota. Use Standard mode for packages.",
    appsStatusAll: "VPN covers all apps", appsStatusAllow: "VPN only for", appsStatusBlock: "VPN for all except",
    appsPending: " - reconnect to use it",
    ksHint: "Kill switch: turn on Always-on VPN in the system settings. If the VPN drops, internet stops instead of leaking.",
    openVpnSettings: "Open VPN settings",
    updTitle: "Updates", updCheck: "Check for updates", updGet: "Download and install",
    updIdle: "Not checked yet.", updChecking: "Checking…",
    spReady: "Ready to test", spPinging: "Measuring ping", spDowning: "Measuring download",
    spUping: "Measuring upload", spDone: "Result", spFail: "No reply from the server.",
    peak: "Peak", yourConn: "Your connection", targetServer: "Server", findingServer: "Finding the nearest server",
    srvName: "QuotaVPN server", srvOwnNote: "Through the QuotaVPN server", pingTitle: "Ping", jitter: "Jitter",
    chDown: "Down", chUp: "Up", mbps: "Mbps", ms: "ms", idle: "idle", done: "Done",
    measuring: "Measuring…", stop: "Stop", refresh: "Refresh", startTest: "Start test",
    pingHint: "Best of 8 samples through the active path.", downHint: "Download through the active path.",
    upHint: "Upload through the active path.", noReply: "No reply.", cfName: "Cloudflare", srvPublic: "Public reference", pickServer: "Speed test server", srvAuto: "Nearest server", srvAutoNote: "Picked for you", viaReference: "(measured against the public reference)", cfDetail: "Cloudflare's own test endpoints",
    spStart: "Start test", spStop: "Stop", spPing: "Ping", spJitter: "Jitter", spDown: "Down", spUp: "Up",
    spHint: "Tests the route the card on Home is using.",
    spHistory: "Recent runs", spNone: "No runs yet.",
    updOut: "{v} is out.", updLatest: "{v} is the latest.", updFail: "Could not reach GitHub.",
    updDownloading: "Downloading the update…", updOpened: "Installer opened. Confirm to update.",
    updAllow: "Allow installs from QuotaVPN in the screen that opened, then tap again.",
    bgHint: "Some phones stop the VPN when you swipe the app away. Allow background running so it stays on.",
    bgHintOn: "Background running is allowed. The VPN stays on when you swipe the app away.",
    bgBtnAllow: "Allow background running",
    bgBtnStop: "Disallow background running",
    vpnConnected: "VPN Connected", serverReady: "Server ready", notConnected: "Not connected",
    working: "Working…", talking: "Talking to the server.", trafficThru: "All traffic goes through ",
    readySub: "Server is set up. Pick a card and connect.", idleSub: "Pick a card and connect.",
    connect: "Connect", disconnect: "Disconnect", connected: "Connected",
    vpnOn: "vpn on", ready: "ready", idle: "idle",
    copy: "Copy", revoke: "Revoke", revokeSure: "Sure?", inUse: "In use", kindGamerz: "Gamerz", kindStreamerz: "Streamerz",
    noCards: "No active cards yet. Tap + to generate your first card.", firstCard: "+ New card", noCardsOpt: "No cards - generate one first",
    needCard: "Generate a card first, then connect.", stopping: "Stopping…",
    secTraffic: "Traffic and routing", routing: "App routing", back: "Back", cancel: "Cancel",
    addCard: "+ New", connecting: "Connecting…", ping: "Ping",
    sheetSearch: "Search domains…",
    obTitle: "How QuotaVPN works", ob1: "Pick Gamerz or Streamerz.",
    ob2: "Choose the server it rides.", ob3: "Hit Connect - back out anytime, the VPN stays on.", obGot: "Got it",
  },
  ar: {
    cardForVpn: "السيرفر", route: "البوابة", protected: "الحماية", wholeDevice: "الجهاز بالكامل",
    yourIp: "عنوان الـIP", newCard: "بطاقة جديدة", cardName: "اسم البطاقة", exName: "مثال: يوسف، الموبايل، اللابتوب",
    domainSni: "الدومين", customDomain: "دومين مخصص…", customDomainOpt: "دومين مخصص…",
    generateCard: "إنشاء بطاقة", applyDomainBtn: "تطبيق", myCards: "بطاقاتي", serverHint: "إعداد تلقائي",
    host: "العنوان", language: "اللغة", reconnect: "إعادة الاتصال", testPort: "فحص السيرفر", copyLog: "نسخ السجل",
    secStatus: "الحالة", secConnection: "الاتصال", secGeneral: "عام", secProtection: "الحماية",
    tabHome: "الرئيسية", tabSpeed: "السرعة", tabCards: "البطاقات", tabServer: "السيرفر", tabSettings: "الإعدادات", howTo: "طريقة الاستخدام",
    tabApps: "التطبيقات", vpnFor: "الـVPN لـ", appsAll: "جميع التطبيقات", appsOnly: "المحددة فقط", appsExcept: "الجميع باستثناء",
    appsHint: "سيتم تطبيق التغييرات عند الاتصال التالي.", appsSearch: "ابحث عن تطبيق…",
    appsLoading: "جارٍ تحميل التطبيقات…", appsEmpty: "لا توجد تطبيقات بهذا الاسم.",
    appsNeedPick: "اختر تطبيقاً واحداً على الأقل أولاً.", appsPicked: "سيتم التطبيق عند الاتصال التالي.",
    transport: "الاتصال", trStandard: "عادي", trGame: "ألعاب", trWg: "WireGuard",
    trNoteVless: "العادي (الترافيك الافتراضي)",
    trNoteHy2: "الألعاب: أسرع للعب، ويُحتسب من الباقة العامة",
    trNoteWg: "WireGuard: الأسرع، ويحتاج تجهيز السيرفر مرة واحدة",
    wgWarnT: "الواير جارد يسحب من الباقة الأساسية وليس من الباقات",
    wgWarnB: "الاستخدام في هذا الوضع لن يُحتسب من باقة جيمرز/ستريمرز. استخدم الوضع العادي للباقات",
    hyWarnT: "وضع اللعب يسحب من الباقة الأساسية وليس من باقة الجيمرز",
    hyWarnB: "الاستخدام في هذا الوضع يُحتسب من الباقة العامة. استخدم الوضع العادي للباقات",
    appsStatusAll: "الـVPN مفعّل لجميع التطبيقات", appsStatusAllow: "الـVPN للتطبيقات المحددة فقط", appsStatusBlock: "الـVPN للجميع باستثناء",
    appsPending: " - أعد الاتصال لتفعيله",
    ksHint: "القفل الكامل: فعّل Always-on VPN من إعدادات النظام، وإذا توقف الـVPN سيتوقف الإنترنت بدلاً من تسرب البيانات.",
    openVpnSettings: "افتح إعدادات الـVPN",
    updTitle: "التحديثات", updCheck: "التحقق من التحديثات", updGet: "تنزيل وتثبيت",
    updIdle: "لم يتم التحقق بعد.", updChecking: "جارٍ التحقق…",
    spReady: "جاهز للاختبار", spPinging: "قياس البينج", spDowning: "قياس التحميل",
    spUping: "قياس الرفع", spDone: "النتيجة", spFail: "مفيش رد من السيرفر.",
    peak: "الذروة", yourConn: "اتصالك", targetServer: "الخادم", findingServer: "جارٍ العثور على أقرب خادم",
    srvName: "خادم QuotaVPN", srvOwnNote: "عبر خادم QuotaVPN", pingTitle: "زمن الاستجابة", jitter: "التذبذب",
    chDown: "تنزيل", chUp: "رفع", mbps: "ميجابت", ms: "مللي ثانية", idle: "خامل", done: "تم",
    measuring: "جارٍ القياس…", stop: "إيقاف", refresh: "تحديث", startTest: "بدء الاختبار",
    pingHint: "أفضل 8 محاولات عبر المسار الحالي.", downHint: "قياس التحميل من الخادم عبر المسار الحالي.",
    upHint: "قياس الرفع إلى الخادم عبر المسار الحالي.", noReply: "لا يوجد رد.", cfName: "Cloudflare", srvPublic: "مرجع عام", pickServer: "خادم اختبار السرعة", srvAuto: "أقرب خادم", srvAutoNote: "يُختار تلقائيًا", viaReference: "(قياس عبر المرجع العام)", cfDetail: "نقاط اختبار Cloudflare نفسها",
    spStart: "ابدأ الاختبار", spStop: "إيقاف", spPing: "بينج", spJitter: "تذبذب", spDown: "تحميل", spUp: "رفع",
    spHint: "بيختبر المسار اللي بطاقتك في الرئيسية بتستخدمه.",
    spHistory: "آخر الاختبارات", spNone: "مفيش اختبارات لسه.",
    updOut: "الإصدار {v} متاح.", updLatest: "{v} هو الأحدث.", updFail: "تعذر الوصول إلى GitHub.",
    updDownloading: "جارٍ تنزيل التحديث…", updOpened: "تم فتح المثبّت. أكّد التحديث.",
    updAllow: "اسمح بتثبيت التطبيقات من QuotaVPN من الشاشة المفتوحة ثم أعد المحاولة.",
    bgHint: "بعض الهواتف توقف الـVPN عند إغلاق التطبيق. اسمح بالعمل في الخلفية ليبقى يعمل.",
    bgHintOn: "تم السماح بالعمل في الخلفية. سيبقى الـVPN يعمل عند إغلاق التطبيق.",
    bgBtnAllow: "السماح بالعمل في الخلفية",
    bgBtnStop: "إيقاف العمل في الخلفية",
    vpnConnected: "الـVPN يعمل", serverReady: "السيرفر جاهز", notConnected: "غير متصل",
    working: "جارٍ العمل…", talking: "جارٍ التواصل مع السيرفر…", trafficThru: "كل الترافيك يمر عبر ",
    readySub: "السيرفر جاهز. اختار بطاقة واتصل.", idleSub: "اختار بطاقة واتصل.",
    connect: "اتصال", disconnect: "قطع الاتصال", connected: "متصل",
    vpnOn: "شغال", ready: "جاهز", idle: "خامل",
    copy: "نسخ", revoke: "حذف", revokeSure: "متأكد؟", inUse: "قيد الاستخدام", kindGamerz: "جيمرز", kindStreamerz: "ستريمرز",
    noCards: "لا توجد بطاقات حتى الآن. اضغط على + لإنشاء بطاقتك الأولى.", firstCard: "+ بطاقة جديدة", noCardsOpt: "لا توجد بطاقات - أنشئ بطاقة أولاً",
    needCard: "أنشئ بطاقة أولاً ثم اتصل.", stopping: "جارٍ الإيقاف…",
    secTraffic: "الترافيك والتوجيه", routing: "توجيه التطبيقات", back: "رجوع", cancel: "إلغاء",
    addCard: "+ جديد", connecting: "جارٍ الاتصال…", ping: "البينج",
    sheetSearch: "ابحث عن دومين…",
    obTitle: "كيف يعمل QuotaVPN", ob1: "اختر جيمرز أو ستريمرز.",
    ob2: "اختر البطاقة من الرئيسية.", ob3: "اضغط اتصال - يمكنك الخروج من التطبيق، وسيبقى الـVPN يعمل.", obGot: "فهمت",
  },
};
let lang = localStorage.getItem("qc-lang") || "en";
function t(k) { return (STR[lang] && STR[lang][k]) || STR.en[k] || k; }
// Card-type display name follows the UI language.
function kindName(raw) {
  if (typeof raw === "string" && raw.startsWith("Gamerz")) return t("kindGamerz");
  if (typeof raw === "string" && raw.startsWith("Streamerz")) return t("kindStreamerz");
  return raw;
}
// Full host, one line: CSS ellipsis keeps the strip compact, tap to see it all.
function maskHost(h) {
  if (!h || h === "-") return "-";
  return h;
}
function applyLang(l) {
  lang = (l === "ar") ? "ar" : "en";
  localStorage.setItem("qc-lang", lang);
  document.documentElement.lang = lang;
  document.documentElement.dir = "ltr"; // Layout never mirrors: icons keep the same place in both languages.
  document.querySelectorAll("[data-i18n]").forEach((el) => { el.textContent = t(el.dataset.i18n); });
  document.querySelectorAll("[data-i18n-ph]").forEach((el) => { el.placeholder = t(el.dataset.i18nPh); });
  const as = $("apps-search"); if (as) as.setAttribute("aria-label", t("appsSearch"));
  const cs = $("card-sni"); if (cs) cs.setAttribute("aria-label", t("customDomain"));
  document.querySelectorAll("#lang-seg button").forEach((x) =>
    x.classList.toggle("on", x.dataset.lang === lang));
  fillSniSelect();
  paintAppsSeg();
  paintTransport();
  renderAppsList($("apps-search") ? $("apps-search").value : "");
  paintActiveCard();
  paintHero();
  paintPresets();
  paintDomain();
  document.querySelectorAll("#cards .cardrow").forEach((row) => {
    const btns = row.querySelectorAll("button");
    if (btns[0]) btns[0].textContent = t("copy");
    if (btns[1]) btns[1].textContent = t("revoke");
    const sniEl = row.querySelector(".sni");
    const raw = sniEl.dataset.raw;
    if (raw) sniEl.textContent = kindName(raw);
  });
  // Dynamic regions (empty state, profile picker) only rebuild in refresh.
  refresh();
}
let kind = "Gamerz";
let busy = false;
let connected = false;
let serverHost = "";
let serverIp = "";
let vpnOn = false;
let vpnError = "";
let vpnCardName = "";

// ---------------------------------------------------------------------------
// Packages and servers, the desktop's model: the user picks Gamerz or
// Streamerz and the server (domain) it rides. The card behind them is
// bookkeeping, created on demand and never shown.
// ---------------------------------------------------------------------------
let cardsCache = [];
let presetKind = "Gamerz";

function activeKind() {
  const sel = $("tunnel-card");
  const c = cardsCache.find((x) => x.uuid === sel.value);
  if (c && c.card_type === "Streamerz") return "Streamerz";
  if (c && c.card_type === "Gamerz") return "Gamerz";
  return presetKind;
}
function activeCard() {
  const sel = $("tunnel-card");
  return cardsCache.find((x) => x.uuid === sel.value) || null;
}
function labelFor(sni) {
  for (const g of Object.keys(SNIS)) {
    for (const [label, domain] of SNIS[g]) if (domain === sni) return label;
  }
  return sni;
}
function paintPresets() {
  const kindNow = activeKind();
  document.querySelectorAll("#presets .preset").forEach((b) => {
    const k = b.dataset.kind;
    const mine = cardsCache.find((c) => c.card_type === k);
    const on = kindNow === k;
    b.classList.toggle("on", on);
    b.setAttribute("aria-pressed", on ? "true" : "false");
    b.disabled = busy;
    const el = b.querySelector(".preset-sni");
    if (el) el.textContent = (mine && mine.sni) || DEFAULT_SNI[k];
  });
}
function paintDomain() {
  const c = activeCard();
  const sni = (c && c.sni) || DEFAULT_SNI[activeKind()];
  const lab = labelFor(sni);
  $("tunnel-card-name").textContent = lab === sni ? sni : lab + " \u00b7 " + sni;
}
// One tap on a package: select its card, or create it first (no connection
// needed), exactly like the desktop preset pair.
async function pickPreset(k) {
  if (busy) return;
  presetKind = k;
  const mine = cardsCache.find((c) => c.card_type === k);
  if (mine) {
    const sel = $("tunnel-card");
    sel.value = mine.uuid;
    try { sel.onchange(); } catch (e) {}
    paintPresets();
    paintDomain();
    paintHero();
    return;
  }
  setBusy(true);
  try {
    const r = await call("generate_card", { name: kindName(k), kind: k, sni: DEFAULT_SNI[k] });
    bar(r.ok, r.msg);
    if (r.ok) {
      await refresh();
      // The card just made for this package must become the active one.
      const made = cardsCache.find((c) => c.card_type === k);
      if (made) {
        const sel = $("tunnel-card");
        sel.value = made.uuid;
        try { sel.onchange(); } catch (e) {}
        paintPresets();
        paintDomain();
        paintHero();
      }
    }
  } finally { setBusy(false); }
}
// Picking a server: retarget the card that rides it, or make one for the choice.
async function applyDomain(sni) {
  if (busy) return;
  setBusy(true);
  try {
    const c = activeCard();
    const k = activeKind();
    const r = c
      ? await call("set_card_sni", { uuid: c.uuid, sni })
      : await call("generate_card", { name: kindName(k), kind: k, sni });
    bar(r.ok, r.msg);
    if (r.ok) await refresh();
  } finally { setBusy(false); }
}

let barTimer = 0;
// Rust sends English status lines; show them in Arabic when that is the UI language.
const RUST_AR = {
  "Connected - server ready.": "السيرفر جاهز.",
  "No server set up.": "جهّز السيرفر الأول.",
  "The server is not set up yet.": "الخادم غير مهيأ بعد.",
  "No server set.": "جهّز السيرفر الأول.",
  "Card not found.": "البطاقة مش موجودة.",
};
function localizeRust(text) {
  if (lang !== "ar" || typeof text !== "string") return text;
  if (/ reachable\.$/.test(text)) return "السيرفر متاح.";
  if (/ refused: /.test(text)) return "السيرفر رفض الاتصال.";
  if (/ timed out \(blocked\?\)\.$/.test(text)) return "السيرفر مردش (محجوب؟).";
  return RUST_AR[text] || text;
}
function bar(ok, text) {
  // Quiet success: the bar only ever shows errors, never status chatter.
  if (ok) return;
  const el = $("infobar");
  el.hidden = false;
  el.className = "bar " + (ok ? "ok" : "err");
  $("infobar-icon").textContent = ok ? "✓" : "⚠";
  $("infobar-text").textContent = localizeRust(text);
  clearTimeout(barTimer);
  barTimer = setTimeout(() => { el.hidden = true; }, 8000);
}
$("infobar-x").onclick = () => { $("infobar").hidden = true; };

// Tabs: one job per screen. Each switch pushes WebView history so the
// system back button walks back through tabs (native side calls goBack,
// which fires popstate). History exhausted = close UI, VPN service lives on.
let tabHist = ["connect"];
function goTab(name, push) {
  document.querySelectorAll(".tabbar button").forEach((x) =>
    x.classList.toggle("on", x.dataset.tab === name));
  document.querySelectorAll(".view").forEach((v) =>
    v.classList.toggle("on", v.id === "view-" + name));
  if (name === "settings") paintBg();
  if (push !== false && tabHist[tabHist.length - 1] !== name) {
    tabHist.push(name);
    try { history.pushState({ tab: name }, ""); } catch (e) {}
  }
}
document.querySelectorAll(".tabbar button").forEach((b) => {
  b.onclick = () => goTab(b.dataset.tab);
});
window.addEventListener("popstate", (e) => {
  const wasSheet = sheetFor !== null;
  if (wasSheet) closeSheet();
  const t = (e.state && e.state.tab) || "connect";
  const i = tabHist.lastIndexOf(t);
  tabHist = tabHist.slice(0, i >= 0 ? i + 1 : 1);
  goTab(t, false);
});
try { history.replaceState({ tab: "connect" }, ""); } catch (e) {}

function paintHero() {
  const hero = $("hero");
  hero.classList.toggle("idle", !vpnOn && !connected);
  hero.classList.toggle("connecting", busy);
  // The IP lives only in the home net rows.
  // Home net row: the IP lives inside the hero, only while connected.
  $("home-ip").textContent = maskHost(serverIp || serverHost);
  $("home-ipbox").hidden = !vpnOn;
  $("session-line").hidden = !vpnOn;
  if (busy) {
    $("hero-state").textContent = t("working");
    $("hero-sub").textContent = t("talking");
    return;
  }
  if (vpnOn) {
    hero.classList.remove("ready");
    hero.classList.add("connected");
    $("hero-state").textContent = t("vpnConnected");
    // bdi isolates the Latin card name so nothing jumps sides. Arabic takes
    // no trailing period; English keeps its full stop.
    $("hero-sub").innerHTML = "";
    $("hero-sub").append(
      document.createTextNode(t("trafficThru")),
      (() => { const b = document.createElement("bdi"); b.textContent = vpnCardName || "your card"; return b; })(),
    );
    if (lang === "en") $("hero-sub").append(document.createTextNode("."));
    $("btn-label").textContent = t("disconnect");
    tickSession();
  } else if (connected) {
    hero.classList.add("ready");
    hero.classList.remove("connected");
    $("hero-state").textContent = t("ready");
    $("hero-sub").textContent = "";
    $("btn-label").textContent = t("connect");
  } else {
    hero.classList.add("ready");
    hero.classList.remove("connected");
    $("hero-state").textContent = t("notConnected");
    $("hero-sub").textContent = "";
    $("btn-label").textContent = t("connect");
  }
}

function setBusy(b) {
  busy = b;
  for (const id of ["btn-connect"]) $(id).disabled = b;
  paintHero();
  // The package buttons mirror the busy state too: without this they stay
  // disabled after any work that runs through refresh() (the load probe did
  // exactly that, and taps on them went nowhere).
  paintPresets();
}

function selectedSni() {
  const sel = $("card-sni-select").value;
  if (sel === "__custom") return $("card-sni").value.trim();
  return sel;
}

function fillSniSelect() {
  const sel = $("card-sni-select");
  sel.innerHTML = "";
  for (const group of Object.keys(SNIS)) {
    const og = document.createElement("optgroup");
    og.label = kindName(group);
    for (const [label, sni] of SNIS[group]) {
      const o = document.createElement("option");
      o.value = sni;
      o.textContent = label;
      og.append(o);
    }
    sel.append(og);
  }
  const custom = document.createElement("option");
  custom.value = "__custom";
  custom.textContent = t("customDomainOpt");
  sel.append(custom);
  sel.value = DEFAULT_SNI[kind];
  $("card-sni").hidden = true;
  updateSniBtn();
}
$("card-sni-select").onchange = () => {
  $("card-sni").hidden = $("card-sni-select").value !== "__custom";
  updateSniBtn();
  if (!$("card-sni").hidden) $("card-sni").focus();
};

async function refresh() {
  const st = await call("get_state");
  if (!st || !st.cards) return;
  serverHost = st.server_ip || "";
  serverIp = "";
  paintHero();
  cardsCache = st.cards;
  fillTunnelCards(st.cards);
  maybeCoach(st.cards.length > 0);
  paintPresets();
  paintDomain();
  // Slow DNS last: the list is already painted, the IP fills in after.
  if (serverHost && /[a-zA-Z]/.test(serverHost)) {
    try { serverIp = await call("resolve_host", { host: serverHost }); } catch (e) { serverIp = ""; }
    paintHero();
  }
}

document.querySelectorAll("#presets .preset").forEach((b) => {
  b.onclick = () => pickPreset(b.dataset.kind);
});

// Probe + diagnostics run silently now: no user-facing server tools.
async function doProbe() {
  if (busy) return;
  setBusy(true);
  try {
    const r = await call("probe_server");
    connected = r.ok;
    bar(r.ok, r.msg);
    await refresh();
  } finally { setBusy(false); }
}

function fillTunnelCards(cards) {
  const sel = $("tunnel-card");
  const prev = localStorage.getItem("qc-tunnel-card") || sel.value;
  sel.innerHTML = "";
  if (!cards.length) {
    const o = document.createElement("option");
    o.value = "";
    o.textContent = t("noCardsOpt");
    sel.append(o);
    // Empty state must never keep showing a removed card's name.
    localStorage.removeItem("qc-tunnel-card");
    vpnCardName = "";
    paintActiveCard();
    updateCardBtn();
    paintHero();
    return;
  }
  for (const c of cards) {
    const o = document.createElement("option");
    o.value = c.uuid;
    o.dataset.sni = c.sni || c.card_type;
    o.textContent = c.name + " (" + (c.sni || kindName(c.card_type)) + ")";
    sel.append(o);
  }
  if (prev && [...sel.options].some((o) => o.value === prev)) sel.value = prev;
  else { sel.selectedIndex = 0; localStorage.setItem("qc-tunnel-card", sel.value); }
  vpnCardName = sel.options[sel.selectedIndex]
    ? sel.options[sel.selectedIndex].textContent : "";
  paintActiveCard();
  updateCardBtn();
  paintHero();
}
// Transport: vless (standard) / hy2 (game) / wg (wireguard). Persisted, sent on connect.
let transport = localStorage.getItem("qc-transport") || "vless";
if (!["vless", "hy2", "wg"].includes(transport)) transport = "vless";
function paintTransport() {
  document.querySelectorAll("#transport-seg button").forEach((x) =>
    x.classList.toggle("on", x.dataset.transport === transport));
  const note = $("transport-note");
  // One line always: the quota warning folds into the note so Home never grows.
  if (note) {
    note.textContent = t(transport === "hy2" ? "hyWarnT" : transport === "wg" ? "wgWarnT" : "trNoteVless");
    note.classList.toggle("warn-note", transport !== "vless");
  }
}
document.querySelectorAll("#transport-seg button").forEach((b) => {
  b.onclick = () => {
    transport = b.dataset.transport;
    localStorage.setItem("qc-transport", transport);
    paintTransport();
    if (transport === "wg") bar(false, t("wgWarnT"));
    else if (transport === "hy2") bar(false, t("hyWarnT"));
    else if (vpnOn) bar(true, t("appsPicked"));
  };
});
// Per-app VPN: mode + picked packages, persisted locally, sent on connect.
let appsMode = localStorage.getItem("qc-apps-mode") || "all";
let appsPicked = [];
try { appsPicked = JSON.parse(localStorage.getItem("qc-apps") || "[]"); } catch (e) { appsPicked = []; }
let appsCache = [];
function persistApps() {
  localStorage.setItem("qc-apps-mode", appsMode);
  localStorage.setItem("qc-apps", JSON.stringify(appsPicked));
}
function paintAppsSeg() {
  document.querySelectorAll("#apps-seg button").forEach((x) =>
    x.classList.toggle("on", x.dataset.appsmode === appsMode));
  const st = $("apps-status");
  if (st) st.textContent = appsStatus();
  const rs = $("routing-sub");
  if (rs) rs.textContent = appsStatus();
}
// Live summary: which mode is active, how many apps picked, pending or not.
function appsStatus() {
  const n = appsPicked.length;
  let s = appsMode === "all" ? t("appsStatusAll")
    : (appsMode === "allow" ? t("appsStatusAllow") : t("appsStatusBlock")) + " (" + n + ")";
  if (vpnOn) s += t("appsPending");
  return s;
}
document.querySelectorAll("#apps-seg button").forEach((b) => {
  b.onclick = () => {
    appsMode = b.dataset.appsmode;
    // All apps means the picked list does nothing: drop it so old checks
    // never linger on screen after switching back.
    if (appsMode === "all") appsPicked = [];
    persistApps();
    paintAppsSeg();
    renderAppsList($("apps-search").value);
    bar(true, appsStatus());
  };
});
// Arabic display names for popular apps. On a real phone Android already
// returns the label in the phone language, this map guarantees Arabic in
// the preview and for apps whose system label stays English.
const AR_APP_NAMES = {
  "com.zhiliaoapp.musically": "تيك توك",
  "com.whatsapp": "واتساب",
  "com.instagram.android": "إنستجرام",
  "com.google.android.youtube": "يوتيوب",
  "com.facebook.katana": "فيسبوك",
  "com.facebook.orca": "ماسنجر",
  "org.telegram.messenger": "تيليجرام",
  "com.snapchat.android": "سناب شات",
  "com.twitter.android": "إكس (تويتر)",
  "com.spotify.music": "سبوتيفاي",
  "com.tencent.ig": "ببجي موبايل",
  "com.riotgames.valorant": "فالورانت",
  "com.ea.gp.fifamobile": "فيفا موبايل",
  "com.dts.freefireth": "فري فاير",
  "com.activision.callofduty.shooter": "كول أوف ديوتي موبايل",
  "com.roblox.client": "روبلوكس",
  "com.mojang.minecraftpe": "ماين كرافت",
  "com.discord": "ديسكورد",
  "com.android.chrome": "كروم",
  "com.google.android.gm": "جيميل",
  "com.netflix.mediaclient": "نتفليكس",
  "com.mbc.shahid": "شاهد",
};
function appDisplay(a) {
  if (lang === "ar" && a && AR_APP_NAMES[a.pkg]) return AR_APP_NAMES[a.pkg];
  return (a && (a.label || a.pkg)) || "";
}
function renderAppsList(filter) {
  const list = $("apps-list");
  list.innerHTML = "";
  const q = (filter || "").trim().toLowerCase();
  const items = appsCache
    .filter((a) => {
      if (!q) return true;
      const lbl = String(a.label || "").toLowerCase();
      const disp = String(appDisplay(a) || "").toLowerCase();
      return lbl.includes(q) || disp.includes(q) || String(a.pkg || "").toLowerCase().includes(q);
    })
    .sort((x, y) => String(appDisplay(x)).localeCompare(String(appDisplay(y)), lang === "ar" ? "ar" : "en"));
  if (!items.length) {
    const p = document.createElement("p");
    p.className = "empty";
    p.textContent = appsCache.length ? t("appsEmpty") : t("appsLoading");
    list.append(p);
    return;
  }
  for (const a of items) {
    const on = appsPicked.includes(a.pkg);
    const row = optRow(appDisplay(a), a.pkg, on, () => {
      const i = appsPicked.indexOf(a.pkg);
      if (i >= 0) appsPicked.splice(i, 1);
      else {
        appsPicked.push(a.pkg);
        if (appsMode === "all") {
          appsMode = "allow";
          paintAppsSeg();
        }
      }
      persistApps();
      paintAppsSeg();
      renderAppsList($("apps-search").value);
      if (vpnOn) bar(true, t("appsPicked"));
    });
    row.setAttribute("role", "checkbox");
    list.append(row);
  }
}
async function loadApps() {
  try {
    const raw = await call("tunnel_apps");
    const arr = JSON.parse(typeof raw === "string" ? raw : "[]");
    appsCache = arr.filter((a) => a && a.pkg).sort((x, y) =>
      String(x.label || x.pkg).localeCompare(String(y.label || y.pkg)));
  } catch (e) { appsCache = []; }
  // Drop picked packages that no longer exist.
  const have = new Set(appsCache.map((a) => a.pkg));
  appsPicked = appsPicked.filter((p) => have.has(p));
  persistApps();
  renderAppsList($("apps-search") ? $("apps-search").value : "");
}
if ($("apps-search")) $("apps-search").oninput = (e) => renderAppsList(e.target.value);

$("btn-vpn-settings").onclick = async () => {
  if (busy) return;
  setBusy(true);
  try {
    await call("tunnel_open_vpn_settings");
  } finally { setBusy(false); }
};
// Background toggle: the label follows the real system state. Reads Allow
// until the user approves, then flips to Disallow (which opens the system
// list where they can turn it back off).
async function paintBg() {
  let exempt = false;
  try {
    const r = await call("tunnel_bg_status");
    exempt = r === true;
  } catch (e) { exempt = false; }
  const btn = $("btn-bg");
  if (btn) {
    btn.dataset.i18n = exempt ? "bgBtnStop" : "bgBtnAllow";
    btn.textContent = t(btn.dataset.i18n);
  }
  const hint = $("bg-hint");
  if (hint) {
    hint.dataset.i18n = exempt ? "bgHintOn" : "bgHint";
    hint.textContent = t(hint.dataset.i18n);
  }
}
$("btn-bg").onclick = async () => {
  if (busy) return;
  setBusy(true);
  try {
    await call("tunnel_open_bg_settings");
  } finally { setBusy(false); }
  setTimeout(paintBg, 800);
};
document.addEventListener("visibilitychange", () => { if (!document.hidden) paintBg(); });
paintBg();
// Updates: check GitHub releases; install downloads the APK and opens the
// system installer (Android always asks one confirmation tap).
let updApk = "", updBusy = false;
async function runUpdateCheck() {
  if (updBusy) return;
  updBusy = true;
  const b = $("btn-check-upd");
  if (b) b.disabled = true;
  const st = $("upd-state");
  st.textContent = t("updChecking");
  try {
    const r = await call("check_update");
    if (r && r.available) {
      updApk = r.apk_url || "";
      st.textContent = t("updOut").replace("{v}", r.latest);
      $("btn-get-upd").hidden = !updApk;
    } else {
      st.textContent = t("updLatest").replace("{v}", (r && r.latest) || "");
    }
  } catch (e) {
    st.textContent = t("updFail");
  } finally {
    updBusy = false;
    if (b) b.disabled = false;
  }
}
$("btn-check-upd").onclick = runUpdateCheck;
$("btn-get-upd").onclick = async () => {
  if (!updApk) return;
  const b = $("btn-get-upd");
  const st = $("upd-state");
  b.disabled = true;
  st.textContent = t("updDownloading");
  try {
    await call("apply_update", { apkUrl: updApk });
    st.textContent = t("updOpened");
  } catch (e) {
    const m = (e && e.message) || "";
    st.textContent = /allow/i.test(m) ? t("updAllow") : (m || t("updFail"));
  } finally {
    setTimeout(() => { b.disabled = false; }, 1500);
  }
};
// Quiet auto-check on open; the row shows when something is waiting.
async function autoUpdateCheck() {
  try {
    const r = await call("check_update");
    if (r && r.available) {
      updApk = r.apk_url || "";
      $("upd-state").textContent = t("updOut").replace("{v}", r.latest);
      if (updApk) $("btn-get-upd").hidden = false;
    }
  } catch (e) { /* offline is fine; manual check stays */ }
}
function paintActiveCard() {
  const uuid = $("tunnel-card").value;
  document.querySelectorAll("#cards .cardrow").forEach((row) => {
    const on = !!uuid && row.dataset.uuid === uuid;
    row.classList.toggle("active", on);
    row.querySelector(".use").textContent = on ? t("inUse") : "";
  });
}
$("tunnel-card").onchange = () => {
  localStorage.setItem("qc-tunnel-card", $("tunnel-card").value);
  vpnCardName = $("tunnel-card").options[$("tunnel-card").selectedIndex].textContent;
  paintActiveCard();
  updateCardBtn();
  paintHero();
};

// Glass bottom sheet replaces both native popups (card picker + SNI picker).
const CHECK_SVG = `<svg class="check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 13l4 4L19 7"/></svg>`;
let sheetFor = null;
function currentTab() {
  const v = document.querySelector(".view.on");
  return v ? v.id.replace("view-", "") : "connect";
}
function updateCardBtn() {
  const sel = $("tunnel-card");
  const opt = sel.options[sel.selectedIndex];
  $("tunnel-card-name").textContent = (opt && opt.value) ? opt.textContent : t("noCardsOpt");
}
function updateSniBtn() {
  // The domain picker is a sheet now; the old inline button is gone.
  const el = $("card-sni-name");
  if (!el) return;
  const sel = $("card-sni-select");
  const opt = sel.options[sel.selectedIndex];
  el.textContent = opt ? opt.textContent : "-";
}
function optRow(main, sub, selected, onclick) {
  const b = document.createElement("button");
  b.className = "opt";
  b.setAttribute("role", "option");
  b.setAttribute("aria-selected", selected ? "true" : "false");
  const m = document.createElement("span");
  m.className = "meta";
  m.textContent = main;
  if (sub) {
    const s = document.createElement("span");
    s.className = "sub";
    s.textContent = sub;
    m.append(s);
  }
  b.append(m);
  b.insertAdjacentHTML("beforeend", CHECK_SVG);
  b.onclick = onclick;
  return b;
}
function openSheet(which) {
  sheetFor = which;
  const list = $("sheet-list");
  list.innerHTML = "";
  if (which === "target") {
    // The pool the desktop shows: pick automatically, take one of the near
    // servers by hand, or measure through the QuotaVPN server.
    $("sheet-title").textContent = t("pickServer");
    const cur = spChoose;
    if (!spPool.length && !spPicking) void spRefreshTarget();
    list.append(optRow(t("srvAuto"), t("srvAutoNote"), cur === "auto", () => {
      spChoose = "auto";
      try { localStorage.setItem("qc-speed-target", "auto"); } catch (e) {}
      spTarget = null;
      closeSheet();
      void spRefreshTarget();
    }));
    const own = spOwnServer();
    if (own) {
      list.append(optRow(own.label + " · " + own.host, own.detail, cur === "own", () => {
        spChoose = "own";
        try { localStorage.setItem("qc-speed-target", "own"); } catch (e) {}
        spTarget = own;
        closeSheet();
        spPaintTarget();
      }));
    }
    for (const s of spPool.slice(0, 12)) {
      if (s.id === "own") continue;
      list.append(optRow(s.label + " · " + s.host, s.detail, cur === s.id, () => {
        spChoose = s.id;
        try { localStorage.setItem("qc-speed-target", s.id); } catch (e) {}
        spTarget = s;
        closeSheet();
        spPaintTarget();
      }));
    }
    $("sheet-search").hidden = true;
    const spb = $("sheet-primary");
    if (spb) spb.hidden = true;
    requestAnimationFrame(() => requestAnimationFrame(() => $("sheet").classList.add("open")));
    try { history.pushState({ qcSheet: true }, ""); } catch (e) {}
    return;
  }
  $("sheet-title").textContent = t("cardForVpn");
  const kindNow = activeKind();
  const cur = (activeCard() && activeCard().sni) || DEFAULT_SNI[kindNow];
  SNIS[kindNow].forEach(([label, domain]) => {
    list.append(optRow(label + " · " + domain, "", domain === cur, () => { closeSheet(); void applyDomain(domain); }));
  });
  list.append(optRow(t("customDomainOpt"), "", false, () => { closeSheet(); openCustomDomain(); }));
  $("tunnel-card-btn").setAttribute("aria-expanded", "true");
  list.scrollTop = 0;
  const ss = $("sheet-search");
  ss.hidden = false;
  ss.value = "";
  $("sheet-back").hidden = false;
  const sh = $("sheet");
  sh.hidden = false;
  requestAnimationFrame(() => requestAnimationFrame(() => sh.classList.add("open")));
  try { history.pushState({ tab: currentTab(), sheet: 1 }, ""); } catch (e) {}
}

// Custom server: the same sheet, one field and an action.
function openCustomDomain() {
  sheetFor = "custom";
  const list = $("sheet-list");
  list.innerHTML = "";
  $("sheet-title").textContent = t("customDomainOpt");
  const wrap = document.createElement("div");
  wrap.className = "sheet-form";
  const inp = document.createElement("input");
  inp.id = "custom-domain-input";
  inp.placeholder = "example.com";
  inp.autocomplete = "off";
  inp.spellcheck = false;
  const btn = document.createElement("button");
  btn.className = "second";
  btn.textContent = t("applyDomainBtn");
  btn.onclick = () => {
    const v = inp.value.trim();
    if (!v) return;
    closeSheet();
    void applyDomain(v);
  };
  inp.onkeydown = (e) => { if (e.key === "Enter") btn.click(); };
  wrap.append(inp, btn);
  list.append(wrap);
  $("tunnel-card-btn").setAttribute("aria-expanded", "true");
  const ss = $("sheet-search");
  ss.hidden = true;
  ss.value = "";
  $("sheet-back").hidden = false;
  const sh = $("sheet");
  sh.hidden = false;
  requestAnimationFrame(() => requestAnimationFrame(() => sh.classList.add("open")));
  setTimeout(() => inp.focus(), 220);
  try { history.pushState({ tab: currentTab(), sheet: 1 }, ""); } catch (e) {}
}
function closeSheet() {
  sheetFor = null;
  $("sheet-search").hidden = true;
  $("sheet-search").value = "";
  $("tunnel-card-btn").setAttribute("aria-expanded", "false");
  const sh = $("sheet");
  sh.classList.remove("open");
  setTimeout(() => { sh.hidden = true; $("sheet-back").hidden = true; }, 200);
}
$("tunnel-card-btn").onclick = () => openSheet("sni");
$("sheet-back").onclick = closeSheet;
$("sheet-search").oninput = (e) => {
  const q = e.target.value.trim().toLowerCase();
  document.querySelectorAll("#sheet-list > *").forEach((el) => {
    if (el.classList.contains("grp")) { el.style.display = q ? "none" : ""; return; }
    el.style.display = (!q || el.textContent.toLowerCase().includes(q)) ? "" : "none";
  });
};
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && sheetFor) closeSheet(); });
// Settings rows: routing opens the apps view, which is a full screen now.
$("row-routing").onclick = () => goTab("apps");
$("btn-apps-back").onclick = () => goTab("settings");


async function pollTunnel() {
  try {
    const st = await call("tunnel_status");
    const was = vpnOn;
    vpnOn = !!st.running;
    vpnError = st.error || "";
    if (!vpnOn) connectEpoch = 0;
    if (was && !vpnOn && vpnError) bar(false, "VPN stopped: " + vpnError);
    if (was !== vpnOn) paintHero();
  } catch (e) { /* bridge hiccup, try next round */ }
}

// Live session: duration from the moment the tunnel reports up, plus
// real device counters for this app since connect.
let connectEpoch = 0;
function fmtBytes(n) {
  n = Math.max(0, n | 0);
  if (n < 1024) return n + " B";
  const u = ["KB", "MB", "GB"];
  let i = -1;
  let v = n;
  do { v /= 1024; i++; } while (v >= 1024 && i < u.length - 1);
  return (v >= 100 ? Math.round(v) : v.toFixed(1)) + " " + u[i];
}
function fmtDur(ms) {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = s % 60;
  const p = (x) => String(x).padStart(2, "0");
  return h ? h + ":" + p(m) + ":" + p(ss) : p(m) + ":" + p(ss);
}
async function tickSession() {
  if (!vpnOn) return;
  if (!connectEpoch) connectEpoch = Date.now();
  $("sess-time").textContent = fmtDur(Date.now() - connectEpoch);
  try {
    const t = await call("tunnel_traffic");
    if (t && typeof t.rx === "number") {
      $("sess-rx").textContent = fmtBytes(t.rx);
      $("sess-tx").textContent = fmtBytes(t.tx);
    }
  } catch (e) { /* counters best-effort */ }
}
setInterval(() => { if (vpnOn) tickSession(); }, 2000);

$("btn-connect").onclick = async () => {
  if (busy) return;
  if (vpnOn) {
    setBusy(true);
    try {
      // never wait forever on a wedged engine
      const r = await Promise.race([
        call("tunnel_stop"),
        new Promise((res) => setTimeout(() => res({ ok: true, msg: t("stopping") }), 3000)),
      ]);
      for (let i = 0; i < 6 && vpnOn; i++) {
        await new Promise((res) => setTimeout(res, 1000));
        await pollTunnel();
      }
      paintHero();
    } finally { setBusy(false); }
    return;
  }
  const uuid = $("tunnel-card").value;
  if (!uuid) {
    bar(false, t("needCard"));
    return;
  }
  if (appsMode !== "all" && !appsPicked.length) {
    bar(false, t("appsNeedPick"));
    goTab("apps");
    return;
  }
  if (!connected) await doProbe();
  if (!connected) return;
  setBusy(true);
  try {
    const r = await call("tunnel_start", {
      uuid,
      appsMode: appsMode === "all" ? "" : appsMode,
      apps: appsPicked,
      transport,
    });
    // the consent dialog may pop; poll until the service reports in
    for (let i = 0; i < 10; i++) {
      await new Promise((res) => setTimeout(res, 1000));
      await pollTunnel();
      if (vpnOn) break;
    }
    if (!vpnOn) await pollTunnel();
    if (vpnError) bar(false, "VPN failed: " + vpnError);
    paintHero();
  } finally { setBusy(false); }
};


document.querySelectorAll("#lang-seg button").forEach((b) => {
  b.onclick = () => applyLang(b.dataset.lang);
});
// Tap the home net rows to see the full host (toast overlay, layout never grows).
$("home-ipbox").onclick = () => { if (serverHost) bar(true, serverIp && serverIp !== serverHost ? serverIp + " · " + serverHost : serverHost); };
// First-run coach for people who never used the app. Shows once, only when
// there are no cards yet. Dismissing remembers the choice.
$("btn-coach").onclick = () => {
  $("coach").hidden = true;
  localStorage.setItem("qc-onboard", "1");
};
// Permanent entry to the guide, next to the other quiet tools.
$("btn-how").onclick = () => { $("coach").hidden = false; };
function maybeCoach(hasCards) {
  if (!hasCards && !localStorage.getItem("qc-onboard")) $("coach").hidden = false;
  else $("coach").hidden = true;
}

fillSniSelect();
applyLang(lang);
// Decorative icons stay out of the accessibility tree; state lives in text.
document.querySelectorAll("svg").forEach((s) => s.setAttribute("aria-hidden", "true"));
// Soft keyboard: feed the visible height to CSS so centered sheets shrink
// and recenter above the keyboard instead of hiding behind it.
(function () {
  const vv = window.visualViewport;
  if (!vv) return;
  const sync = () => {
    document.documentElement.style.setProperty("--vvh", Math.round(vv.height) + "px");
  };
  vv.addEventListener("resize", sync);
  sync();
})();
(async () => {
  await refresh();
  loadApps();
  autoUpdateCheck();
  // Auto-connect on open, like the desktop app. The server is built in,
  // so there is nothing to type - it just connects by itself.
  if (serverHost && !connected) await doProbe();
  await pollTunnel();
  setInterval(pollTunnel, 4000);
})();

// ---------------------------------------------------------------------------
// Speed test. Same first-party endpoint the desktop measures with: latency
// probes, then a rolling-window download and a streamed upload, so whatever
// route the WebView is on (through the tunnel or bare) is the route measured.
// ---------------------------------------------------------------------------
// Speed: the desktop screen, the same test and the same drawing. Eight ping
// probes, then a nine second download and a nine second upload against the
// app's own server through whatever route the WebView is on (the tunnel when
// it is up). One sample per bar as it arrives, newest at the right of the
// field, coloured by the phase: amber ping, blue download, green upload.
// ---------------------------------------------------------------------------
const SP_HIST = "qc-speed-history";
const SP_PING_PROBES = 8;
const SP_PHASE_SECONDS = 9;
const SP_BARS = 48;
const SP_SAMPLE_MS = 90;
let spCtl = null;
let spSamples = [];
let spPeak = 0;
let spPhase = "idle";
let spGateAt = 0;
let spNet = null;
let spLast = { ping: null, jitter: null, down: null, up: null };

// Where the test measures. Same rules as the desktop: gather the real public
// test servers (speedtest.net's own list, ranked by distance from this
// address, plus the LibreSpeed pool), probe the nearest few, run against the
// winner. Cloudflare is always in the pool (anycast, so it is also a nearest
// edge), and the QuotaVPN server is always offered by hand.
const SP_CF = {
  id: "cloudflare",
  label: "Cloudflare",
  detail: "Cloudflare, Inc.",
  host: "speed.cloudflare.com",
  ping: "https://speed.cloudflare.com/__down?bytes=10000",
  down: ["https://speed.cloudflare.com/__down?bytes=52428800"],
  up: "https://speed.cloudflare.com/__up",
};
function spOwnServer() {
  if (!serverHost) return null;
  return {
    id: "own",
    label: t("srvName"),
    detail: t("srvOwnNote"),
    host: serverHost,
    ping: "https://" + serverHost + "/speed/ping",
    down: ["https://" + serverHost + "/speed/down?bytes=52428800"],
    up: "https://" + serverHost + "/speed/up",
  };
}
let spPool = [];
let spTarget = null;
let spChoose = "auto"; // auto | own | <server id>
let spPicking = false;

function spDisplayHost(base) {
  try { return new URL(base).host; } catch (e) { return String(base).replace(/^https?:\/\//, "").split("/")[0]; }
}
function spFromOokla(e) {
  const raw = String((e && e.url) || "").trim();
  if (!raw) return null;
  // Entries point at upload.php; the base carries latency.txt, the random*.jpg
  // downloads and the upload endpoint.
  const base = raw.replace(/\/upload\.php.*$/i, "").replace(/\/+$/, "");
  if (!base) return null;
  const sponsor = String(e.sponsor || "").trim();
  const place = String(e.name || "").trim();
  const country = String(e.country || "").trim();
  const km = typeof e.distance === "number" ? Math.round(e.distance) : null;
  return {
    id: "ookla-" + (String(e.host || "").trim() || base),
    label: [sponsor, place].filter(Boolean).join(" · ") || spDisplayHost(base),
    detail: [country, km !== null ? km + " km" : ""].filter(Boolean).join(" · "),
    host: spDisplayHost(base),
    ping: base + "/latency.txt",
    down: [base + "/random7000x7000.jpg", base + "/random2000x2000.jpg", base + "/random1000x1000.jpg"],
    up: base + "/upload.php",
  };
}
function spJoin(base, path) {
  return String(base).replace(/\/+$/, "") + "/" + String(path).replace(/^\/+/, "");
}
function spFromLibre(e) {
  const base = String((e && e.server) || "").trim();
  if (!base || !e.dlURL || !e.ulURL || !e.pingURL) return null;
  const whole = String(e.name || "").trim() || spDisplayHost(base);
  const label = whole.split(" (")[0].trim() || spDisplayHost(base);
  const inName = /\(([^)]+)\)/.exec(whole);
  return {
    id: "ls-" + spDisplayHost(base),
    label: label,
    detail: (String(e.sponsorName || "").trim() || (inName ? inName[1] : "")).trim(),
    host: spDisplayHost(base),
    ping: spJoin(base, e.pingURL) + "?cors=true",
    down: [spJoin(base, e.dlURL) + "?ckSize=50&cors=true"],
    up: spJoin(base, e.ulURL) + "?cors=true",
  };
}
async function spLoadPool() {
  let ookla = null;
  let libre = null;
  const raw = await call("speed_servers");
  if (raw && typeof raw === "string") {
    try {
      const p = JSON.parse(raw);
      if (Array.isArray(p.ookla)) ookla = p.ookla;
      if (Array.isArray(p.librespeed)) libre = p.librespeed;
    } catch (e) { /* fall through to Cloudflare alone */ }
  }
  const pool = [];
  (ookla || [])
    .slice()
    .sort((a, b) => ((a && a.distance) || 1e18) - ((b && b.distance) || 1e18))
    .forEach((e) => { const s = spFromOokla(e); if (s) pool.push(s); });
  pool.push(SP_CF);
  (libre || []).forEach((e) => { const s = spFromLibre(e); if (s) pool.push(s); });
  spPool = pool;
  return pool;
}
/// Lowest round trip wins, among servers that can complete the whole path.
async function spPickFastest(pool) {
  const shortlist = pool.slice(0, 9);
  if (shortlist.length <= 1) return pool[0] || SP_CF;
  const reach = await Promise.all(
    shortlist.map((s) => call("speed_latency", { url: s.ping, probes: 1 })
      .then((r) => Array.isArray(r) && r.length > 0)
      .catch(() => false)),
  );
  let cands = shortlist.filter((_, i) => reach[i]);
  if (!cands.length) cands = [SP_CF];
  const times = await Promise.all(
    cands.map((s) => call("speed_latency", { url: s.ping, probes: 1 })
      .then((r) => (Array.isArray(r) && r.length ? Math.min.apply(null, r) : null))
      .catch(() => null)),
  );
  let best = cands[0];
  let bestMs = Infinity;
  cands.forEach((s, i) => {
    const ms = times[i];
    if (ms !== null && ms < bestMs) { best = s; bestMs = ms; }
  });
  // A server can answer a ping and still serve nothing (an empty body or a
  // wall), which would leave the run at zero. Prove bytes before trusting it,
  // and try the runners up before falling back to Cloudflare.
  const okBoth = async (s) => {
    const d = await call("speed_down", { urls: s.down, seconds: 0.7 });
    if (!d || !d.bytes) return false;
    const u = await call("speed_up", { url: s.up, seconds: 0.8, chunkMb: 1 });
    return !!(u && u.samples && u.samples.length && u.mbps > 0);
  };
  if (await okBoth(best)) return best;
  for (const s of cands) {
    if (s === best) continue;
    if (await okBoth(s)) return s;
  }
  return SP_CF;
}
function spFindInPool(id) {
  if (id === "own") return spOwnServer();
  for (const s of spPool) if (s.id === id) return s;
  if (id === "cloudflare") return SP_CF;
  return null;
}
function spTargetDef() {
  if (spTarget) return spTarget;
  if (spChoose === "own") { const own = spOwnServer(); if (own) return own; }
  return SP_CF;
}
function spTargetLabel() { return spSim() ? t("cfName") : spTargetDef().label; }
function spTargetNote() { return spSim() ? t("srvPublic") : (spTargetDef().detail || ""); }
/// Load the pool and pick, the way the desktop does on open and on refresh.
async function spRefreshTarget() {
  if (spSim() || spPicking) return;
  spPicking = true;
  const note = $("sp-note");
  if (note) note.textContent = t("findingServer");
  try {
    const pool = await spLoadPool();
    if (spChoose === "own") {
      spTarget = spOwnServer() || SP_CF;
    } else if (spChoose !== "auto") {
      spTarget = spFindInPool(spChoose) || (await spPickFastest(pool));
    } else {
      spTarget = await spPickFastest(pool);
    }
  } catch (e) {
    spTarget = spChoose === "own" ? spOwnServer() : SP_CF;
  }
  spPicking = false;
  spPaintTarget();
}

const spSleep = (ms) => new Promise((r) => setTimeout(r, ms));
function spNum(v, unit) {
  if (v == null) return "-";
  if (unit === "ms") return String(Math.round(v));
  return v >= 100 ? v.toFixed(0) : v.toFixed(1);
}
const spMeanAbsDelta = (xs) =>
  xs.length < 2 ? 0 : xs.slice(1).reduce((a, v, i) => a + Math.abs(v - xs[i]), 0) / (xs.length - 1);

// One thin bar per sample, the run filling from the left. Idle the row is a
// flat set of stubs on its hairline; during a run it is alive; when the run
// ends it stays put as the fingerprint of that connection.
function spPaintBars() {
  const box = $("sp-bars");
  if (!box) return;
  while (box.childElementCount < SP_BARS) {
    const b = document.createElement("span");
    b.style.height = "2px";
    box.append(b);
  }
  const tail = spSamples.slice(-SP_BARS);
  const view = tail.length >= SP_BARS ? tail : tail.concat(new Array(SP_BARS - tail.length).fill(0));
  const max = Math.max(1, ...view);
  const accent = spPhase === "upload" ? "var(--green)" : spPhase === "ping" ? "var(--amber)" : "var(--accent)";
  for (let i = 0; i < SP_BARS; i++) {
    const v = view[i] || 0;
    const q = v / max;
    const bar = box.children[i];
    bar.style.height = v === 0 ? "2px" : Math.max(8, q * 100) + "%";
    bar.style.background = "color-mix(in oklab, " + accent + " " + Math.round(18 + q * 62) + "%, rgb(255 255 255 / 0.10))";
    bar.style.opacity = v === 0 ? "0.28" : (spCtl && i === SP_BARS - 1) ? "1" : "0.92";
  }
}
function spPaintTiles() {
  const live = spSamples.length ? spSamples[spSamples.length - 1] : null;
  const set = (id, v) => { const el = $(id); if (el) el.textContent = v; };
  set("sp-ping", spPhase === "ping" ? (live == null ? "-" : String(Math.round(live))) : (spLast.ping == null ? "-" : String(spLast.ping)));
  set("sp-jit", spLast.jitter == null ? "-" : spLast.jitter.toFixed(1));
  set("sp-down", spPhase === "download" ? (live == null ? "-" : spNum(live, "mbps")) : (spLast.down == null ? "-" : spNum(spLast.down, "mbps")));
  set("sp-up", spPhase === "upload" ? (live == null ? "-" : spNum(live, "mbps")) : (spLast.up == null ? "-" : spNum(spLast.up, "mbps")));
}
function spPaintReadout() {
  const v = spSamples.length ? spSamples[spSamples.length - 1] : 0;
  const val = $("sp-value");
  if (val) val.textContent = spNum(v, spPhase === "ping" ? "ms" : "mbps");
  const un = $("sp-unit");
  if (un) un.textContent = t(spPhase === "ping" ? "ms" : "mbps");
  const pk = $("sp-peak");
  if (pk) {
    const show = spPeak > 0 && spSamples.length > 0;
    pk.hidden = !show;
    if (show) {
      const u = spPhase === "ping" ? "ms" : "mbps";
      pk.textContent = t("peak") + " " + spNum(spPeak, u) + " " + t(u);
    }
  }
  spPaintBars();
  spPaintTiles();
}
function spPush(v, force) {
  const now = performance.now();
  if (!force && now - spGateAt < SP_SAMPLE_MS) return;
  spGateAt = now;
  spSamples.push(v);
  if (spSamples.length > SP_BARS * 2) spSamples.shift();
  if (v > spPeak) spPeak = v;
  spPaintReadout();
}
function spSetPhase(phase, capKey, hintKey) {
  spPhase = phase;
  const cap = $("sp-cap");
  if (cap) cap.textContent = t(capKey);
  const hint = $("sp-hint");
  if (hint) hint.textContent = hintKey ? t(hintKey) : "";
  spPaintReadout();
}
function spPaintTarget() {
  const d = spTargetDef();
  const el = $("sp-target");
  if (el) el.textContent = spTargetLabel();
  const host = $("sp-host");
  if (host) host.textContent = d.host || t("findingServer");
  const note = $("sp-note");
  if (note) note.textContent = spTargetNote();
  const sub = $("sp-sub");
  if (sub) {
    try { sub.textContent = activeKind() + " · " + (d.host || "-"); } catch (e) { sub.textContent = d.host || "-"; }
  }
}

// Who this device is on the way out, resolved on the backend. The webview is
// not asked: this is the same reason the speed test itself is native.
let spNetBusy = false;
async function spResolveNet() {
  spNetBusy = true;
  paintRefresh();
  const r = await call("net_info");
  spNet = (r && typeof r === "object" && r.ip) ? { isp: r.isp || r.ip, ip: r.ip, place: r.place || "" } : null;
  // The website copy has no backend to ask, so it falls back to the two
  // resolvers a browser can reach. Same panel, same meaning.
  if (!spNet) spNet = await netInfoFallback();
  spNetBusy = false;
  paintNet(spNet);
  paintRefresh();
}
function paintNet(n) {
  const isp = $("sp-isp");
  if (isp) isp.textContent = n ? (n.isp || n.ip || "-") : "-";
  const ip = $("sp-ip");
  if (ip) ip.textContent = n ? (n.ip || "") : "";
  const place = $("sp-place");
  if (place) place.textContent = n ? (n.place || "") : "";
}
// Same two resolvers the desktop falls back to, and only if the native one
// came back empty (a rate limit on the exit address, usually).
async function netInfoFallback() {
  const tries = [
    { url: "https://ipwho.is/", pick: (j) => (j && j.success !== false && j.ip) ? { isp: (j.connection && j.connection.isp) || j.ip, ip: j.ip, place: [j.city, j.country].filter(Boolean).join(", ") } : null },
    { url: "https://ipapi.co/json/", pick: (j) => (j && j.ip) ? { isp: j.org || j.ip, ip: j.ip, place: [j.city, j.country_name].filter(Boolean).join(", ") } : null },
  ];
  for (const s of tries) {
    try {
      const r = await fetch(s.url, { cache: "no-store" });
      if (!r.ok) continue;
      const out = s.pick(await r.json());
      if (out) return out;
    } catch (e) { /* next */ }
  }
  return null;
}
function paintRefresh() {
  const b = $("sp-refresh");
  if (b) b.classList.toggle("spin", !!spNetBusy);
  if (b) b.disabled = !!spNetBusy;
}

// The website copy has no native side: it ramps its own numbers so the screen
// reads the same without a server behind it.
function spSim() {
  return window.__QVPN_SPEED_SIM__ === true;
}
async function spSimPhase(peak, seconds, signal) {
  const steps = Math.round((seconds * 1000) / 120);
  let best = 0;
  for (let i = 0; i < steps && !signal.aborted; i++) {
    const p = i / steps;
    const v = peak * (1 - Math.exp(-6 * p)) * (1 - 0.08 * Math.sin(p * 22));
    if (v > best) best = v;
    spPush(v);
    await spSleep(120);
  }
  return best;
}

// One native window: the phone asks the backend for a slice of the phase, gets
// the ticks inside it, and draws them. Same measure the desktop takes, same
// 250ms rhythm; the request never touches the webview's network stack.
async function spNative(which, seconds, target) {
  if (which === "ping") {
    return await call("speed_latency", { url: target.ping, probes: SP_PING_PROBES });
  }
  if (which === "down") {
    return await call("speed_down", { urls: target.down, seconds });
  }
  return await call("speed_up", { url: target.up, seconds, chunkMb: 1 });
}

function spBad(r) {
  return !r || (typeof r === "object" && r.ok === false) || (typeof r === "object" && r.error);
}
function spReason(r) {
  if (r && typeof r === "object" && r.msg) return r.msg;
  if (r && typeof r === "object" && r.note) return r.note;
  return t("noReply");
}

function spLoad() {
  try {
    const a = JSON.parse(localStorage.getItem(SP_HIST) || "[]");
    return Array.isArray(a) ? a : [];
  } catch (e) { return []; }
}
function spPaintHistory() {
  const box = $("sp-hist");
  if (!box) return;
  const list = spLoad();
  const cnt = $("sp-count");
  if (cnt) cnt.textContent = list.length ? "(" + list.length + ")" : "";
  box.innerHTML = "";
  if (!list.length) {
    const p = document.createElement("p");
    p.className = "empty";
    p.textContent = t("spNone");
    box.append(p);
    return;
  }
  for (const r of list.slice(0, 8)) {
    const row = document.createElement("div");
    row.className = "sp-row";
    const d = new Date(r.at || Date.now());
    const when = d.toLocaleTimeString(lang === "ar" ? "ar-EG" : "en-GB", { hour: "2-digit", minute: "2-digit" });
    const day = d.toLocaleDateString(lang === "ar" ? "ar-EG" : "en-GB", { day: "numeric", month: "short" });
    const left = document.createElement("span");
    left.className = "when";
    left.textContent = when + " · " + day;
    const right = document.createElement("span");
    right.className = "val";
    right.textContent = "↓ " + spNum(r.down, "mbps") + "  ↑ " + spNum(r.up, "mbps") + " " + t("mbps");
    row.append(left, right);
    box.append(row);
  }
}
function spStore() {
  const list = spLoad();
  list.unshift({ at: Date.now(), ping: spLast.ping, jitter: spLast.jitter, down: spLast.down, up: spLast.up, target: spTargetDef().host || "" });
  try { localStorage.setItem(SP_HIST, JSON.stringify(list.slice(0, 100))); } catch (e) {}
  spPaintHistory();
}

function spPaintRunState() {
  const btn = $("sp-run");
  if (btn) btn.disabled = !!spCtl;
  const lbl = $("sp-run-label");
  if (lbl) lbl.textContent = spCtl ? t("measuring") : t("startTest");
  const stop = $("sp-stop");
  if (stop) stop.hidden = !spCtl;
  document.querySelectorAll(".sstat").forEach((b) => { b.disabled = !!spCtl; });
}

async function spRunPhase(which, signal, target) {
  target = target || spTargetDef();
  if (which === "ping") {
    spSetPhase("ping", "pingTitle", "pingHint");
    spSamples = [];
    spPeak = 0;
    spGateAt = 0;
    spPaintReadout();
    let ms;
    if (spSim()) {
      ms = [];
      for (let i = 0; i < SP_PING_PROBES; i++) ms.push(28 + Math.random() * 30);
    } else {
      const r = await spNative("ping", 0, target);
      if (spBad(r)) throw new Error(spReason(r));
      ms = Array.isArray(r) ? r.filter((v) => typeof v === "number" && v > 0) : [];
    }
    if (!ms.length) throw new Error("no reply");
    for (const v of ms) {
      if (signal.aborted) break;
      spPush(v);
      await spSleep(70);
    }
    spLast.ping = Math.round(Math.min(...ms));
    spLast.jitter = spMeanAbsDelta(ms);
    spPush(spLast.ping, true);
    return true;
  }

  const down = which === "down";
  spSetPhase(down ? "download" : "upload", down ? "chDown" : "chUp", down ? "downHint" : "upHint");
  spSamples = [];
  spPeak = 0;
  spGateAt = 0;
  spPaintReadout();

  const SLICES = 15;
  const SLICE_S = 0.6;
  let bytes = 0;
  let secs = 0;
  const rates = [];
  for (let i = 0; i < SLICES && !signal.aborted; i++) {
    if (spSim()) {
      const v = await spSimPhase(down ? 260 : 36, 1, signal);
      if (down) { bytes += Math.round((v * 1e6) / 8); secs += SLICE_S; } else rates.push(v);
      continue;
    }
    let r = await spNative(which, SLICE_S, target);
    if (!down && (spBad(r) || !(r && r.samples && r.samples.length))) {
      // A server that answers a ping and serves a download can still refuse an
      // upload. The reading matters more than whose server took it, so the
      // public reference finishes the phase and says so.
      const cf = await spNative("up", SLICE_S, SP_CF);
      if (!spBad(cf) && cf && cf.samples && cf.samples.length) {
        r = cf;
        const hint = $("sp-hint");
        if (hint && spPhase === "upload") hint.textContent = t("upHint") + " " + t("viaReference");
      }
    }
    if (spBad(r)) throw new Error(spReason(r));
    for (const v of (r.samples || [])) {
      if (signal.aborted || typeof v !== "number") break;
      spPush(v);
      await spSleep(45);
    }
    if (down) {
      bytes += r.bytes || 0;
      secs += r.secs || 0;
    } else {
      for (const v of (r.samples || [])) if (typeof v === "number" && v > 0) rates.push(v);
    }
  }
  if (signal.aborted) return false;

  if (down) {
    const v = secs > 0 ? (bytes * 8) / secs / 1e6 : 0;
    if (v > 0) {
      spLast.down = v;
      spPush(v, true);
    }
    return v > 0;
  }
  // Same rule as the desktop: the first chunk only fills buffers, the median
  // of the rest is the reading.
  const body = rates.length > 1 ? rates.slice(1) : rates.slice();
  const sorted = body.slice().sort((a, b) => a - b);
  const v = sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;
  if (v > 0) {
    spLast.up = v;
    spPush(v, true);
  }
  return v > 0;
}

async function spRun(which) {
  if (spCtl) return;
  spCtl = new AbortController();
  const signal = spCtl.signal;
  spPaintRunState();
  void spResolveNet();
  try {
    const want = which === "all" ? ["ping", "down", "up"] : which === "ping2" ? ["ping"] : [which];
    const runTarget = spTargetDef();
    for (const w of want) {
      if (signal.aborted) break;
      try {
        await spRunPhase(w, signal, runTarget);
      } catch (e) {
        if (signal.aborted) break;
        const hint = $("sp-hint");
        if (hint) hint.textContent = t("noReply");
      }
    }
    if (!signal.aborted) {
      spPhase = "done";
      const cap = $("sp-cap");
      if (cap) cap.textContent = t("done");
      spPaintReadout();
      if (spLast.down != null || spLast.up != null) spStore();
    }
  } finally {
    spCtl = null;
    spPaintRunState();
    spPaintReadout();
  }
}
function spStop() {
  if (!spCtl) return;
  spCtl.abort();
  spCtl = null;
  spPhase = "idle";
  const cap = $("sp-cap");
  if (cap) cap.textContent = t("idle");
  const hint = $("sp-hint");
  if (hint) hint.textContent = "";
  spPaintRunState();
  spPaintReadout();
}

$("sp-run").onclick = () => { void spRun("all"); };
$("sp-stop").onclick = spStop;
// Same job as the desktop's refresh button: re-read the connection you are on
// and repaint the target panel, with the icon turning while it works.
$("sp-refresh").onclick = () => {
  if (spNetBusy || spPicking) return;
  void spResolveNet();
  void spRefreshTarget();
};
// The Server panel opens the target picker, the way the desktop's does.
const spServerPanel = $("sp-server-panel");
if (spServerPanel) spServerPanel.onclick = () => openSheet("target");
document.querySelectorAll(".sstat").forEach((b) => {
  b.onclick = () => { if (!spCtl) void spRun(b.dataset.which); };
});
try {
  const saved = localStorage.getItem("qc-speed-target");
  if (saved) spChoose = saved;
  if (spChoose === "own" || spChoose === "cloudflare") spTarget = spFindInPool(spChoose);
} catch (e) {}
spPaintTarget();
spPaintReadout();
spPaintHistory();
spPaintRunState();

// Repaint the screen whenever its tab comes up, and resolve the exit network
// the first time it is opened (values may have changed while it was hidden).
let spNetLoaded = false;
const qcGoTab = goTab;
goTab = function (name, push) {
  qcGoTab(name, push);
  if (name === "speed") {
    spPaintTarget();
    spPaintReadout();
    spPaintHistory();
    if (!spNetLoaded) {
      spNetLoaded = true;
      void spResolveNet();
      void spRefreshTarget();
    }
  }
};
