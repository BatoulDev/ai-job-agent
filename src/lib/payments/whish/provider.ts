import type { PayablePlanCode } from "@/lib/plans/types";
import { getWhishConfig } from "./config";

// Typed provider boundary for Whish Money / Whish Pay. This defines the
// *shape* trusted server code will call once real integration exists — it
// does not implement real HTTP calls, real checkout URLs, real webhook
// signature verification, or real payment-status lookups, because no
// official Whish documentation or credentials are available yet (see
// DATABASE_PLAN.md Part 6). Every method below throws WhishNotConfiguredError
// until this file is replaced with a real implementation against official
// docs. Nothing here may be used to fake a successful payment.
export class WhishNotConfiguredError extends Error {
  constructor() {
    super("Online payment is not available yet. Please try again later.");
    this.name = "WhishNotConfiguredError";
  }
}

export interface CreateCheckoutInput {
  paymentAttemptId: string;
  userId: string;
  planCode: PayablePlanCode;
  amount: number;
  currency: string;
}

export interface CreateCheckoutResult {
  checkoutUrl: string;
  providerPaymentId: string;
}

export type WhishPaymentStatus = "pending" | "paid" | "failed" | "cancelled" | "expired";

export interface PaymentStatusResult {
  status: WhishPaymentStatus;
  providerPaymentId: string;
}

export interface ProviderNotification {
  // Raw, unverified request body/headers from a future Whish webhook.
  // Real signature verification must be implemented against official
  // Whish docs before this is ever trusted.
  rawBody: string;
  headers: Record<string, string>;
}

export interface WhishProvider {
  isConfigured(): boolean;
  createCheckout(input: CreateCheckoutInput): Promise<CreateCheckoutResult>;
  getPaymentStatus(providerPaymentId: string): Promise<PaymentStatusResult>;
  verifyPayment(providerPaymentId: string): Promise<PaymentStatusResult>;
  handleProviderNotification(notification: ProviderNotification): Promise<PaymentStatusResult>;
}

class UnconfiguredWhishProvider implements WhishProvider {
  isConfigured(): boolean {
    return getWhishConfig() !== null;
  }

  async createCheckout(): Promise<CreateCheckoutResult> {
    throw new WhishNotConfiguredError();
  }

  async getPaymentStatus(): Promise<PaymentStatusResult> {
    throw new WhishNotConfiguredError();
  }

  async verifyPayment(): Promise<PaymentStatusResult> {
    throw new WhishNotConfiguredError();
  }

  async handleProviderNotification(): Promise<PaymentStatusResult> {
    throw new WhishNotConfiguredError();
  }
}

// The only exported factory. Even once WHISH_* env vars are set, this
// still throws on every real operation — flipping that requires replacing
// the throws above with real, documented Whish API calls, not just
// supplying credentials.
export function getWhishProvider(): WhishProvider {
  return new UnconfiguredWhishProvider();
}
