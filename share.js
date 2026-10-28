/* Build A Trust 24 — Trust News share buttons.
 * Plain patterns only: Facebook / X / LinkedIn are ordinary links;
 * "Copy link" uses the Clipboard API with a textarea fallback;
 * the native Share button appears only when navigator.share exists.
 * No external share widgets, no trackers. */
(function () {
  function ready(fn) {
    if (document.readyState !== "loading") fn();
    else document.addEventListener("DOMContentLoaded", fn);
  }
  ready(function () {
    var nativeBtns = document.querySelectorAll("[data-share-native]");
    for (var i = 0; i < nativeBtns.length; i++) {
      (function (btn) {
        if (navigator.share) btn.hidden = false;
        btn.addEventListener("click", function () {
          if (!navigator.share) return;
          var url = btn.getAttribute("data-share-url") || window.location.href;
          var title = btn.getAttribute("data-share-title") || document.title;
          navigator.share({ title: title, text: title, url: url }).catch(function () {});
        });
      })(nativeBtns[i]);
    }
    var copyBtns = document.querySelectorAll("[data-copy-link]");
    for (var j = 0; j < copyBtns.length; j++) {
      (function (btn) {
        btn.addEventListener("click", function () {
          var url = btn.getAttribute("data-copy-link");
          var original = btn.getAttribute("data-label") || btn.textContent;
          btn.setAttribute("data-label", original);
          function done() {
            btn.textContent = "Copied ✓";
            setTimeout(function () { btn.textContent = original; }, 2000);
          }
          function fallback() {
            var ta = document.createElement("textarea");
            ta.value = url;
            ta.style.position = "fixed";
            ta.style.opacity = "0";
            document.body.appendChild(ta);
            ta.select();
            try { document.execCommand("copy"); done(); } catch (e) {}
            document.body.removeChild(ta);
          }
          if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(url).then(done, fallback);
          } else {
            fallback();
          }
        });
      })(copyBtns[j]);
    }
  });
})();
