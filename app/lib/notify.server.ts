/**
 * DUMMY email sender — logs what would be sent instead of actually sending
 * anything. No real provider is wired up yet (needs a Postmark/Resend
 * account + API key). Swap the body of `sendEmail` for a real provider
 * call when that's ready; every call site below stays the same.
 */
function sendEmail(to: string, subject: string, body: string): void {
  console.log(
    `[DUMMY EMAIL] to=${to} subject="${subject}"\n${body}\n---`,
  );
}

export function notifyClaimSubmitted(params: {
  email: string;
  fullName: string;
  orderNumber: string;
  issueType: string;
}): void {
  sendEmail(
    params.email,
    `We received your claim for order ${params.orderNumber}`,
    `Hi ${params.fullName},\n\nWe received your ${params.issueType} claim for order ${params.orderNumber}. Our team reviews claims manually and will follow up by email — this is not an automatic approval or payout.\n\n— Kourify`,
  );
}

export function notifyClaimStatusChanged(params: {
  email: string;
  fullName: string;
  orderNumber: string;
  status: string;
}): void {
  const statusCopy: Record<string, string> = {
    reviewing: "is now being reviewed by our team",
    resolved: "has been resolved",
    denied: "was not approved",
  };

  sendEmail(
    params.email,
    `Update on your claim for order ${params.orderNumber}`,
    `Hi ${params.fullName},\n\nYour claim for order ${params.orderNumber} ${
      statusCopy[params.status] ?? `is now marked "${params.status}"`
    }. Reply to this email if you have questions.\n\n— Kourify`,
  );
}
