(function () {
  var demo = document.getElementById("demo");
  var button = demo && demo.querySelector(".demo-pause");
  if (!button) return;
  button.addEventListener("click", function () {
    var paused = demo.classList.toggle("paused");
    button.setAttribute("aria-pressed", paused ? "true" : "false");
    button.textContent = paused ? "Play" : "Pause";
  });
})();
