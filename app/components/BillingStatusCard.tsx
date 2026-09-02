import { Card } from "./Card";

type BillingStatusCardProps = {
  hasActiveBilling: boolean;
  protectionEnabled: boolean;
  onChoosePlan: () => void;
};

export function BillingStatusCard({
  hasActiveBilling,
  protectionEnabled,
  onChoosePlan,
}: BillingStatusCardProps) {
  return (
    <Card heading="Shopping Guarantee">
      <s-stack direction="block" gap="base">
        <s-stack direction="block" gap="small-200">
          <s-stack direction="inline" gap="base" alignItems="center" justifyContent="space-between">
            <s-text color="subdued">Billing</s-text>
            <s-badge tone={hasActiveBilling ? "success" : "warning"}>
              {hasActiveBilling ? "Active" : "Not subscribed"}
            </s-badge>
          </s-stack>
          <s-stack direction="inline" gap="base" alignItems="center" justifyContent="space-between">
            <s-text color="subdued">Shopping Guarantee</s-text>
            <s-badge tone={protectionEnabled ? "success" : "neutral"}>
              {protectionEnabled ? "Enabled" : "Disabled"}
            </s-badge>
          </s-stack>
          <s-stack direction="inline" gap="base" alignItems="center" justifyContent="space-between">
            <s-text color="subdued">Protection provider</s-text>
            <s-badge tone="warning">Manual guarantee</s-badge>
          </s-stack>
        </s-stack>

        {!hasActiveBilling && (
          <s-banner tone="warning" heading="Protection is locked">
            <s-stack direction="block" gap="base">
              <s-text>Choose a Kourify plan to activate Shopping Guarantee.</s-text>
              <s-button variant="primary" onClick={onChoosePlan}>
                Choose a plan
              </s-button>
            </s-stack>
          </s-banner>
        )}
      </s-stack>
    </Card>
  );
}
