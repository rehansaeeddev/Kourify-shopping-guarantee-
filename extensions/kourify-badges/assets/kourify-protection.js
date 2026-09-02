(function () {
  var SHIELD_ICON_SVG =
    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M12 2L4 5v6c0 5.25 3.4 9.74 8 11 4.6-1.26 8-5.75 8-11V5l-8-3z" fill="#065f46"/><path d="M8.3 12.1l2.3 2.3 5-5" stroke="#fff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  // The real logo is a theme asset, only resolvable via Liquid's asset_url —
  // this plain JS file can't call that, so it reads the URL off whichever
  // Kourify block Liquid already rendered it into (see data-logo-url on
  // protection-cart.liquid, protection-product.liquid, guarantee-tab.liquid).
  function logoImgHtml(size) {
    var host = document.querySelector("[data-logo-url]");
    var url = host && host.getAttribute("data-logo-url");
    if (url) {
      return (
        '<img src="' + url + '" width="' + size + '" height="' + size +
        '" alt="" style="display:block;object-fit:contain;" />'
      );
    }
    return SHIELD_ICON_SVG;
  }

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
      logoImgHtml(16) +
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
      logoImgHtml(14) +
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

  var currentSettings = null;
  var currentCart = null;

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
          currentSettings = settings;
          applyPayerState(settings);
        }
        return settings;
      });
  }

  function fetchCart() {
    return fetch("/cart.js", { headers: { Accept: "application/json" } })
      .then(function (res) {
        return res.ok ? res.json() : null;
      })
      .catch(function () {
        return null;
      });
  }

  function legacyVariantId() {
    var raw = currentSettings && currentSettings.protectionVariantLegacyId;
    var id = Number(raw);
    return Number.isFinite(id) && id > 0 ? id : null;
  }

  function findProtectionLine(cart) {
    var id = legacyVariantId();
    if (!cart || !id) return null;
    var items = cart.items || [];
    for (var i = 0; i < items.length; i++) {
      if (items[i].variant_id === id) return items[i];
    }
    return null;
  }

  function syncAllCheckboxes() {
    var protectionLine = findProtectionLine(currentCart);
    document.querySelectorAll("[data-kourify-protection]").forEach(function (block) {
      var checkbox = block.querySelector("[data-kourify-opt-in]");
      if (!checkbox) return;
      checkbox.checked = Boolean(protectionLine);
      block.classList.toggle("is-selected", Boolean(protectionLine));
    });
  }

  function showBlockError(block, message) {
    var note = block.querySelector(".kourify-protection__footnote");
    if (!note) return;
    var original = note.innerHTML;
    note.textContent = message;
    setTimeout(function () {
      note.innerHTML = original;
    }, 4000);
  }

  function isCartApiError(body) {
    return Boolean(body && (body.status || body.description));
  }

  function handleProtectionToggle(block, checkbox) {
    var id = legacyVariantId();
    if (!id || !currentSettings || currentSettings.protectionPayer === "merchant") {
      return;
    }

    var shouldAdd = checkbox.checked;
    var previousChecked = !shouldAdd;
    checkbox.disabled = true;

    fetchCart()
      .then(function (freshCart) {
        currentCart = freshCart || currentCart;
        var existingLine = findProtectionLine(currentCart);

        if (shouldAdd) {
          if (existingLine) {
            return { ok: true, cart: currentCart };
          }
          return fetch("/cart/add.js", {
            method: "POST",
            headers: { "Content-Type": "application/json", Accept: "application/json" },
            body: JSON.stringify({
              items: [
                {
                  id: id,
                  quantity: 1,
                  properties: { _kourify_protection: "true" },
                },
              ],
            }),
          }).then(function (res) {
            return res.json().then(function (body) {
              return { ok: res.ok && !isCartApiError(body), body: body };
            });
          });
        }

        if (!existingLine) {
          return { ok: true, cart: currentCart };
        }
        return fetch("/cart/change.js", {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({ id: existingLine.key, quantity: 0 }),
        }).then(function (res) {
          return res.json().then(function (body) {
            return { ok: res.ok && !isCartApiError(body), body: body };
          });
        });
      })
      .then(function (result) {
        if (!result || !result.ok) {
          throw new Error((result && result.body && result.body.description) || "Cart update failed");
        }
        return fetchCart();
      })
      .then(function (freshCart) {
        currentCart = freshCart;
        checkbox.disabled = false;
        syncAllCheckboxes();
      })
      .catch(function () {
        checkbox.checked = previousChecked;
        checkbox.disabled = false;
        showBlockError(block, "Couldn't update protection — please try again.");
      });
  }

  var settingsReadyPromise = null;
  var wiredBlocks = typeof WeakSet !== "undefined" ? new WeakSet() : null;

  function ensureSettingsReady() {
    if (!settingsReadyPromise) {
      settingsReadyPromise = fetchSettings().then(function () {
        return fetchCart().then(function (cart) {
          currentCart = cart;
        });
      });
    }
    return settingsReadyPromise;
  }

  // Cart-drawer/product markup in many themes is rendered or replaced by AJAX
  // after our initial page-load scan (opening the drawer, adding an item,
  // etc.), so a one-time querySelectorAll at DOMContentLoaded misses blocks
  // that appear later. wireProtectionBlock + the MutationObserver below make
  // sure every instance — however and whenever it lands in the DOM — gets a
  // real checkbox listener instead of staying a purely cosmetic control.
  function wireProtectionBlock(block) {
    if (wiredBlocks) {
      if (wiredBlocks.has(block)) return;
      wiredBlocks.add(block);
    } else if (block.hasAttribute("data-kourify-wired")) {
      return;
    } else {
      block.setAttribute("data-kourify-wired", "true");
    }

    ensureGuaranteeTab();

    var checkbox = block.querySelector("[data-kourify-opt-in]");
    if (checkbox) {
      checkbox.addEventListener("change", function () {
        handleProtectionToggle(block, checkbox);
      });
    }

    ensureSettingsReady().then(function () {
      if (currentSettings) applyPayerState(currentSettings);
      syncAllCheckboxes();
    });
  }

  function scanForProtectionBlocks(root) {
    if (!root || root.nodeType !== 1) return;
    if (root.matches && root.matches("[data-kourify-protection]")) {
      wireProtectionBlock(root);
    }
    if (root.querySelectorAll) {
      root.querySelectorAll("[data-kourify-protection]").forEach(wireProtectionBlock);
    }
  }

  function init() {
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

    scanForProtectionBlocks(document.body);

    if (typeof MutationObserver !== "undefined" && document.body) {
      var observer = new MutationObserver(function (mutations) {
        mutations.forEach(function (mutation) {
          mutation.addedNodes.forEach(function (node) {
            scanForProtectionBlocks(node);
          });
        });
      });
      observer.observe(document.body, { childList: true, subtree: true });
    }

    window.addEventListener("pagehide", closeAllModals);
    window.addEventListener("pageshow", closeAllModals);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
