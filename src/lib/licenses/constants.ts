import type { LicensePlan } from "./types";

export const LICENSE_PRODUCT_IDS: Record<Exclude<LicensePlan, "community">, string> = {
	pro: "ebafa58f-af9f-4b8a-a48d-6cfd44dd2053",
	team: "6e42b54c-3221-4f8f-93a7-bab494f9e224",
};

export const LICENSE_STATUS_CHANGED_EVENT = "mailflare:license-status-changed";

/**
 * Plan this self-hosted install runs on, whatever key is activated. "team"
 * unlocks every licensed feature; set it to null to use Paymug activation again.
 */
export const SELF_HOSTED_LICENSE_PLAN: Exclude<LicensePlan, "community"> | null = "team";
