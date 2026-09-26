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
    cardForVpn: "Profile", route: "Gateway", protected: "Protected", wholeDevice: "Whole device",
    yourIp: "Your IP", newCard: "New card", cardName: "Card name", exName: "e.g. Yousef, PC, phone",
    domainSni: "Domain", customDomain: "custom domain…", customDomainOpt: "Custom domain…",
    generateCard: "Generate card", myCards: "My cards", serverHint: "Automatic configuration.",
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
    spUping: "Measuring upload", spDone: "Done", spFail: "No reply from the server.",
    spStart: "Start test", spStop: "Stop", spPing: "Ping", spJitter: "Jitter", spDown: "Down", spUp: "Up",
    spHint: "Measures the route the card on Home is using right now.",
    spHistory: "Recent runs", spNone: "No runs yet.",
    updOut: "{v} is out.", updLatest: "{v} is the latest.", updFail: "Could not reach GitHub.",
    updDownloading: "Downloading the update…", updOpened: "Installer opened. Confirm to update.",
    updAllow: "Allow installs from QuotaVPN in the screen that opened, then tap again.",
    bgHint: "Some phones stop the VPN when you swipe the app away. Allow background running so it stays on.",
    bgHintOn: "Background running is allowed. The VPN stays on when you swipe the app away.",
    bgBtnAllow: "Allow background running",
    bgBtnStop: "Disallow background running",
    vpnConnected: "VPN Connected", serverReady: "Server ready", notConnected: "Not connected",
    working: "Working…", talking: "Talking to your server.", trafficThru: "All traffic goes through ",
    readySub: "Server is set up. Pick a card and connect.", idleSub: "Pick a card and connect.",
    connect: "Connect", disconnect: "Disconnect", connected: "Connected",
    vpnOn: "vpn on", ready: "ready", idle: "idle",
    copy: "Copy", revoke: "Revoke", revokeSure: "Sure?", inUse: "In use", kindGamerz: "Gamerz", kindStreamerz: "Streamerz",
    noCards: "No active cards yet. Tap + to generate your first card.", firstCard: "+ New card", noCardsOpt: "No cards - generate one first",
    needCard: "Generate a card first, then connect.", stopping: "Stopping…",
    secTraffic: "Traffic and routing", routing: "App routing", back: "Back", cancel: "Cancel",
    addCard: "+ New", connecting: "Connecting…", ping: "Ping",
    sheetSearch: "Search domains…",
    obTitle: "How QuotaVPN works", ob1: "Create a card - pick Gamerz or Streamerz.",
    ob2: "Pick that card on Home.", ob3: "Hit Connect - back out anytime, the VPN stays on.", obGot: "Got it",
  },
  ar: {
    cardForVpn: "البروفايل", route: "البوابة", protected: "الحماية", wholeDevice: "الجهاز بالكامل",
    yourIp: "عنوان الـIP", newCard: "بطاقة جديدة", cardName: "اسم البطاقة", exName: "مثال: يوسف، الموبايل، اللابتوب",
    domainSni: "الدومين", customDomain: "دومين مخصص…", customDomainOpt: "دومين مخصص…",
    generateCard: "إنشاء بطاقة", myCards: "بطاقاتي", serverHint: "إعداد تلقائي",
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
    spUping: "قياس الرفع", spDone: "خلص", spFail: "مفيش رد من السيرفر.",
    spStart: "ابدأ الاختبار", spStop: "إيقاف", spPing: "بينج", spJitter: "تذبذب", spDown: "تحميل", spUp: "رفع",
    spHint: "بيقيس المسار اللي البطاقة اللي في الرئيسية ماشية عليه دلوقتي.",
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
    obTitle: "كيف يعمل QuotaVPN", ob1: "أنشئ بطاقة - اختر جيمرز أو ستريمرز.",
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
  document.querySelectorAll("#kind-seg button").forEach((x) => {
    x.textContent = kindName(x.dataset.kind);
  });
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

let barTimer = 0;
// Rust sends English status lines; show them in Arabic when that is the UI language.
const RUST_AR = {
  "Connected - server ready.": "السيرفر جاهز.",
  "No server set up.": "جهّز السيرفر الأول.",
  "Set up your server first.": "جهّز السيرفر الأول.",
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
  closeNewCard();
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
  for (const id of ["btn-connect", "btn-generate"]) $(id).disabled = b;
  paintHero();
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

// Card counter follows the rows on screen, never waits for the server.
function paintCardsCount() {
  const n = $("cards").children.length;
  $("cards-count").textContent = n ? "(" + n + ")" : "";
}
async function refresh() {
  const st = await call("get_state");
  if (!st || !st.cards) return;
  serverHost = st.server_ip || "";
  serverIp = "";
  paintHero();
  const list = $("cards");
  list.innerHTML = "";
  $("cards-count").textContent = st.cards.length ? `(${st.cards.length})` : "";
  $("btn-add-card").style.display = st.cards.length ? "" : "none";
  list.classList.toggle("is-empty", !st.cards.length);
  if (!st.cards.length) {
    list.innerHTML = `<p class="empty">${t("noCards")}</p>`;
    const b = document.createElement("button");
    b.textContent = t("firstCard");
    b.onclick = () => openNewCard();
    const wrap = document.createElement("p");
    wrap.className = "empty";
    wrap.append(b);
    list.append(wrap);
    fillTunnelCards([]);
    maybeCoach(false);
    return;
  }
  for (const c of st.cards) {
    const row = document.createElement("div");
    row.className = "cardrow";
    row.dataset.uuid = c.uuid;
    const dotCls = c.card_type.startsWith("Gamerz") ? "gamerz" : "streamerz";
    row.innerHTML = `<span class="dot ${dotCls}"></span>
      <div class="meta"><div class="name"></div><div class="sni"></div><div class="use"></div></div>`;
    row.querySelector(".name").textContent = c.name;
    const rawSni = c.sni || c.card_type;
    const sniEl = row.querySelector(".sni");
    sniEl.dataset.raw = rawSni;
    sniEl.textContent = c.sni || kindName(c.card_type);
    const bCopy = document.createElement("button");
    bCopy.className = "btn-copy";
    bCopy.textContent = t("copy");
    bCopy.onclick = async () => {
      const r = await call("copy_card", { uuid: c.uuid });
      bar(r.ok, r.msg);
    };
    const bRev = document.createElement("button");
    bRev.className = "btn-rev";
    bRev.textContent = t("revoke");
    bRev.onclick = async () => {
      if (busy) return;
      // Destructive: first tap arms, second tap removes.
      if (bRev.dataset.arm !== "1") {
        bRev.dataset.arm = "1";
        bRev.textContent = t("revokeSure");
        bRev.classList.add("armed");
        setTimeout(() => {
          if (bRev.isConnected) { bRev.dataset.arm = ""; bRev.textContent = t("revoke"); bRev.classList.remove("armed"); }
        }, 3000);
        return;
      }
      // Optimistic: the row goes at once, the server reconciles after.
      row.remove();
      paintCardsCount();
      try {
        const r = await call("revoke_card", { uuid: c.uuid });
        bar(r.ok, r.msg);
        await refresh();
      } finally { setBusy(false); }
    };
    row.append(bCopy, bRev);
    list.append(row);
  }
  maybeCoach(true);
  fillTunnelCards(st.cards);
  // Slow DNS last: the list is already painted, the IP fills in after.
  if (serverHost && /[a-zA-Z]/.test(serverHost)) {
    try { serverIp = await call("resolve_host", { host: serverHost }); } catch (e) { serverIp = ""; }
    paintHero();
  }
}

document.querySelectorAll("#kind-seg button").forEach((b) => {
  b.onclick = () => {
    kind = b.dataset.kind;
    document.querySelectorAll("#kind-seg button").forEach((x) =>
      x.classList.toggle("on", x === b));
    $("card-sni-select").value = DEFAULT_SNI[kind];
    $("card-sni").hidden = true;
    updateSniBtn();
  };
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
  const sel = $("card-sni-select");
  const opt = sel.options[sel.selectedIndex];
  $("card-sni-name").textContent = opt ? opt.textContent : "-";
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
  if (which === "card") {
    $("sheet-title").textContent = t("cardForVpn");
    const sel = $("tunnel-card");
    const usable = [...sel.options].filter((o) => o.value);
    if (!usable.length) {
      const b = document.createElement("button");
      b.className = "opt dim";
      b.textContent = t("noCardsOpt");
      b.onclick = () => { closeSheet(); goTab("cards"); openNewCard(); };
      list.append(b);
    }
    usable.forEach((o) => {
      list.append(optRow(o.textContent.split(" (")[0], o.dataset.sni || "", o.value === sel.value, () => {
        sel.value = o.value;
        $("tunnel-card").onchange();
        closeSheet();
      }));
    });
    $("tunnel-card-btn").setAttribute("aria-expanded", "true");
  } else {
    $("sheet-title").textContent = t("domainSni");
    const sel = $("card-sni-select");
    // Only this card type's domains: Gamerz never sees Streamerz entries.
    const want = kindName(kind);
    [...sel.options].forEach((o) => {
      const grp = o.parentElement.tagName === "OPTGROUP" ? o.parentElement.label : "";
      if (grp && grp !== want) return;
      list.append(optRow(o.textContent, "", o.value === sel.value, () => {
        sel.value = o.value;
        $("card-sni-select").onchange();
        closeSheet();
      }));
    });
    $("card-sni-btn").setAttribute("aria-expanded", "true");
  }
  list.scrollTop = 0;
  // Domain picker gets a live filter; the card picker stays a plain list.
  const ss = $("sheet-search");
  if (which === "sni") { ss.hidden = false; ss.value = ""; }
  else { ss.hidden = true; ss.value = ""; }
  $("sheet-back").hidden = false;
  const sh = $("sheet");
  sh.hidden = false;
  requestAnimationFrame(() => requestAnimationFrame(() => sh.classList.add("open")));
  try { history.pushState({ tab: currentTab(), sheet: 1 }, ""); } catch (e) {}
}
function closeSheet() {
  sheetFor = null;
  $("sheet-search").hidden = true;
  $("sheet-search").value = "";
  $("tunnel-card-btn").setAttribute("aria-expanded", "false");
  $("card-sni-btn").setAttribute("aria-expanded", "false");
  const sh = $("sheet");
  sh.classList.remove("open");
  setTimeout(() => { sh.hidden = true; $("sheet-back").hidden = true; }, 200);
}
$("tunnel-card-btn").onclick = () => openSheet("card");
$("card-sni-btn").onclick = () => openSheet("sni");
$("sheet-back").onclick = closeSheet;
$("sheet-search").oninput = (e) => {
  const q = e.target.value.trim().toLowerCase();
  document.querySelectorAll("#sheet-list > *").forEach((el) => {
    if (el.classList.contains("grp")) { el.style.display = q ? "none" : ""; return; }
    el.style.display = (!q || el.textContent.toLowerCase().includes(q)) ? "" : "none";
  });
};
document.addEventListener("keydown", (e) => { if (e.key === "Escape") { if (sheetFor) closeSheet(); closeNewCard(); } });
// New-card dialog: centered, same overlay pattern as the pickers.
function openNewCard() {
  $("nc-back").hidden = false;
  const sh = $("newcard-sheet");
  sh.hidden = false;
  requestAnimationFrame(() => requestAnimationFrame(() => sh.classList.add("open")));
  setTimeout(() => { const n = $("card-name"); if (n) n.focus(); }, 220);
}
function closeNewCard() {
  const sh = $("newcard-sheet");
  if (!sh || sh.hidden) return;
  sh.classList.remove("open");
  setTimeout(() => { sh.hidden = true; $("nc-back").hidden = true; }, 200);
}
$("btn-add-card").onclick = openNewCard;
$("btn-cancel-card").onclick = closeNewCard;
$("nc-back").onclick = closeNewCard;
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

$("btn-generate").onclick = async () => {
  if (busy) return;
  const sni = selectedSni() || DEFAULT_SNI[kind];
  setBusy(true);
  try {
    const r = await call("generate_card", {
      name: $("card-name").value.trim(),
      kind,
      sni,
    });
    bar(r.ok, r.msg);
    await refresh();
    if (r.ok) closeNewCard();
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
const SP_HIST = "qc-speed-history";
let spCtl = null;
let spSamples = [];
let spLast = { ping: null, jitter: null, down: null, up: null };

// The website copy of this screen has no server to hit: it sets the flag and
// the run ramps like a real one. A placeholder host means the same thing.
function spSim() {
  return window.__QVPN_SPEED_SIM__ === true || !serverHost || /example\.com$/i.test(serverHost);
}
function spBase() { return "https://" + (serverHost || "qc-speed.example.com"); }
const spSleep = (ms) => new Promise((r) => setTimeout(r, ms));
const spFmt = (v) => (v == null ? "-" : (v >= 100 ? v.toFixed(0) : v.toFixed(1)) + " Mbps");

function spPaint() {
  const el = $("sp-value");
  if (!el) return;
  const v = spSamples.length ? spSamples[spSamples.length - 1] : 0;
  el.textContent = v >= 100 ? v.toFixed(0) : v.toFixed(1);
  const bars = $("sp-bars");
  const max = Math.max(1, ...spSamples);
  bars.innerHTML = "";
  for (const s of spSamples.slice(-72)) {
    const i = document.createElement("i");
    i.style.height = Math.max(3, Math.round((s / max) * 56)) + "px";
    if (s >= max * 0.85) i.className = "hot";
    bars.append(i);
  }
}
function spPush(v) {
  spSamples.push(v);
  if (spSamples.length > 96) spSamples.shift();
  spPaint();
}
function spSet(capKey, unit) {
  $("sp-cap").textContent = t(capKey);
  if (unit) $("sp-unit").textContent = unit;
}
function paintSpeedHost() {
  const el = $("sp-host");
  if (el) el.textContent = serverHost || "";
}

async function spPing(signal) {
  const times = [];
  for (let i = 0; i < 8 && !signal.aborted; i++) {
    const t0 = performance.now();
    try {
      await fetch(spBase() + "/speed/down?bytes=1&r=" + Math.random(), { cache: "no-store", signal });
      const dt = performance.now() - t0;
      times.push(dt);
      spPush(dt);
    } catch (e) { if (signal.aborted) break; }
  }
  if (!times.length) return null;
  let diff = 0;
  for (let i = 1; i < times.length; i++) diff += Math.abs(times[i] - times[i - 1]);
  return { ping: Math.round(Math.min(...times)), jitter: times.length > 1 ? diff / (times.length - 1) : 0 };
}

async function spDownload(signal) {
  const deadline = performance.now() + 9000;
  const win = [];
  let total = 0, chunk = 1 << 20, best = 0;
  while (performance.now() < deadline && !signal.aborted) {
    const t0 = performance.now();
    let got = 0;
    try {
      const r = await fetch(spBase() + "/speed/down?bytes=" + chunk + "&r=" + Math.random(), { cache: "no-store", signal });
      got = (await r.arrayBuffer()).byteLength;
    } catch (e) {
      if (signal.aborted) break;
      throw e;
    }
    const t1 = performance.now();
    if (!got) break;
    total += got;
    win.push([t1, total]);
    while (win.length > 2 && t1 - win[0][0] > 1500) win.shift();
    const span = (t1 - win[0][0]) / 1000;
    // Cumulative bytes across the window, never the sum of the chunks: a
    // chunk was on the wire before the stamp that records it.
    const speed = span >= 0.5 ? ((total - win[0][1]) * 8) / span / 1e6 : 0;
    if (speed > best) best = speed;
    spPush(speed);
    const dt = (t1 - t0) / 1000;
    if (dt < 0.7 && chunk < 32 << 20) chunk = Math.min(chunk * 2, 32 << 20);
    else if (dt > 2.5 && chunk > 256 << 10) chunk = Math.max(chunk / 2, 256 << 10);
  }
  return best;
}

function spUploadRound(size, signal, onTick) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const body = new Uint8Array(size);
    for (let i = 0; i < size; i += 4096) body[i] = (Math.random() * 255) | 0;
    const win = [];
    xhr.upload.onprogress = (e) => {
      const now = performance.now();
      win.push([now, e.loaded]);
      while (win.length > 2 && now - win[0][0] > 1500) win.shift();
      const span = (now - win[0][0]) / 1000;
      if (span >= 0.5) onTick(((e.loaded - win[0][1]) * 8) / span / 1e6);
    };
    xhr.onload = () => resolve();
    xhr.onerror = () => reject(new Error("upload failed"));
    xhr.onabort = () => reject(new Error("aborted"));
    signal.addEventListener("abort", () => xhr.abort(), { once: true });
    xhr.open("POST", spBase() + "/speed/up?r=" + Math.random());
    xhr.setRequestHeader("Content-Type", "application/octet-stream");
    xhr.send(body);
  });
}

async function spUpload(signal) {
  const deadline = performance.now() + 9000;
  let size = 4 << 20, best = 0;
  while (performance.now() < deadline && !signal.aborted) {
    const round = performance.now();
    await spUploadRound(size, signal, (v) => {
      if (v > best) best = v;
      spPush(v);
    });
    const dt = (performance.now() - round) / 1000;
    if (dt < 1.2 && size < 64 << 20) size *= 2;
  }
  return best;
}

// Stand-in ramp for the website copy: the number climbs the way a real one
// does, so the screen reads the same without a server behind it.
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
  $("sp-count").textContent = list.length ? "(" + list.length + ")" : "";
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
    right.textContent = "↓ " + spFmt(r.down) .replace(" Mbps", "") + "  ↑ " + spFmt(r.up).replace(" Mbps", "") + " Mbps";
    row.append(left, right);
    box.append(row);
  }
}
function spStore() {
  const list = spLoad();
  list.unshift({ at: Date.now(), ping: spLast.ping, jitter: spLast.jitter, down: spLast.down, up: spLast.up, target: serverHost || "" });
  try { localStorage.setItem(SP_HIST, JSON.stringify(list.slice(0, 100))); } catch (e) {}
  spPaintHistory();
}

