import "@shopify/ui-extensions/preact";
import {render} from "preact";
import {useEffect, useState} from "preact/hooks";

export default function extension() {
  render(<Extension />, document.body);
}

function Extension() {
  const [variant, setVariant] = useState(null);
  const [payer, setPayer] = useState("customer");
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;

    const settingsQuery = Promise.resolve()
      .then(() => {
        const shop = shopify.shop;
        return `${shop.storefrontUrl || `https://${shop.myshopifyDomain}`}/apps/kourify/settings`;
      })
      .then((settingsUrl) => fetch(settingsUrl, {headers: {Accept: "application/json"}}))
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!active || !data) return;
        setPayer(data.protectionPayer || "customer");
        setEnabled(Boolean(data.protectionEnabled));
        if (data.protectionVariantId) {
          setVariant({
            id: data.protectionVariantId,
            price: {
              amount: String((data.protectionFlatFeeCents || 0) / 100),
              currencyCode: data.currency || "USD",
            },
          });
        }
      })
      .catch((err) => {
        console.error("[kourify] settings fetch failed", err);
      });

    settingsQuery.finally(() => {
      if (active) setLoading(false);
    });

    return () => {
      active = false;
    };
  }, []);

  if (loading) return null;

  if (!enabled) return null;

  if (!variant) {
    // Protection is enabled but the merchant hasn't finished configuring the
    // product/variant. Never surface that setup instruction to the shopper —
    // hide the block and log for the merchant instead.
    console.warn(
      "[kourify] protection enabled but no variant configured; hiding checkout block",
    );
    return null;
  }

  if (payer === "merchant") {
    return (
      <s-banner heading={shopify.i18n.translate("protectionTitle")} tone="success">
        <s-text>{shopify.i18n.translate("merchantCoversFee")}</s-text>
      </s-banner>
    );
  }

  const protectionLine = shopify.lines.value.find(
    (line) => line.merchandise.id === variant.id,
  );
  const selected = Boolean(protectionLine);
  const canAdd = shopify.instructions.value.lines.canAddCartLine;
  const canRemove = shopify.instructions.value.lines.canRemoveCartLine;
  const canChange = selected ? canRemove : canAdd;
  const formattedFee = shopify.i18n.formatCurrency(Number(variant.price.amount), {
    currency: variant.price.currencyCode,
  });

  return (
    <s-banner
      heading={shopify.i18n.translate("protectionTitle")}
      tone={selected ? "success" : "info"}
    >
      <s-stack gap="base">
        <s-text>{shopify.i18n.translate("protectionDescription")}</s-text>
        <s-checkbox
          checked={selected}
          disabled={busy || !canChange}
          onChange={handleProtectionChange}
          label={shopify.i18n.translate("addProtection", {price: formattedFee})}
        />
        <s-text tone="neutral">
          {selected
            ? shopify.i18n.translate("includedInTotal")
            : shopify.i18n.translate("totalWillUpdate")}
        </s-text>
        {!canChange && (
          <s-text tone="critical">
            {shopify.i18n.translate("cartChangesUnavailable")}
          </s-text>
        )}
        {error && <s-text tone="critical">{error}</s-text>}
      </s-stack>
    </s-banner>
  );

  async function handleProtectionChange(event) {
    const shouldAdd = event.target.checked;
    setBusy(true);
    setError("");

    let result;
    if (shouldAdd) {
      result = await shopify.applyCartLinesChange({
          type: "addCartLine",
          merchandiseId: variant.id,
          quantity: 1,
          attributes: [{key: "_kourify_protection", value: "true"}],
      });
    } else if (protectionLine) {
      result = await shopify.applyCartLinesChange({
          type: "removeCartLine",
          id: protectionLine.id,
          quantity: protectionLine.quantity,
      });
    } else {
      setBusy(false);
      return;
    }

    if (result.type === "error") {
      setError(result.message || shopify.i18n.translate("updateError"));
    }
    setBusy(false);
  }
}
