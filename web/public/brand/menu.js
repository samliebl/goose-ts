(function () {
  var toggle = document.querySelector(".menu-toggle");
  if (!toggle) return;
  var header = toggle.closest("header");
  function setOpen(open) {
    header.classList.toggle("menu-open", open);
    toggle.setAttribute("aria-expanded", open ? "true" : "false");
  }
  toggle.addEventListener("click", function () {
    setOpen(!header.classList.contains("menu-open"));
  });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && header.classList.contains("menu-open")) {
      setOpen(false);
      toggle.focus();
    }
  });
  document.addEventListener("click", function (e) {
    if (!header.contains(e.target)) setOpen(false);
  });
})();
