/* Build A Trust 24 — account, database, and site-config layer.
 *
 * Sits on top of the baseline page (which stays fully functional without
 * it) and adds:
 *   - Firebase init (project alice-ai-office-hub, trust collections)
 *   - Google sign-in / sign-out, profile upsert (trustUsers/{uid})
 *   - Free sign-up capture to Firestore (trustSignups)
 *   - Saved trust builds per user (trustUsers/{uid}/builds) + Load/Delete
 *   - Vault/record snapshots (trustRecords)
 *   - Training-progress sync (trustUsers/{uid}.trainingProgress)
 *   - Live site content from Firestore (trustSiteContent/main): headline,
 *     subtitle, price display, paid-tier checkout URLs (monthly/annual),
 *     StartBusiness24 link, announcement banner — editable in /admin.
 *   - Freemium gate: free browsing; a payment pop-up fires after 3
 *     minutes on site, on builder starts (AI Intake, DIY wizard, Land
 *     Trust generator), and on opening the training lessons. Bypass for
 *     master users and for profiles carrying paidAccess === true.
 *   - Admin button for master users (allowlist in trust-config.js,
 *     enforced in Firestore rules).
 *
 * Failure posture: if Firebase is unreachable or the trust rules have not
 * been published yet, every feature degrades silently and the baseline
 * page behaves exactly as the original static site.
 */
