(function () {
  var SHIELD_ICON_SVG =
    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M12 2L4 5v6c0 5.25 3.4 9.74 8 11 4.6-1.26 8-5.75 8-11V5l-8-3z" fill="#065f46"/><path d="M8.3 12.1l2.3 2.3 5-5" stroke="#fff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  function el(tag, className, html) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (html !== undefined) node.innerHTML = html;
    return node;
  }

  function modalHeaderHtml(title, subtitle) {
    return (
      '<div class="kourify-modal__header">' +
      '<div class="kourify-modal__header-icon">' +
      SHIELD_ICON_SVG +
      "</div>" +
      '<span class="kourify-modal__brand">Kourify</span>' +
      "</div>" +
      '<p class="kourify-modal__title">' +
      title +
      "</p>" +
      (subtitle ? '<p class="kourify-modal__subtitle">' + subtitle + "</p>" : "")
    );
  }

  function buildLearnMoreModal() {
    var overlay = el("div", "kourify-modal-overlay");
    overlay.hidden = true;
    overlay.innerHTML =
      '<div class="kourify-modal" role="dialog" aria-modal="true">' +
      '<button type="button" class="kourify-modal__close" data-kourify-close aria-label="Close">✕</button>' +
      modalHeaderHtml("Kourify Shopping Guarantee") +
      '<div class="kourify-modal__body">' +
      "<p>Add protection at checkout and if your package is lost, damaged, or stolen in transit, submit a claim and our team will review it and follow up by email.</p>" +
      "<p>Protection is optional, covers the order total up to the coverage cap shown at checkout, and is managed directly by Kourify — not the store.</p>" +
      "</div>" +
      '<div class="kourify-modal__actions">' +
      '<button type="button" class="kourify-btn kourify-btn--primary" data-kourify-file-claim>Already protected? File a claim</button>' +
      "</div></div>";
    document.body.appendChild(overlay);
    return overlay;
  }

  function openModal(overlay) {
    overlay.hidden = false;
  }

  function closeModal(overlay) {
    if (!overlay) return;
    overlay.hidden = true;
  }

  function closeAllModals() {
    document.querySelectorAll(".kourify-modal-overlay").forEach(function (overlay) {
      closeModal(overlay);
    });
  }

  function ensureGuaranteeTab() {
    if (document.querySelector("[data-kourify-guarantee-tab]")) return;

    var tab = document.createElement("div");
    tab.className = "kourify-guarantee-tab";
    tab.setAttribute("data-kourify-guarantee-tab", "true");
    tab.innerHTML =
      '<button type="button" class="kourify-guarantee-tab__button" data-kourify-learn-more>' +
      '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M12 2L4 5v6c0 5.25 3.4 9.74 8 11 4.6-1.26 8-5.75 8-11V5l-8-3z" fill="currentColor"/><path d="M8.3 12.1l2.3 2.3 5-5" stroke="#065f46" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>' +
      '<span>Kourify<br>Shopping<br>Guarantee</span>' +
      "</button>";

    document.body.appendChild(tab);
    return tab;
  }

  function computeFeeCents(settings, basisCents) {
    if (settings.protectionFeeType === "percentage") {
      var raw = Math.round((basisCents * (settings.protectionPercentBasisPoints || 0)) / 10000);
      var min = settings.protectionMinFeeCents || 0;
      var max = settings.protectionMaxFeeCents || min;
      return Math.min(Math.max(raw, min), max);
    }
    return settings.protectionFlatFeeCents || 0;
  }

  function formatMoney(cents, currency) {
    try {
      return new Intl.NumberFormat(undefined, {
        style: "currency",
        currency: currency || "USD",
      }).format(cents / 100);
    } catch (e) {
      return "$" + (cents / 100).toFixed(2);
    }
  }

  function applyPayerState(settings) {
    var merchantPays = settings.protectionPayer === "merchant";
    document.querySelectorAll(".kourify-protection").forEach(function (container) {
      container.classList.toggle("kourify-protection--included", merchantPays);
      var heading = container.querySelector(".kourify-protection__heading");
      var price = container.querySelector(".kourify-protection__price");

      if (merchantPays) {
        if (heading) heading.textContent = "Protected at no extra charge";
        if (price) price.textContent = "Included";
        return;
      }

      if (price) {
        var basisCents = Number(container.getAttribute("data-basis-cents")) || 0;
        var currency = container.getAttribute("data-currency");
        var feeCents = computeFeeCents(settings, basisCents);
        price.textContent = formatMoney(feeCents, currency);
      }
    });
  }

  function fetchSettings() {
    return fetch("/apps/kourify/settings", { headers: { Accept: "application/json" } })
      .then(function (res) {
        return res.ok ? res.json() : null;
      })
      .catch(function () {
        return null;
      })
      .then(function (settings) {
        if (settings) {
          applyPayerState(settings);
        }
        return settings;
      });
  }

  function init() {
    var protectionBlocks = document.querySelectorAll("[data-kourify-protection]");
    var hasAnyTrigger =
      protectionBlocks.length ||
      document.querySelector("[data-kourify-learn-more], [data-kourify-file-claim], [data-kourify-guarantee-tab]");
    if (!hasAnyTrigger) return;

    fetchSettings();

    if (protectionBlocks.length) {
      ensureGuaranteeTab();
    }

    var learnMoreOverlay = null;
    function openLearnMore() {
      if (!learnMoreOverlay) learnMoreOverlay = buildLearnMoreModal();
      openModal(learnMoreOverlay);
    }

    function openClaim() {
      closeAllModals();
      window.location.href = "/apps/kourify/claims";
    }

    // Delegated so this also works for buttons rendered later (e.g. the
    // "File a claim" button inside the dynamically-built learn-more modal).
    document.addEventListener("click", function (e) {
      if (e.target.closest("[data-kourify-learn-more]")) {
        openLearnMore();
      }
      if (e.target.closest("[data-kourify-file-claim]")) {
        e.preventDefault();
        e.stopPropagation();
        openClaim();
        return;
      }
      if (e.target.matches("[data-kourify-close]")) {
        closeModal(e.target.closest(".kourify-modal-overlay"));
      }
      if (e.target.classList.contains("kourify-modal-overlay")) {
        closeModal(e.target);
      }
    });

    protectionBlocks.forEach(function (block) {
      var checkbox = block.querySelector("[data-kourify-opt-in]");
      if (checkbox) {
        checkbox.addEventListener("change", function () {
          block.classList.toggle("is-selected", checkbox.checked);
        });
      }
    });

    window.addEventListener("pagehide", closeAllModals);
    window.addEventListener("pageshow", closeAllModals);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
