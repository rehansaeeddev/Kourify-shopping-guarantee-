/**
 * Sends via Resend's HTTP API. Falls back to logging (instead of sending)
 * when RESEND_API_KEY isn't a real key yet, so claim submission never
 * breaks in dev/before the merchant's key is in place.
 */
async function sendEmail(to: string, subject: string, body: string): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;

  if (!apiKey || apiKey === "re_xxxxxxxxxxxxxxxxxx" || !from) {
    console.log(`[DUMMY EMAIL] to=${to} subject="${subject}"\n${body}\n---`);
    return;
  }

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from, to, subject, text: body }),
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      console.error(
        "[notify] Resend send failed",
        response.status,
        await response.text().catch(() => ""),
      );
    }
  } catch (error) {
    console.error("[notify] Resend send threw", error);
  }
}

export async function notifyClaimSubmitted(params: {
  email: string;
  fullName: string;
  orderNumber: string;
  issueType: string;
}): Promise<void> {
  await sendEmail(
    params.email,
    `We received your claim for order ${params.orderNumber}`,
    `Hi ${params.fullName},\n\nWe received your ${params.issueType} claim for order ${params.orderNumber}. Our team reviews claims manually and will follow up by email — this is not an automatic approval or payout.\n\n— Kourify`,
  );
}

export async function notifyClaimStatusChanged(params: {
  email: string;
  fullName: string;
  orderNumber: string;
  status: string;
}): Promise<void> {
  const statusCopy: Record<string, string> = {
    reviewing: "is now being reviewed by our team",
    resolved: "has been resolved",
    denied: "was not approved",
  };

  await sendEmail(
    params.email,
    `Update on your claim for order ${params.orderNumber}`,
    `Hi ${params.fullName},\n\nYour claim for order ${params.orderNumber} ${
      statusCopy[params.status] ?? `is now marked "${params.status}"`
    }. Reply to this email if you have questions.\n\n— Kourify`,
  );
}
