// The visit counter: one small request per page view. No cookies, no storage,
// nothing that identifies you -- the server turns your connection into a
// one-way hash that is replaced every day (see web/analytics.ts and the
// Privacy Policy). Skipped entirely if your browser says Do Not Track or
// Global Privacy Control.
(function () {
  try {
    if (navigator.doNotTrack === "1" || navigator.globalPrivacyControl) return;
    var body = JSON.stringify({
      p: location.pathname,
      r: document.referrer,
      w: window.innerWidth,
      d: !!(window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches),
      t: "ontouchstart" in window || navigator.maxTouchPoints > 0,
    });
    if (navigator.sendBeacon) {
      navigator.sendBeacon("/api/beacon", new Blob([body], { type: "application/json" }));
    } else {
      fetch("/api/beacon", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: body,
        keepalive: true,
      });
    }
  } catch {
    /* never matters to the visitor */
  }
})();
