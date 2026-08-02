// Whish Money / Whish Pay is not yet integrated. No merchant approval, API
// documentation, sandbox access, or credentials exist for it (see
// DATABASE_PLAN.md Part 6 for the full list of what is still required
// before real integration can start). This file only reads whatever
// server-only env vars an operator has set — it never invents endpoint
// URLs, auth formats, or payload shapes.
export interface WhishConfig {
  apiBaseUrl: string;
  merchantId: string;
  apiSecret: string;
}

// Deliberately returns null (not a thrown error) when unset, so callers
// treat "Whish not configured" as an expected, honest state rather than a
// crash — see src/lib/payments/whish/provider.ts.
export function getWhishConfig(): WhishConfig | null {
  const apiBaseUrl = process.env.WHISH_API_BASE_URL;
  const merchantId = process.env.WHISH_MERCHANT_ID;
  const apiSecret = process.env.WHISH_API_SECRET;

  if (!apiBaseUrl || !merchantId || !apiSecret) {
    return null;
  }

  return { apiBaseUrl, merchantId, apiSecret };
}