async function spToggle() {
  const btn = $("sp-run");
  if (spCtl) { spCtl.abort(); return; }
  spCtl = new AbortController();
  const signal = spCtl.signal;
  btn.textContent = t("spStop");
  spSamples = [];
  spLast = { ping: null, jitter: null, down: null, up: null };
  $("sp-ping").textContent = "-";
  $("sp-jit").textContent = "-";
  $("sp-down").textContent = "-";
  $("sp-up").textContent = "-";
  spPaint();
  try {
    spSet("spPinging", "ms");
    const p = spSim() ? await spSimPhase(42, 1.2, signal).then((v) => ({ ping: Math.round(v), jitter: 2.4 })) : await spPing(signal);
    if (p) {
      spLast.ping = p.ping;
      spLast.jitter = p.jitter;
      $("sp-ping").textContent = p.ping + " ms";
      $("sp-jit").textContent = p.jitter.toFixed(1) + " ms";
    }
    spSamples = [];
    spSet("spDowning", "Mbps");
    const d = spSim() ? await spSimPhase(240 + Math.random() * 40, 6, signal) : await spDownload(signal);
    if (d) { spLast.down = d; $("sp-down").textContent = spFmt(d); }
    spSamples = [];
    spSet("spUping", "Mbps");
    const u = spSim() ? await spSimPhase(34 + Math.random() * 8, 5, signal) : await spUpload(signal);
    if (u) { spLast.up = u; $("sp-up").textContent = spFmt(u); }
    spSet("spDone", "Mbps");
    if (spLast.down || spLast.up) spStore();
  } catch (e) {
    if (!signal.aborted) $("sp-hint").textContent = t("spFail");
  } finally {
    spCtl = null;
    btn.textContent = t("spStart");
    spPaint();
  }
}

$("sp-run").onclick = () => { spToggle(); };
spPaintHistory();
paintSpeedHost();

// Repaint the screen whenever its tab comes up (values may have changed while
// it was in the background).
const qcGoTab = goTab;
goTab = function (name, push) {
  qcGoTab(name, push);
  if (name === "speed") { paintSpeedHost(); spPaint(); spPaintHistory(); }
};
