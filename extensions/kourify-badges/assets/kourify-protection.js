(function () {
  var STEPS = ["Order info", "Contact info", "Issue details", "Review"];
  var claimStep = 0;
  var claimData = {};
  var kourifySettings = null;

  var ISSUE_TYPE_LABELS = {
    lost: "Never arrived (lost in transit)",
    damaged: "Arrived damaged",
    stolen: "Marked delivered, not received (stolen)",
    shortage: "Items missing from the package",
    concealed: "Box looked fine, contents damaged or missing",
    wrong_item: "Wrong item received",
  };
  var ALL_ISSUE_TYPES = ["lost", "damaged", "stolen", "shortage", "concealed", "wrong_item"];
  var EVIDENCE_REQUIRED_TYPES = ["damaged", "concealed"];
  var MAX_EVIDENCE_BYTES = 5 * 1024 * 1024;

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

  function issueTypeOptionsHtml() {
    var enabled =
      kourifySettings && kourifySettings.enabledClaimTypes && kourifySettings.enabledClaimTypes.length
        ? kourifySettings.enabledClaimTypes
        : ALL_ISSUE_TYPES;

    return enabled
      .map(function (value) {
        var label = ISSUE_TYPE_LABELS[value] || value;
        return '<option value="' + value + '">' + label + "</option>";
      })
      .join("");
  }

  function buildClaimModal() {
    var overlay = el("div", "kourify-modal-overlay");
    overlay.hidden = true;

    var stepperHtml = STEPS.map(function (label, i) {
      return (
        '<div class="kourify-stepper__step" data-step-index="' +
        i +
        '">' +
        '<div class="kourify-stepper__dot"></div>' +
        '<div class="kourify-stepper__label">' +
        label +
        "</div></div>"
      );
    }).join("");

    overlay.innerHTML =
      '<div class="kourify-modal" role="dialog" aria-modal="true">' +
      '<button type="button" class="kourify-modal__close" data-kourify-close aria-label="Close">✕</button>' +
      modalHeaderHtml(
        "File a claim",
        "Tell us what happened and we'll review it — usually within a couple of business days.",
      ) +
      '<div class="kourify-stepper">' +
      stepperHtml +
      "</div>" +
      '<div data-kourify-claim-body>' +
      '<div class="kourify-claim-step" data-claim-step="0">' +
      '<label>Order number<input type="text" data-field="orderNumber" placeholder="#1234" /></label>' +
      '<label>Confirmation code<input type="text" data-field="confirmationCode" placeholder="From your order confirmation email" /></label>' +
      "</div>" +
      '<div class="kourify-claim-step" data-claim-step="1">' +
      '<label>Full name<input type="text" data-field="fullName" /></label>' +
      '<label>Email<input type="email" data-field="email" /></label>' +
      "</div>" +
      '<div class="kourify-claim-step" data-claim-step="2">' +
      '<label>What happened?' +
      '<select data-field="issueType">' +
      issueTypeOptionsHtml() +
      "</select>" +
      "</label>" +
      '<label>Details<textarea data-field="details" rows="3"></textarea></label>' +
      '<div class="kourify-claim-evidence" data-kourify-evidence-wrap hidden>' +
      '<label>Photo evidence<input type="file" accept="image/*" data-kourify-evidence-input /></label>' +
      '<p class="kourify-claim-error" data-kourify-evidence-error hidden>A photo is required for this claim type.</p>' +
      "</div>" +
      "</div>" +
      '<div class="kourify-claim-step" data-claim-step="3">' +
      '<div data-kourify-review></div>' +
      "</div>" +
      "</div>" +
      '<div class="kourify-claim-actions">' +
      '<button type="button" class="kourify-btn kourify-btn--secondary" data-kourify-back>Back</button>' +
      '<button type="button" class="kourify-btn kourify-btn--primary" data-kourify-next>Next</button>' +
      "</div>" +
      "</div>";

    document.body.appendChild(overlay);
    return overlay;
  }

  function openModal(overlay) {
    overlay.hidden = false;
  }

  function closeModal(overlay) {
    overlay.hidden = true;
  }

  function setClaimStep(overlay, index) {
    claimStep = index;
    overlay
      .querySelectorAll(".kourify-stepper__step")
      .forEach(function (stepEl, i) {
        stepEl.classList.toggle("is-active", i === index);
        stepEl.classList.toggle("is-done", i < index);
      });
    overlay.querySelectorAll(".kourify-claim-step").forEach(function (stepEl) {
      stepEl.classList.toggle(
        "is-active",
        Number(stepEl.getAttribute("data-claim-step")) === index,
      );
    });

    var backBtn = overlay.querySelector("[data-kourify-back]");
    var nextBtn = overlay.querySelector("[data-kourify-next]");
    backBtn.style.visibility = index === 0 ? "hidden" : "visible";

    if (index === STEPS.length - 1) {
      var review = overlay.querySelector("[data-kourify-review]");
      review.innerHTML =
        '<div class="kourify-claim-success"><p><strong>Ready to submit.</strong></p>' +
        "<p>Order " +
        (claimData.orderNumber || "—") +
        " · " +
        (ISSUE_TYPE_LABELS[claimData.issueType] || claimData.issueType || "—") +
        "</p>" +
        "<p>Our team will follow up by email at " +
        (claimData.email || "—") +
        ". Claims are reviewed manually — this does not guarantee approval or automatic payout.</p></div>";
      nextBtn.textContent = "Submit";
    } else {
      nextBtn.textContent = "Next";
    }
  }

  function collectStepFields(overlay, index) {
    overlay
      .querySelector('[data-claim-step="' + index + '"]')
      .querySelectorAll("[data-field]")
      .forEach(function (input) {
        claimData[input.getAttribute("data-field")] = input.value;
      });
  }

  function wireEvidenceField(overlay) {
    var issueSelect = overlay.querySelector('[data-field="issueType"]');
    var wrap = overlay.querySelector("[data-kourify-evidence-wrap]");
    var fileInput = overlay.querySelector("[data-kourify-evidence-input]");
    var errorEl = overlay.querySelector("[data-kourify-evidence-error]");

    function syncVisibility() {
      var required = EVIDENCE_REQUIRED_TYPES.indexOf(issueSelect.value) !== -1;
      wrap.hidden = !required;
      if (!required) errorEl.hidden = true;
    }

    issueSelect.addEventListener("change", syncVisibility);
    syncVisibility();

    fileInput.addEventListener("change", function () {
      var file = fileInput.files && fileInput.files[0];
      if (!file) {
        claimData.evidenceImage = "";
        return;
      }
      if (file.size > MAX_EVIDENCE_BYTES) {
        claimData.evidenceImage = "";
        fileInput.value = "";
        errorEl.textContent = "That photo is too large — please attach one under 5MB.";
        errorEl.hidden = false;
        return;
      }
      var reader = new FileReader();
      reader.onload = function () {
        claimData.evidenceImage = reader.result;
        errorEl.hidden = true;
      };
      reader.readAsDataURL(file);
    });
  }

  function submitClaim(overlay) {
    var body = overlay.querySelector("[data-kourify-claim-body]");
    var actions = overlay.querySelector(".kourify-claim-actions");
    var nextBtn = overlay.querySelector("[data-kourify-next]");
    nextBtn.disabled = true;
    nextBtn.textContent = "Submitting…";

    fetch("/apps/kourify/claim", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        orderNumber: claimData.orderNumber,
        confirmationCode: claimData.confirmationCode,
        fullName: claimData.fullName,
        email: claimData.email,
        issueType: claimData.issueType,
        details: claimData.details,
        evidenceImage: claimData.evidenceImage,
      }),
    })
      .then(function (res) {
        return res
          .json()
          .catch(function () {
            return {};
          })
          .then(function (json) {
            return { ok: res.ok, json: json };
          });
      })
      .catch(function () {
        return {
          ok: false,
          json: { error: "Something went wrong submitting this. Please try again." },
        };
      })
      .then(function (result) {
        if (result.ok) {
          body.innerHTML =
            '<div class="kourify-claim-success"><p><strong>Thanks — we\'ve received your claim.</strong></p>' +
            "<p>Our team will reach out by email at " +
            (claimData.email || "your email") +
            ". Claims are reviewed manually — this does not guarantee approval or automatic payout.</p></div>";
          actions.hidden = true;
        } else {
          body.innerHTML =
            '<div class="kourify-claim-success"><p><strong>We couldn\'t submit this claim.</strong></p>' +
            "<p>" +
            ((result.json && result.json.error) || "Please try again.") +
            "</p></div>";
          nextBtn.disabled = false;
          nextBtn.textContent = "Submit";
        }
      });
  }

  function wireClaimModal(overlay) {
    wireEvidenceField(overlay);

    overlay
      .querySelector("[data-kourify-next]")
      .addEventListener("click", function () {
        collectStepFields(overlay, claimStep);

        if (claimStep === 2) {
          var required = EVIDENCE_REQUIRED_TYPES.indexOf(claimData.issueType) !== -1;
          if (required && !claimData.evidenceImage) {
            overlay.querySelector("[data-kourify-evidence-error]").hidden = false;
            return;
          }
        }

        if (claimStep === STEPS.length - 1) {
          submitClaim(overlay);
          return;
        }
        setClaimStep(overlay, claimStep + 1);
      });
    overlay
      .querySelector("[data-kourify-back]")
      .addEventListener("click", function () {
        if (claimStep > 0) setClaimStep(overlay, claimStep - 1);
      });
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
          kourifySettings = settings;
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

    var learnMoreOverlay = null;
    var claimOverlay = null;

    function openLearnMore() {
      if (!learnMoreOverlay) learnMoreOverlay = buildLearnMoreModal();
      openModal(learnMoreOverlay);
    }

    function openClaim() {
      if (learnMoreOverlay) closeModal(learnMoreOverlay);
      if (!claimOverlay) {
        claimOverlay = buildClaimModal();
        wireClaimModal(claimOverlay);
        setClaimStep(claimOverlay, 0);
      }
      openModal(claimOverlay);
    }

    // Delegated so this also works for buttons rendered later (e.g. the
    // "File a claim" button inside the dynamically-built learn-more modal).
    document.addEventListener("click", function (e) {
      if (e.target.closest("[data-kourify-learn-more]")) {
        openLearnMore();
      }
      if (e.target.closest("[data-kourify-file-claim]")) {
        openClaim();
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
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
