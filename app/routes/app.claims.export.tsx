import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";

function csvEscape(value: string): string {
  // Neutralize spreadsheet formula injection: a cell starting with =, +, -, @,
  // tab, or carriage return is executed as a formula by Excel/Sheets. Several
  // columns here (name, email, order number) are customer-submitted, so prefix
  // any such cell with a single quote before quoting.
  if (/^[=+\-@\t\r]/.test(value)) {
    value = `'${value}`;
  }
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);

  const claims = await db.protectionClaim.findMany({
    where: { shop: session.shop },
    orderBy: { createdAt: "desc" },
  });

  const headers = [
    "Order",
    "Full name",
    "Email",
    "Issue type",
    "Status",
    "Risk level",
    "Evidence URL",
    "Submitted at",
    "Resolved at",
  ];

  const rows = claims.map((claim) =>
    [
      claim.shopifyOrderName ?? claim.orderNumber,
      claim.fullName,
      claim.email,
      claim.issueType,
      claim.status,
      claim.orderRiskLevel ?? "",
      claim.evidenceUrl ?? "",
      claim.createdAt.toISOString(),
      claim.resolvedAt ? claim.resolvedAt.toISOString() : "",
    ]
      .map((cell) => csvEscape(String(cell)))
      .join(","),
  );

  const csv = [headers.join(","), ...rows].join("\n");

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv",
      "Content-Disposition": `attachment; filename="kourify-claims-${session.shop}.csv"`,
    },
  });
};
