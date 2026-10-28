/* Build A Trust 24 — admin console logic.
 * Gate: Firebase Auth + the master-user allowlist (TRUST_ADMIN_EMAILS).
 * The same allowlist is enforced in Firestore rules, so this UI gate is
 * convenience, not the security boundary.
 */
(function () {
  "use strict";

  var ADMIN_EMAILS = (window.TRUST_ADMIN_EMAILS || []).map(function (e) {
    return String(e).toLowerCase();
  });
  var db = null, auth = null, signupsCache = [];

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }
  function isAdmin(u) {
    return !!u && ADMIN_EMAILS.indexOf(String(u.email || "").toLowerCase()) !== -1;
  }
  function fmtDate(ts) {
    try {
      if (ts && ts.toDate) return ts.toDate().toLocaleString();
      if (ts) return new Date(ts).toLocaleString();
    } catch (e) {}
    return "—";
  }

  function showGate(html, showBtn) {
    $("gateCard").hidden = false;
    $("console").hidden = true;
    $("gateText").innerHTML = html;
    $("signInBtn").hidden = !showBtn;
  }

  function friendlyAuthError(err) {
    var code = err && err.code ? err.code : "";
    if (code === "auth/unauthorized-domain") {
      return "This domain is not in Firebase Authentication's authorized domains yet. Add buildatrust24.aliceaihub.xyz under Authentication → Settings → Authorized domains, then try again.";
    }
    if (code === "auth/operation-not-allowed") {
      return "The Google provider is not enabled yet. Turn it on under Authentication → Sign-in method → Google, then try again.";
    }
    return "Sign-in did not complete (" + (code || "unknown error") + ").";
  }

  function signIn() {
    if (!auth) return;
    var provider = new firebase.auth.GoogleAuthProvider();
    auth.signInWithPopup(provider).catch(function (err) {
      if (err && (err.code === "auth/popup-blocked" || err.code === "auth/cancelled-popup-request")) {
        auth.signInWithRedirect(provider).catch(function (e2) {
          $("gateError").textContent = friendlyAuthError(e2);
        });
      } else {
        $("gateError").textContent = friendlyAuthError(err);
      }
    });
  }

  /* ---------------- data tabs ---------------- */

  function loadSignups() {
    $("signupsMeta").textContent = "Loading…";
    db.collection("trustSignups").orderBy("createdAt", "desc").limit(300).get()
      .then(function (qs) {
        signupsCache = [];
        var rows = "";
        qs.forEach(function (d) {
          var v = d.data();
          signupsCache.push(v);
          rows += "<tr><td>" + esc(v.name) + "</td><td>" + esc(v.email) + "</td><td>" +
            esc(v.tierInterest || "free") + "</td><td>" + esc(v.source || "") + "</td><td>" +
            esc(fmtDate(v.createdAt)) + "</td></tr>";
        });
        $("signupsBody").innerHTML = rows || '<tr><td colspan="5" class="meta">No sign-ups yet.</td></tr>';
        $("signupsMeta").textContent = signupsCache.length + " sign-up(s) on file.";
      })
      .catch(function (err) {
        $("signupsMeta").innerHTML = '<span class="err">Could not read sign-ups (' +
          esc(err && err.code ? err.code : "error") +
          "). If the trust Firestore rules have not been published yet, that is the step that turns this on.</span>";
      });
  }

  function loadUsers() {
    $("usersMeta").textContent = "Loading…";
    db.collection("trustUsers").limit(200).get()
      .then(function (qs) {
        var rows = "";
        var n = 0;
        qs.forEach(function (d) {
          n++;
          var v = d.data();
          var prog = v.trainingProgress ? Object.keys(v.trainingProgress).length : 0;
          rows += "<tr><td>" + esc(v.name) + "</td><td>" + esc(v.email) + "</td><td>" +
            esc(fmtDate(v.createdAt)) + "</td><td>" + esc(fmtDate(v.lastLoginAt)) + "</td><td>" +
            prog + " item(s)</td></tr>";
        });
        $("usersBody").innerHTML = rows || '<tr><td colspan="5" class="meta">No accounts yet.</td></tr>';
        $("usersMeta").textContent = n + " account(s) on file.";
      })
      .catch(function (err) {
        $("usersMeta").innerHTML = '<span class="err">Could not read accounts (' +
          esc(err && err.code ? err.code : "error") + ").</span>";
      });
  }

  function loadRecords() {
    $("recordsMeta").textContent = "Loading…";
    db.collection("trustRecords").orderBy("createdAt", "desc").limit(100).get()
      .then(function (qs) {
        var html = "";
        var n = 0;
        qs.forEach(function (d) {
          n++;
          var v = d.data();
          var preview = "";
          try { preview = JSON.stringify(v.payload || {}).slice(0, 600); } catch (e) {}
          html += '<div class="card" style="margin:10px 0"><b>' + esc(v.label || v.kind || "record") +
            '</b> <span class="meta">' + esc(fmtDate(v.createdAt)) + " · uid " + esc(v.uid || "") +
            '</span><pre class="preview">' + esc(preview) + "</pre></div>";
        });
        $("recordsList").innerHTML = html || '<p class="meta">No records yet.</p>';
        $("recordsMeta").textContent = n + " record(s) on file.";
      })
      .catch(function (err) {
        $("recordsMeta").innerHTML = '<span class="err">Could not read records (' +
          esc(err && err.code ? err.code : "error") + ").</span>";
      });
  }

  /* ---------------- site content ---------------- */

  function loadContent() {
    db.collection("trustSiteContent").doc("main").get()
      .then(function (snap) {
        var d = snap.exists ? snap.data() : {};
        $("fHeadline").value = d.headlineHtml || "";
        $("fSubtitle").value = d.subtitle || "";
        $("fPrice").value = d.priceDisplay || "$50 credit per month";
        $("fPriceAnnual").value = d.priceAnnual || "$299/yr";
        $("fCheckoutMonthly").value = d.checkoutMonthlyUrl || "";
        $("fCheckoutAnnual").value = d.checkoutAnnualUrl || "";
        $("fCheckout").value = d.checkoutUrl || "";
        $("fSb24").value = d.sb24Url || "https://madisonshalom72.github.io/startbusiness24-site/";
        $("fBanner").value = d.bannerText || "";
        $("fBannerOn").checked = !!d.bannerOn;
      })
      .catch(function () { /* form keeps its defaults */ });
  }

  function saveContent(e) {
    e.preventDefault();
    var payload = {
      headlineHtml: $("fHeadline").value.trim(),
      subtitle: $("fSubtitle").value.trim(),
      priceDisplay: $("fPrice").value.trim() || "$50 credit per month",
      priceAnnual: $("fPriceAnnual").value.trim() || "$299/yr",
      checkoutMonthlyUrl: $("fCheckoutMonthly").value.trim(),
      checkoutAnnualUrl: $("fCheckoutAnnual").value.trim(),
      checkoutUrl: $("fCheckout").value.trim(),
      sb24Url: $("fSb24").value.trim(),
      bannerText: $("fBanner").value.trim(),
      bannerOn: $("fBannerOn").checked,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      updatedBy: auth.currentUser ? auth.currentUser.email : ""
    };
    db.collection("trustSiteContent").doc("main").set(payload, { merge: true })
      .then(function () {
        $("contentSaved").textContent = "Saved — the public page picks this up on its next visit (and live, for anyone on it now).";
      })
      .catch(function (err) {
        $("contentSaved").innerHTML = '<span class="err">Save failed (' +
          esc(err && err.code ? err.code : "error") + "). The trust rules publish is what authorizes admin writes.</span>";
      });
  }

  function downloadCsv() {
    var lines = ["name,email,tier,source,when"];
    signupsCache.forEach(function (v) {
      var cells = [v.name, v.email, v.tierInterest || "free", v.source || "", fmtDate(v.createdAt)]
        .map(function (c) { return '"' + String(c == null ? "" : c).replace(/"/g, '""') + '"'; });
      lines.push(cells.join(","));
    });
    var blob = new Blob([lines.join("\n")], { type: "text/csv" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "buildatrust24-signups.csv";
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
  }

  /* ---------------- shell ---------------- */

  function wireTabs() {
    var tabs = document.querySelectorAll(".tab");
    tabs.forEach(function (t) {
      t.addEventListener("click", function () {
        tabs.forEach(function (x) { x.setAttribute("aria-selected", "false"); });
        t.setAttribute("aria-selected", "true");
        ["signups", "users", "records", "content"].forEach(function (k) {
          $("tab-" + k).hidden = k !== t.getAttribute("data-tab");
        });
      });
    });
    $("refreshSignups").addEventListener("click", loadSignups);
    $("refreshUsers").addEventListener("click", loadUsers);
    $("refreshRecords").addEventListener("click", loadRecords);
    $("csvBtn").addEventListener("click", downloadCsv);
    $("contentForm").addEventListener("submit", saveContent);
  }

  function enterConsole(u) {
    $("gateCard").hidden = true;
    $("console").hidden = false;
    $("who").hidden = false;
    $("who").innerHTML = (u.photoURL ? '<img alt="" src="' + esc(u.photoURL) + '"/>' : "") +
      "<span>" + esc(u.email || "") + "</span>";
    $("signOutBtn").hidden = false;
    loadSignups(); loadUsers(); loadRecords(); loadContent();
  }

  function init() {
    $("signInBtn").addEventListener("click", signIn);
    $("signOutBtn").addEventListener("click", function () { if (auth) auth.signOut(); });
    wireTabs();
    if (typeof firebase === "undefined" || !window.TRUST_FIREBASE_CONFIG) {
      showGate("Accounts are unavailable — the Firebase library did not load.", false);
      return;
    }
    try {
      if (!firebase.apps || !firebase.apps.length) {
        firebase.initializeApp(window.TRUST_FIREBASE_CONFIG);
      }
      auth = firebase.auth();
      db = firebase.firestore();
    } catch (e) {
      showGate("Accounts are unavailable right now.", false);
      return;
    }
    if (auth.getRedirectResult) {
      auth.getRedirectResult().catch(function (err) {
        if (err && err.code) $("gateError").textContent = friendlyAuthError(err);
      });
    }
    auth.onAuthStateChanged(function (u) {
      if (!u) {
        $("who").hidden = true;
        $("signOutBtn").hidden = true;
        showGate("This console is for master users only. Sign in with an admin Google account.", true);
        return;
      }
      if (!isAdmin(u)) {
        $("who").hidden = true;
        $("signOutBtn").hidden = false;
        showGate("<b>" + esc(u.email || "That account") + "</b> is signed in, but it is not on the master-user list for Build A Trust 24. Sign out and use an admin account.", false);
        return;
      }
      enterConsole(u);
    });
  }

  window.TrustAdmin = { isAdmin: isAdmin, fmtDate: fmtDate };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
