/**
 * Effective dates for in-app legal documents.
 *
 * These must match the dates on lifemaintained.com (Lovable-hosted).
 * Update only when the corresponding document materially changes.
 *
 * Privacy Policy and Terms of Service can update independently.
 */

import type { Profile } from "@/lib/subscription";

export const PRIVACY_POLICY_EFFECTIVE_DATE = "March 22, 2026";
export const TERMS_OF_SERVICE_EFFECTIVE_DATE = "March 22, 2026";

/**
 * Acceptance version stamped on profiles. Bumping it sends every account through
 * the review sheet once. Keep equal to the live "Last updated" date on
 * lifemaintained.com/terms, ISO format.
 */
export const TERMS_VERSION = "2026-08-11";

export const TERMS_URL = "https://lifemaintained.com/terms";
export const PRIVACY_URL = "https://lifemaintained.com/privacy";

/** True when a loaded profile is not on the current terms version. A missing profile row never gates. */
export function needsTermsAcceptance(profile: Profile | null | undefined): boolean {
  if (!profile) return false;
  return profile.terms_version !== TERMS_VERSION;
}
