/* Build A Trust 24 — Trust News & Insights newsletter capture.
 *
 * Hooks every form.newsletter-form on the page (homepage news section,
 * news.html index, and each article page) and writes sign-ups to the SAME
 * Firestore collection the site's free sign-up uses — trustSignups — with
 * the exact field shape its validator requires:
 *   { name, email, tierInterest: "newsletter", uid, source, createdAt }
 * tierInterest is "newsletter" and source names the page the form lives on
 * (e.g. "newsletter-home", "newsletter-article-plr-202641001"), so the
 * admin console can tell newsletter readers from free builder sign-ups.
 *
 * Failure posture mirrors trust-app.js: if Firebase is unreachable or the
 * rules are not live yet, the on-page confirmation still shows and nothing
 * on the page breaks.
 */
(function () {
  "use strict";

  function ready(fn) {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", fn);
    } else {
      fn();
    }
  }

  function initFirebase() {
    try {
      if (typeof firebase === "undefined" || !window.TRUST_FIREBASE_CONFIG) return null;
      if (!firebase.apps || !firebase.apps.length) {
        firebase.initializeApp(window.TRUST_FIREBASE_CONFIG);
      }
      return firebase.firestore();
    } catch (e) {
      return null;
    }
  }

  ready(function () {
    var forms = document.querySelectorAll("form.newsletter-form");
    if (!forms.length) return;
    var db = initFirebase();
    Array.prototype.forEach.call(forms, function (form) {
      if (form._nlHooked) return;
      form._nlHooked = true;
      form.addEventListener("submit", function (ev) {
        ev.preventDefault();
        var name = (form.querySelector('[name="nlName"]') || {}).value || "";
        var email = (form.querySelector('[name="nlEmail"]') || {}).value || "";
        name = String(name).trim();
        email = String(email).trim();
        var done = form.parentNode ? form.parentNode.querySelector(".newsletter-done") : null;
        function confirm() {
          if (done) {
            done.textContent =
              "You're on the list — the next Trust News breakdown will land in your inbox. Every article stays free to read at the Trust News & Insights desk.";
            done.style.display = "block";
          }
          form.reset();
        }
        if (!name || !email) return;
        if (!db) {
          try {
            db = initFirebase();
          } catch (e) {
            db = null;
          }
        }
        if (!db) {
          confirm();
          return;
        }
        var payload = {
          name: name.slice(0, 200),
          email: email.slice(0, 160),
          tierInterest: "newsletter",
          uid: null,
          source: String(form.getAttribute("data-source") || "newsletter").slice(0, 80),
          createdAt: firebase.firestore.FieldValue.serverTimestamp()
        };
        db.collection("trustSignups").add(payload).then(confirm).catch(confirm);
      });
    });
  });
})();
