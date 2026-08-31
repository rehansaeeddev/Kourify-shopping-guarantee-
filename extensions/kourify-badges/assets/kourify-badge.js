(function () {
  var ICON =
    '<svg class="kourify-trust-badge__icon" width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M12 2L4 5v6c0 5.25 3.4 9.74 8 11 4.6-1.26 8-5.75 8-11V5l-8-3z" fill="#065f46"/><path d="M8.3 12.1l2.3 2.3 5-5" stroke="#fff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  function render(container, settings) {
    var placement = container.getAttribute("data-placement");
    var showForPlacement =
      placement === "cart" ? settings.showOnCart : settings.showOnProduct;

    if (!settings.badgesEnabled || !showForPlacement) {
      container.remove();
      return;
    }

    container.classList.add(
      "kourify-trust-badge--" + (settings.badgeStyle || "classic"),
    );
    container.innerHTML =
      ICON + "<span>Guaranteed Safe Checkout</span>";
  }

  function init() {
    var containers = document.querySelectorAll("[data-kourify-badge]");
    if (!containers.length) return;

    fetch("/apps/kourify/settings", { headers: { Accept: "application/json" } })
      .then(function (res) {
        return res.ok ? res.json() : { badgesEnabled: false };
      })
      .then(function (settings) {
        containers.forEach(function (container) {
          render(container, settings);
        });
      })
      .catch(function () {
        containers.forEach(function (container) {
          container.remove();
        });
      });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