(function () {
  "use strict";

  var ADMIN_EMAILS = (window.TRUST_ADMIN_EMAILS || []).map(function (e) {
    return String(e).toLowerCase();
  });
  var DEFAULT_SB24 = "https://madisonshalom72.github.io/startbusiness24-site/";
  var state = {
    user: null,
    db: null,
    auth: null,
    paidAccess: false,
    config: {
      headlineHtml: null,
      subtitle: null,
      priceDisplay: "$50/mo",
      priceAnnual: "$299/yr",
      checkoutUrl: "",
      checkoutMonthlyUrl: "",
      checkoutAnnualUrl: "",
      sb24Url: DEFAULT_SB24,
      bannerText: "",
      bannerOn: false
    },
    builds: [],
    progress: {},
    progressTimer: null
  };

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(sel));
  }
  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }
  function isAdmin(user) {
    return !!user && ADMIN_EMAILS.indexOf(String(user.email || "").toLowerCase()) !== -1;
  }

  var toastEl = null;
  function toast(msg, ms) {
    if (!toastEl) {
      toastEl = document.getElementById("trustToast");
      if (!toastEl) {
        toastEl = document.createElement("div");
        toastEl.id = "trustToast";
        document.body.appendChild(toastEl);
      }
    }
    toastEl.textContent = msg;
    toastEl.style.display = "block";
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { toastEl.style.display = "none"; }, ms || 4200);
  }

  /* ---------------- site content (Firestore -> page) ---------------- */

  function applyConfig(cfg) {
    if (cfg.headlineHtml) {
      var h = $("#cfgHeadline");
      if (h) h.innerHTML = cfg.headlineHtml;
    }
    if (cfg.subtitle) {
      var s = $("#cfgSubtitle");
      if (s) s.textContent = cfg.subtitle;
    }
    if (cfg.priceDisplay) {
      var amt = $("#cfgPriceAmt");
      if (amt) amt.textContent = cfg.priceDisplay;
      var h2 = $("#signup .sec-head h2");
      if (h2 && h2.textContent.indexOf("$50/mo") !== -1) {
        h2.textContent = h2.textContent.replace("$50/mo", cfg.priceDisplay);
      }
      var sub = $("#signup .sec-sub");
      if (sub && sub.innerHTML.indexOf("$50/mo") !== -1) {
        sub.innerHTML = sub.innerHTML.split("$50/mo").join(esc(cfg.priceDisplay));
      }
      var btn = $("#cfgCheckoutBtn");
      if (btn) btn.innerHTML = "Get Full Access &mdash; " + esc(cfg.priceDisplay);
    }
    if (cfg.priceAnnual) {
      var ann = $("#cfgPriceAnnual");
      if (ann && ann.textContent.indexOf("$299/yr") !== -1) {
        ann.textContent = ann.textContent.replace("$299/yr", cfg.priceAnnual);
      }
      var subA = $("#signup .sec-sub");
      if (subA && subA.innerHTML.indexOf("$299/yr") !== -1) {
        subA.innerHTML = subA.innerHTML.split("$299/yr").join(esc(cfg.priceAnnual));
      }
    }
    if (cfg.sb24Url) {
      $$('a[href*="startbusiness24-site"]').forEach(function (a) {
        a.setAttribute("href", cfg.sb24Url);
      });
    }
    var banner = $("#trustBanner");
    if (banner) {
      if (cfg.bannerOn && cfg.bannerText) {
        banner.textContent = cfg.bannerText;
        banner.style.display = "block";
      } else {
        banner.style.display = "none";
      }
    }
    var pill = $("#taGatePill");
    if (pill) pill.textContent = "Get Full Access \u2014 " + cfg.priceDisplay;
    wireCheckout();
    refreshGateLabels();
  }

  function wireCheckout() {
    var btn = $("#cfgCheckoutBtn");
    if (!btn || btn._taWired) return;
    btn._taWired = true;
    btn.addEventListener("click", function (e) {
      if (state.config.checkoutUrl) {
        e.preventDefault();
        e.stopImmediatePropagation();
        window.open(state.config.checkoutUrl, "_blank", "noopener");
      }
    }, true);
  }

  function loadSiteConfig() {
    if (!state.db) { applyConfig(state.config); return; }
    state.db.collection("trustSiteContent").doc("main")
      .onSnapshot(function (snap) {
        if (snap.exists) {
          var d = snap.data() || {};
          ["headlineHtml", "subtitle", "priceDisplay", "priceAnnual", "checkoutUrl", "checkoutMonthlyUrl", "checkoutAnnualUrl", "sb24Url", "bannerText"].forEach(function (k) {
            if (typeof d[k] === "string" && d[k] !== "") state.config[k] = d[k];
          });
          if (typeof d.bannerOn === "boolean") state.config.bannerOn = d.bannerOn;
        }
        applyConfig(state.config);
      }, function () { applyConfig(state.config); });
  }

  /* ---------------- account bar / panels ---------------- */

  function buildChrome() {
    var bar = document.createElement("div");
    bar.id = "trustAcctBar";
    bar.innerHTML =
      '<span class="ta-brand">Build A Trust 24</span>' +
      '<button class="ta-btn primary" id="taGatePill" type="button" hidden>Get Full Access \u2014 $50/mo</button>' +
      '<span class="ta-user" id="taUser" hidden></span>' +
      '<button class="ta-btn" id="taMyTrusts" type="button" hidden>My Trusts</button>' +
      '<button class="ta-btn" id="taAdmin" type="button" hidden>Admin</button>' +
      '<button class="ta-btn primary" id="taSignIn" type="button">Sign in with Google</button>' +
      '<button class="ta-btn" id="taSignOut" type="button" hidden>Sign out</button>';
    var banner = document.createElement("div");
    banner.id = "trustBanner";
    document.body.insertBefore(bar, document.body.firstChild);
    bar.parentNode.insertBefore(banner, bar.nextSibling);

    $("#taSignIn").addEventListener("click", signIn);
    $("#taGatePill").hidden = true;
    $("#taGatePill").addEventListener("click", function () { showGate("pill"); });
    $("#taSignOut").addEventListener("click", function () {
      if (state.auth) state.auth.signOut();
    });
    $("#taAdmin").addEventListener("click", function () {
      window.location.href = "/admin";
    });
    $("#taMyTrusts").addEventListener("click", function () {
      var p = $("#myTrustsPanel");
      if (p) {
        p.classList.toggle("open");
        if (p.classList.contains("open")) renderBuilds();
      }
    });
    buildPanel();
    injectSaveButton();
  }

  function buildPanel() {
    var signup = $("#signup");
    if (!signup || $("#myTrustsPanel")) return;
    var panel = document.createElement("section");
    panel.id = "myTrustsPanel";
    panel.setAttribute("aria-label", "My saved trusts");
    panel.innerHTML =
      "<h3>My Trusts</h3>" +
      '<p class="ta-meta">Builds you save are stored on your account and follow you across devices. ' +
      "Generate a trust in the builder, then use <b>Save to My Account</b> next to the document buttons.</p>" +
      '<div id="taBuildList"><p class="ta-meta">No saved builds yet.</p></div>' +
      '<div style="margin-top:14px;display:flex;gap:10px;flex-wrap:wrap">' +
      '<button class="ta-btn" id="taSnapshot" type="button">Save a Vault / CRM snapshot</button>' +
      "</div>" +
      '<p class="ta-meta" id="taSnapNote"></p>';
    signup.parentNode.insertBefore(panel, signup);
    $("#taSnapshot").addEventListener("click", saveSnapshot);
  }

  function injectSaveButton() {
    var gen = $("#genDoc");
    if (!gen || $("#taSaveBuild")) return;
    var b = document.createElement("button");
    b.type = "button";
    b.id = "taSaveBuild";
    b.className = gen.className || "btn";
    b.style.marginLeft = "10px";
    b.textContent = "Save to My Account";
    gen.parentNode.insertBefore(b, gen.nextSibling);
    b.addEventListener("click", saveBuild);
  }

  function renderAuthUI() {
    var u = state.user;
    var signIn = $("#taSignIn"), signOut = $("#taSignOut"),
        admin = $("#taAdmin"), mine = $("#taMyTrusts"), chip = $("#taUser");
    if (!signIn) return;
    if (u) {
      signIn.hidden = true;
      signOut.hidden = false;
      mine.hidden = false;
      admin.hidden = !isAdmin(u);
      chip.hidden = false;
      chip.innerHTML = (u.photoURL ? '<img alt="" src="' + esc(u.photoURL) + '"/>' : "") +
        "<span>" + esc(u.displayName || u.email || "Signed in") + "</span>";
    } else {
      signIn.hidden = false;
      signOut.hidden = true;
      mine.hidden = true;
      admin.hidden = true;
      chip.hidden = true;
      chip.innerHTML = "";
      var p = $("#myTrustsPanel");
      if (p) p.classList.remove("open");
    }
  }

  /* ---------------- auth ---------------- */

  function friendlyAuthError(err) {
    var code = err && err.code ? err.code : "";
    if (code === "auth/unauthorized-domain") {
      return "Sign-in is not switched on for this web address yet. The site owner needs to add this domain in Firebase Authentication settings (one step) — everything else on the page works without signing in.";
    }
    if (code === "auth/operation-not-allowed") {
      return "Google sign-in is not switched on yet. The site owner needs to enable the Google provider in Firebase Authentication (one step) — everything else on the page works without signing in.";
    }
    if (code === "auth/popup-closed-by-user") return "Sign-in window closed — nothing was changed.";
    return "Sign-in did not complete (" + (code || "unknown error") + "). Please try again.";
  }

  function signIn() {
    if (!state.auth) {
      toast("Accounts are unavailable right now — the rest of the site works as normal.");
      return;
    }
    var provider = new firebase.auth.GoogleAuthProvider();
    state.auth.signInWithPopup(provider).catch(function (err) {
      if (err && (err.code === "auth/popup-blocked" || err.code === "auth/cancelled-popup-request")) {
        state.auth.signInWithRedirect(provider).catch(function (e2) {
          toast(friendlyAuthError(e2), 7000);
        });
      } else {
        toast(friendlyAuthError(err), 7000);
      }
    });
  }

  function upsertProfile(u) {
    if (!state.db || !u) return;
    var ref = state.db.collection("trustUsers").doc(u.uid);
    var payload = {
      name: u.displayName || "",
      email: u.email || "",
      photoURL: u.photoURL || "",
      lastLoginAt: firebase.firestore.FieldValue.serverTimestamp()
    };
    ref.get().then(function (snap) {
      if (!snap.exists) {
        payload.createdAt = firebase.firestore.FieldValue.serverTimestamp();
      }
      return ref.set(payload, { merge: true });
    }).catch(function () { /* profile write is best-effort until rules publish */ });
  }

  /* ---------------- sign-up capture ---------------- */

  function hookSignupForm() {
    var form = $("#signupForm");
    if (!form || form._taHooked) return;
    form._taHooked = true;
    form.addEventListener("submit", function () {
      var name = ($("#suName") || {}).value || "";
      var email = ($("#suEmail") || {}).value || "";
      name = String(name).trim(); email = String(email).trim();
      /* Private registry: a free signup puts the member on the
       * registry (idempotent — the page module owns dedupe). */
      if (window.Registry) {
        try { Registry.memberUpsert({ name: name, email: email, source: "free-signup" }); } catch (e) {}
      }
      if (!name || !email || !state.db) return;
      var payload = {
        name: name.slice(0, 200),
        email: email.slice(0, 160),
        tierInterest: "free",
        uid: state.user ? state.user.uid : null,
        source: "homepage",
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      };
      state.db.collection("trustSignups").add(payload).catch(function () {
        /* capture goes live when the trust rules are published; the
           on-page sign-up confirmation is unaffected either way. */
      });
    });
  }

  /* ---------------- private registry (Firestore sync) ----------------
   * The page owns the registry UI + local mirrors (window.Registry).
   * Here it is persisted to the member's own profile doc —
   * trustUsers/{uid}.registry — which the live rules already allow
   * the owner to write (paidAccess is never touched; merge writes
   * leave it unchanged). No other collection is used: the rules name
   * no registry subcollection, so the profile field is the permitted
   * home. Best-effort: local mirrors keep it working if a write is
   * ever refused. */
  function syncRegistryToFirestore() {
    if (!state.user || !state.db || !window.Registry) return;
    var data;
    try { data = Registry.getData(); } catch (e) { return; }
    state.db.collection("trustUsers").doc(state.user.uid)
      .set({ registry: data }, { merge: true })
      .catch(function () { /* local mirror still holds it */ });
  }
  function loadRegistry() {
    if (!state.user || !state.db || !window.Registry) return;
    state.db.collection("trustUsers").doc(state.user.uid).get()
      .then(function (snap) {
        var d = snap.exists ? snap.data() : null;
        if (d && d.registry) {
          try { Registry.hydrateRemote(d.registry); } catch (e) {}
        }
        syncRegistryToFirestore();
      })
      .catch(function () { syncRegistryToFirestore(); });
  }

  /* ---------------- saved builds & snapshots ---------------- */

  function saveBuild() {
    if (!state.user) { toast("Sign in with Google first — then your build saves to your account."); signIn(); return; }
    if (!state.db) { toast("Accounts are unavailable right now."); return; }
    var docOut = $("#docOut");
    var text = docOut ? (docOut.innerText || docOut.textContent || "") : "";
    var trustName = (($("#fTrustName") || {}).value || "").trim();
    var name = trustName || "Untitled trust build";
    if (!text.trim()) {
      toast("Generate your trust document first (the Generate button above), then save it here.");
      return;
    }
    var payload = {
      name: name.slice(0, 200),
      grantor: (($("#fGrantor") || {}).value || "").slice(0, 200),
      state: (($("#fState") || {}).value || "").slice(0, 40),
      docText: text.slice(0, 60000),
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    };
    state.db.collection("trustUsers").doc(state.user.uid).collection("builds").add(payload)
      .then(function () {
        toast("Saved to your account — find it under My Trusts.");
        loadBuilds();
        var p = $("#myTrustsPanel"); if (p) p.classList.add("open");
      })
      .catch(function () { toast("That save did not go through. Please try again in a moment."); });
  }

  function loadBuilds() {
    if (!state.user || !state.db) { state.builds = []; renderBuilds(); return; }
    state.db.collection("trustUsers").doc(state.user.uid).collection("builds")
      .orderBy("createdAt", "desc").limit(50).get()
      .then(function (qs) {
        state.builds = [];
        qs.forEach(function (d) { state.builds.push({ id: d.id, data: d.data() }); });
        renderBuilds();
      })
      .catch(function () { renderBuilds(); });
  }

  function renderBuilds() {
    var list = $("#taBuildList");
    if (!list) return;
    if (!state.user) { list.innerHTML = '<p class="ta-meta">Sign in to see your saved builds.</p>'; return; }
    if (!state.builds.length) { list.innerHTML = '<p class="ta-meta">No saved builds yet.</p>'; return; }
    list.innerHTML = "";
    state.builds.forEach(function (b) {
      var row = document.createElement("div");
      row.className = "ta-row";
      var when = "";
      try { if (b.data.createdAt && b.data.createdAt.toDate) when = b.data.createdAt.toDate().toLocaleDateString(); } catch (e) {}
      row.innerHTML = '<div class="ta-grow"><b>' + esc(b.data.name || "Untitled trust build") + "</b>" +
        '<div class="ta-meta">' + esc(b.data.grantor || "") + (when ? " · " + esc(when) : "") + "</div></div>";
      var load = document.createElement("button");
      load.className = "ta-btn"; load.type = "button"; load.textContent = "Open";
      load.addEventListener("click", function () { openBuild(b); });
      var del = document.createElement("button");
      del.className = "ta-btn"; del.type = "button"; del.textContent = "Delete";
      del.addEventListener("click", function () { deleteBuild(b.id); });
      row.appendChild(load); row.appendChild(del);
      list.appendChild(row);
    });
  }

  function openBuild(b) {
    var docOut = $("#docOut");
    if (docOut) {
      docOut.innerHTML = "";
      var pre = document.createElement("pre");
      pre.style.whiteSpace = "pre-wrap";
      pre.style.fontFamily = "Georgia, serif";
      pre.textContent = b.data.docText || "";
      docOut.appendChild(pre);
      docOut.scrollIntoView({ behavior: "smooth", block: "start" });
      toast("Build loaded into the document area below the builder.");
    }
  }

  function deleteBuild(id) {
    if (!state.user || !state.db) return;
    state.db.collection("trustUsers").doc(state.user.uid).collection("builds").doc(id).delete()
      .then(function () { toast("Build deleted."); loadBuilds(); })
      .catch(function () { toast("Delete did not go through. Please try again."); });
  }

  function saveSnapshot() {
    if (!state.user) { toast("Sign in with Google first — snapshots save to your account."); signIn(); return; }
    if (!state.db) { toast("Accounts are unavailable right now."); return; }
    var vaultBody = $("#vaultBody");
    var vaultText = vaultBody ? (vaultBody.innerText || vaultBody.textContent || "").slice(0, 20000) : "";
    var docOut = $("#docOut");
    var docText = docOut ? (docOut.innerText || docOut.textContent || "").slice(0, 40000) : "";
    var payload = {
      uid: state.user.uid,
      kind: "snapshot",
      label: "Vault / CRM snapshot",
      payload: { vaultText: vaultText, docText: docText },
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    };
    state.db.collection("trustRecords").add(payload)
      .then(function () {
        var n = $("#taSnapNote");
        if (n) n.textContent = "Snapshot saved to your account (" + new Date().toLocaleString() + ").";
      })
      .catch(function () { toast("That snapshot did not save. Please try again in a moment."); });
  }

  /* ---------------- freemium gate (payment pop-up) ----------------
   * Madison's model: browsing is free. The pop-up fires when a visitor
   * (a) has been on the site 3 minutes (once per session), (b) tries to
   * start the Trust Builder (AI Intake, the DIY wizard, or the Land
   * Trust Units Generator), or (c) opens the training lessons. Builder
   * and lessons stay locked for non-paying visitors — closing the
   * pop-up returns them to browsing, and a "Get Full Access" pill stays
   * in the account bar so they can reopen it. Bypass: master users
   * (allowlist) and signed-in users whose trustUsers profile carries
   * paidAccess === true (a field only master users can write — see
   * firestore.rules). Checkout URLs come from trustSiteContent
   * (checkoutMonthlyUrl / checkoutAnnualUrl, falling back to the single
   * checkoutUrl); while unset, the plan buttons run the honest
   * placeholder: scroll to the free sign-up and say so. No fake checkout.
   */
  var GATE_DELAY_MS = 180000; /* 3 minutes */
  var GATE_CHECKOUT_SOON = "Checkout opens at launch \u2014 sign up free now and we\u2019ll email your access link.";
  var gate = {
    built: false,
    modal: null,
    open: false,
    reason: null,
    timerId: null,
    timerArmed: false,
    timerShown: false
  };

  function hasAccess() {
    return isAdmin(state.user) || state.paidAccess === true;
  }

  function gateSessionStore() {
    try { return window.sessionStorage || null; } catch (e) { return null; }
  }

  function matchesSel(el, sel) {
    if (!el || !el.tagName) return false;
    if (sel.charAt(0) === "#") return el.id === sel.slice(1);
    if (sel.charAt(0) === ".") {
      return !!(el.classList && el.classList.contains(sel.slice(1)));
    }
    return String(el.tagName).toUpperCase() === sel.toUpperCase();
  }
  function withinEl(el, sel) {
    for (var n = el; n; n = n.parentNode) {
      if (matchesSel(n, sel)) return true;
    }
    return false;
  }
  function closestDataGoto(el) {
    for (var n = el; n; n = n.parentNode) {
      var v = null;
      if (n.getAttribute) v = n.getAttribute("data-goto");
      if (!v && n.dataset && n.dataset.goto) v = n.dataset.goto;
      if (v) return v;
    }
    return null;
  }

  var GATE_BUILDER_IDS = {
    startIntake: 1, ltGenerate: 1, ltSplitBtn: 1,
    ltPrintSchedule: 1, ltPrintCerts: 1, ltSaveRecord: 1
  };
  function gateTriggerForEvent(ev) {
    var t = ev && ev.target;
    if (!t) return null;
    if (withinEl(t, "#trustGateModal")) return null;
    if (t.id && GATE_BUILDER_IDS[t.id]) return "builder";
    if (withinEl(t, "#wizardTop")) return "builder";
    if (closestDataGoto(t) === "#wizardTop") return "builder";
    if (withinEl(t, "#training") &&
        (matchesSel(t, "button") || withinEl(t, "button") || matchesSel(t, "input"))) {
      return "lessons";
    }
    return null;
  }

  function planUrl(kind) {
    var cfg = state.config;
    if (kind === "monthly") return cfg.checkoutMonthlyUrl || cfg.checkoutUrl || "";
    return cfg.checkoutAnnualUrl || cfg.checkoutUrl || "";
  }
  function planLabel(kind) {
    var cfg = state.config;
    var price = kind === "monthly" ? cfg.priceDisplay : cfg.priceAnnual;
    return (planUrl(kind) ? "Get Full Access \u2014 " : "Full Access \u2014 ") + price;
  }
  function refreshGateLabels() {
    var m = $("#tgPlanMonthly"), a = $("#tgPlanAnnual");
    if (m) m.innerHTML = "<b>" + esc(planLabel("monthly")) + "</b>Full access, billed monthly. Cancel anytime.";
    if (a) a.innerHTML = "<b>" + esc(planLabel("annual")) + "</b>The whole year of full access \u2014 the best value on the page.";
    var pillPrice = $("#taGatePill");
    if (pillPrice) pillPrice.textContent = "Get Full Access \u2014 " + state.config.priceDisplay;
  }

  function buildGate() {
    if (gate.built) return;
    var modal = document.getElementById("trustGateModal");
    if (!modal) {
      modal = document.createElement("div");
      modal.id = "trustGateModal";
      document.body.appendChild(modal);
    }
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");
    modal.setAttribute("aria-label", "Get full access");
    modal.innerHTML =
      '<div class="tg-card">' +
      '<button class="tg-close" id="tgClose" type="button" aria-label="Close">&times;</button>' +
      '<p class="tg-kicker">Build A Trust 24 \u2014 Full Access</p>' +
      '<h3 class="tg-title">Unlock the Builder, the Lessons &amp; the Vault</h3>' +
      '<p class="tg-sub" id="tgReason">Looking around is free \u2014 that is how this site works. Building your trust and the full training tracks are Full Access.</p>' +
      '<ul class="tg-list">' +
      "<li>The full Trust Builder \u2014 AI Intake Flow and the Build It Myself wizard</li>" +
      "<li>All training tracks &amp; lessons, including Real Estate &amp; Land Trusts</li>" +
      "<li>The Land Trust Units Distribution Generator, schedules &amp; certificates</li>" +
      "<li>Trust Indenture Agreement generator, bond-paper certificates &amp; units ledger</li>" +
      "<li>Trust Fund Vault, Trust Fund CRM &amp; the Grantor Portal</li>" +
      "</ul>" +
      '<div class="tg-signin" id="tgSigninRow"><button class="ta-btn primary" id="tgSignIn" type="button">Sign in with Google</button><span>Sign-in alone does not unlock \u2014 paid access does. Already paid? Sign in and this device unlocks.</span></div>' +
      '<div class="tg-plans">' +
      '<button class="tg-plan primary" id="tgPlanMonthly" type="button"></button>' +
      '<button class="tg-plan" id="tgPlanAnnual" type="button"></button>' +
      "</div>" +
      '<p class="tg-note" id="tgNote" hidden></p>' +
      '<button class="tg-keep" id="tgKeep" type="button">Keep looking around</button>' +
      "</div>";
    modal.hidden = true;
    gate.modal = modal;
    gate.built = true;
    $("#tgClose").addEventListener("click", closeGate);
    $("#tgKeep").addEventListener("click", closeGate);
    $("#tgSignIn").addEventListener("click", function () { closeGate(); signIn(); });
    $("#tgPlanMonthly").addEventListener("click", function () { choosePlan("monthly"); });
    $("#tgPlanAnnual").addEventListener("click", function () { choosePlan("annual"); });
    refreshGateLabels();
  }

  var GATE_REASONS = {
    timer: "You have had a good look around \u2014 that part is free, and it stays free. When you are ready to build your trust and open the full training tracks, this is the door.",
    builder: "Building is a Full Access feature. Look around all you like \u2014 the moment you start building, Full Access takes it from there.",
    lessons: "The training lessons are Full Access. The library and this page stay free to read \u2014 the tracks open with Full Access.",
    pill: "Full Access unlocks the builder, all the lessons, and the records tools. Pick a plan and you are in."
  };

  function showGate(reason) {
    if (hasAccess()) return false;
    buildGate();
    gate.reason = reason || "timer";
    var r = $("#tgReason");
    if (r) r.textContent = GATE_REASONS[gate.reason] || GATE_REASONS.timer;
    var row = $("#tgSigninRow");
    if (row) row.style.display = state.user ? "none" : "flex";
    var note = $("#tgNote");
    if (note) note.hidden = true;
    refreshGateLabels();
    gate.modal.hidden = false;
    gate.open = true;
    try { document.body.style.overflow = "hidden"; } catch (e) {}
    return true;
  }

  function closeGate() {
    if (!gate.modal) return;
    gate.modal.hidden = true;
    gate.open = false;
    try { document.body.style.overflow = ""; } catch (e) {}
    var pill = $("#taGatePill");
    if (pill && !hasAccess()) pill.hidden = false;
  }

  function choosePlan(kind) {
    var url = planUrl(kind);
    if (url) {
      window.open(url, "_blank", "noopener");
      return;
    }
    /* Honest placeholder: no checkout exists yet. */
    var note = $("#tgNote");
    if (note) { note.textContent = GATE_CHECKOUT_SOON; note.hidden = false; }
    closeGate();
    var signup = $("#signup");
    if (signup && signup.scrollIntoView) signup.scrollIntoView({ behavior: "smooth", block: "start" });
    var name = $("#suName");
    if (name && name.focus) name.focus();
    toast(GATE_CHECKOUT_SOON, 8000);
  }

  function handleGateTrigger(kind) {
    if (hasAccess()) return false;
    return showGate(kind);
  }

  function onGateClick(ev) {
    if (hasAccess()) return;
    var kind = gateTriggerForEvent(ev);
    if (!kind) return;
    if (ev.preventDefault) ev.preventDefault();
    if (ev.stopPropagation) ev.stopPropagation();
    if (ev.stopImmediatePropagation) ev.stopImmediatePropagation();
    showGate(kind);
  }

  function fireGateTimer() {
    gate.timerId = null;
    if (gate.timerShown || hasAccess() || gate.open) return;
    gate.timerShown = true;
    var ss = gateSessionStore();
    if (ss) { try { ss.setItem("taGateTimerShown", "1"); } catch (e) {} }
    showGate("timer");
  }

  function armGateTimer() {
    var ss = gateSessionStore();
    if (ss) {
      try { if (ss.getItem("taGateTimerShown")) gate.timerShown = true; } catch (e) {}
    }
    if (gate.timerShown || gate.timerArmed) return;
    gate.timerArmed = true;
    gate.timerId = setTimeout(fireGateTimer, GATE_DELAY_MS);
  }

  function onAccessChange() {
    try { if (window.Badges && Badges.refresh) Badges.refresh(); } catch (e) {}
    if (!hasAccess()) return;
    if (gate.timerId) { clearTimeout(gate.timerId); gate.timerId = null; }
    if (gate.open) closeGate();
    var pill = $("#taGatePill");
    if (pill) pill.hidden = true;
  }

  /* Land Trust generator: save the generated schedule into the signed-in
   * user's trustRecords, same shape as vault snapshots. */
  function hookLandTrustSave() {
    var btn = $("#ltSaveRecord");
    if (!btn || btn._taHooked) return;
    btn._taHooked = true;
    btn.addEventListener("click", function () {
      if (!state.user) { toast("Sign in with Google first \u2014 records save to your account."); signIn(); return; }
      if (!state.db) { toast("Accounts are unavailable right now."); return; }
      var api = window.LandTrustGen;
      var res = api && api.last ? api.last() : null;
      if (!res || !res.ok) {
        toast("Generate the Land Trust schedule first \u2014 then save it to your records.");
        return;
      }
      var payload = {
        uid: state.user.uid,
        kind: "land-trust-distribution",
        label: ("Land Trust Units Distribution \u2014 " + (res.trustName || "Land Trust")).slice(0, 200),
        payload: {
          trustName: res.trustName || "",
          property: res.property || "",
          trusteeLine: res.trusteeLine || "",
          totalUnits: res.totalUnits,
          beneficiaries: res.rows.map(function (r) {
            return { name: r.name, units: r.units, pct: r.pct };
          }),
          scheduleText: ($("#ltScheduleOut") || {}).innerText || ""
        },
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      };
      payload.payload.scheduleText = String(payload.payload.scheduleText).slice(0, 20000);
      state.db.collection("trustRecords").add(payload)
        .then(function () { toast("Saved to your records \u2014 master users can see it in /admin under Records."); })
        .catch(function () { toast("That save did not go through. Please try again in a moment."); });
    });
  }

  /* ---------------- training progress ---------------- */

  function trainingBoxes() {
    return $$('#training input[type="checkbox"]');
  }
  function boxKey(box, idx) {
    var lab = box.closest ? box.closest("label") : null;
    var text = lab ? (lab.textContent || "") : (box.getAttribute("data-key") || "");
    text = String(text).replace(/\s+/g, " ").trim().slice(0, 80);
    return text || ("box-" + idx);
  }
  function hookTraining() {
    var wrap = $("#training");
    if (!wrap || wrap._taHooked) return;
    wrap._taHooked = true;
    wrap.addEventListener("change", function (e) {
      if (!e.target || e.target.type !== "checkbox") return;
      var boxes = trainingBoxes();
      boxes.forEach(function (b, i) { state.progress[boxKey(b, i)] = !!b.checked; });
      clearTimeout(state.progressTimer);
      state.progressTimer = setTimeout(saveProgress, 600);
    });
  }
  function saveProgress() {
    if (!state.user || !state.db) return;
    state.db.collection("trustUsers").doc(state.user.uid)
      .set({ trainingProgress: state.progress }, { merge: true })
      .catch(function () { /* best-effort sync */ });
  }
  function loadProgress() {
    if (!state.user || !state.db) return;
    state.db.collection("trustUsers").doc(state.user.uid).get()
      .then(function (snap) {
        var d = snap.exists ? snap.data() : null;
        /* paidAccess is set on the profile doc by a master user only —
           Firestore rules block owners from writing that field. */
        state.paidAccess = !!(d && d.paidAccess === true);
        onAccessChange();
        if (d && d.trainingProgress) {
          state.progress = d.trainingProgress || {};
          var boxes = trainingBoxes();
          boxes.forEach(function (b, i) {
            var k = boxKey(b, i);
            if (k in state.progress) b.checked = !!state.progress[k];
          });
        }
        try { if (window.Badges && Badges.refresh) Badges.refresh(); } catch (e) {}
      })
      .catch(function () {
        try { if (window.Badges && Badges.refresh) Badges.refresh(); } catch (e) {}
      });
  }

  /* ---------------- init ---------------- */

  function init() {
    buildChrome();
    buildGate();
    hookSignupForm();
    hookTraining();
    hookLandTrustSave();
    wireCheckout();
    applyConfig(state.config);
    document.addEventListener("click", onGateClick, true);
    try { if (window.Badges && Badges.refresh) Badges.refresh(); } catch (e) {}
    armGateTimer();
    if (typeof firebase === "undefined" || !window.TRUST_FIREBASE_CONFIG) {
      renderAuthUI();
      return;
    }
    try {
      if (!firebase.apps || !firebase.apps.length) {
        firebase.initializeApp(window.TRUST_FIREBASE_CONFIG);
      }
      state.auth = firebase.auth();
      state.db = firebase.firestore();
    } catch (e) {
      renderAuthUI();
      return;
    }
    loadSiteConfig();
    if (state.auth.getRedirectResult) {
      state.auth.getRedirectResult().catch(function (err) {
        if (err && err.code) toast(friendlyAuthError(err), 7000);
      });
    }
    state.auth.onAuthStateChanged(function (u) {
      state.user = u || null;
      renderAuthUI();
      if (u) {
        upsertProfile(u);
        /* Private registry: signing in puts the member on the
         * registry (idempotent), then load + keep it synced. */
        if (window.Registry) {
          try {
            Registry.onSync(syncRegistryToFirestore);
            Registry.attachUser({ uid: u.uid, name: u.displayName || "", email: u.email || "" });
          } catch (e) {}
        }
        loadRegistry();
        loadBuilds();
        loadProgress();
        hookSignupForm();
        onAccessChange();
      } else {
        state.paidAccess = false;
        state.builds = [];
        renderBuilds();
        if (window.Registry) { try { Registry.attachUser(null); } catch (e) {} }
      }
    });
    renderAuthUI();
  }

  window.TrustApp = {
    state: state,
    applyConfig: applyConfig,
    isAdmin: isAdmin,
    friendlyAuthError: friendlyAuthError,
    gate: {
      show: showGate,
      close: closeGate,
      isOpen: function () { return gate.open; },
      hasAccess: hasAccess,
      handleTrigger: handleGateTrigger,
      triggerForEvent: gateTriggerForEvent,
      fireTimer: fireGateTimer,
      choosePlan: choosePlan,
      state: gate,
      delayMs: GATE_DELAY_MS
    }
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
