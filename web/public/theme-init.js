// Applied synchronously, before first paint, to avoid a flash of the wrong
// theme. A separate file (not an inline <script>) because the page's
// Content-Security-Policy only allows scripts from this origin; loaded
// without defer/async so it still blocks rendering the way the inline
// version did.
(function () {
  var stored = localStorage.getItem("goose-ts-theme");
  if (stored === "light" || stored === "dark") {
    document.documentElement.setAttribute("data-theme", stored);
  }
})();
