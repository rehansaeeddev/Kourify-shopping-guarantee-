/** A value that's present and isn't still the example placeholder. */
function configured(value: string | undefined): value is string {
  if (!value) return false;
  const trimmed = value.trim();
  if (!trimmed) return false;
  // Placeholders from .env.example must never be treated as real credentials.
  return !/^(re_x+|your[_-]|xkeysib-xxx|smtp[_-]?key|change[_-]?me)/i.test(
    trimmed,
  );
}

/**
 * SMTP delivery — used by Brevo, and by any other SMTP provider.
 *
 * Preferred over the Resend HTTP path when configured, because an SMTP key is
 * the credential most providers hand out. Requires host, user and password
 * together: a half-filled block silently falling back to "no email" is worse
 * than not configuring it at all.
 */
async function sendViaSmtp(
  to: string,
  subject: string,
  body: string,
  from: string,
): Promise<void> {
  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASSWORD;
  if (!configured(host) || !configured(user) || !configured(pass)) return;

  const port = Number(process.env.SMTP_PORT ?? 587);
  // Port 465 is implicit TLS; 587 upgrades via STARTTLS.
  const secure = port === 465;

  // Imported lazily so a shop using the Resend path never loads the SMTP
  // client, and so a missing optional dependency can't break app startup.
  const nodemailer = (await import("nodemailer")).default;
  const transport = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user, pass },
  });

  await transport.sendMail({ from, to, subject, text: body });
}

/**
 * Sends via SMTP when configured (Brevo and friends), otherwise Resend's HTTP
 * API. Falls back to logging rather than sending when neither is set up, so
 * claim submission never breaks in dev — but throws in production, where
 * silently dropping a customer notification would be worse.
 */
async function sendEmail(
  to: string,
  subject: string,
  body: string,
): Promise<void> {
  const from = process.env.EMAIL_FROM;

  // SMTP takes precedence: if a merchant has filled it in, that's the route
  // they intend, and falling through to Resend would be surprising.
  if (
    configured(from) &&
    configured(process.env.SMTP_HOST) &&
    configured(process.env.SMTP_USER) &&
    configured(process.env.SMTP_PASSWORD)
  ) {
    try {
      await sendViaSmtp(to, subject, body, from);
      return;
    } catch (error) {
      console.error("[notify] SMTP send threw", error);
      throw error;
    }
  }

  const apiKey = process.env.RESEND_API_KEY;

  if (!configured(apiKey) || !configured(from)) {
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "Email delivery is not configured: set EMAIL_FROM plus either SMTP_HOST/SMTP_USER/SMTP_PASSWORD (Brevo or another SMTP provider) or RESEND_API_KEY",
      );
    }
    // The body contains customer name/PII, so don't log it by default — even in
    // dev. Log a redacted line, and only dump the full content when explicitly
    // opted in via KOURIFY_DEBUG_EMAIL.
    if (process.env.KOURIFY_DEBUG_EMAIL === "1") {
      console.info(`[DEV EMAIL] to=${to} subject="${subject}"\n${body}\n---`);
    } else {
      console.info(
        `[DEV EMAIL] (delivery not configured) subject="${subject}" — set KOURIFY_DEBUG_EMAIL=1 to log full content`,
      );
    }
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
      throw new Error(
        `Resend send failed (${response.status}): ${await response.text().catch(() => "")}`,
      );
    }
  } catch (error) {
    console.error("[notify] Resend send threw", error);
    throw error;
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

export async function sendProtectionOffer(params: {
  email: string;
  orderName: string;
  price: string;
  expiresAt: Date;
  offerUrl: string;
}): Promise<void> {
  await sendEmail(
    params.email,
    `Optional protection for order ${params.orderName}`,
    `Protection was not included with order ${params.orderName}. If you want coverage for eligible loss, damage, theft, shortage, or a wrong item, review the optional ${params.price} Kourify Shopping Guarantee before ${params.expiresAt.toUTCString()}:\n\n${params.offerUrl}\n\nProtection is optional. Your order will not be delayed if you decline or ignore this offer, and protection starts only after successful payment.`,
  );
}
