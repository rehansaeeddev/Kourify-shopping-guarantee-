import "@shopify/ui-extensions/preact";
import {render} from "preact";
import {useEffect, useState} from "preact/hooks";

export default function extension() {
  render(<Extension />, document.body);
}

function Extension() {
  const [variant, setVariant] = useState(null);
  const [payer, setPayer] = useState("customer");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;

    const variantQuery = shopify
      .query(
        `query KourifyProtectionVariant {
          products(first: 1, query: "handle:kourify-order-protection") {
            nodes {
              variants(first: 1) {
                nodes {
                  id
                  price {
                    amount
                    currencyCode
                  }
                }
              }
            }
          }
        }`,
      )
      .then(({data}) => {
        const result = /** @type {any} */ (data);
        if (active) {
          setVariant(result?.products?.nodes?.[0]?.variants?.nodes?.[0] || null);
        }
      })
      .catch((err) => {
        console.error("[kourify] variant query failed", err);
        if (active) setError(shopify.i18n.translate("loadError"));
      });

    const settingsQuery = Promise.resolve()
      .then(() => {
        const shop = shopify.shop;
        return `${shop.storefrontUrl || `https://${shop.myshopifyDomain}`}/apps/kourify/settings`;
      })
      .then((settingsUrl) => fetch(settingsUrl, {headers: {Accept: "application/json"}}))
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (active && data?.protectionPayer) setPayer(data.protectionPayer);
      })
      .catch((err) => {
        console.error("[kourify] settings fetch failed", err);
      });

    Promise.all([variantQuery, settingsQuery]).finally(() => {
      if (active) setLoading(false);
    });

    return () => {
      active = false;
    };
  }, []);

  if (loading) return null;

  if (!variant) {
    return (
      <s-banner heading={shopify.i18n.translate("protectionTitle")} tone="warning">
        <s-text>
          {error || shopify.i18n.translate("configureVariant")}
        </s-text>
      </s-banner>
    );
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
