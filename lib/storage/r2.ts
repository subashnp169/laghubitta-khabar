// ============================================================================
// P12 — Cloudflare R2 media storage (configuration + URL construction).
//
// The site is a static export: media cannot be uploaded at request time. R2 is
// the planned store for any media asset that is ingested. This module owns the
// configuration and the public-URL shape so the rest of the code never touches
// R2 credentials directly.
//
// Configuration is read from the environment:
//   R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET,
//   R2_PUBLIC_URL (the public base URL of the bucket, e.g. a custom domain).
//
// When any required value is missing, `isR2Configured()` is false and every
// helper returns null — the site renders its honest "no media storage
// configured" state instead of pretending assets exist. Upload (signed PUT) is
// deliberately NOT implemented here: it needs the credentials above and belongs
// to the ingestion pipeline, not the read-only frontend. See docs/OPERATIONS.md.
// ============================================================================
export interface R2Config {
  accountID: string | null;
  accessKeyID: string | null;
  secretAccessKey: string | null;
  bucket: string | null;
  publicURL: string | null;
}

export function r2Config(): R2Config {
  const g = (k: string): string | null => {
    const v = process.env[k];
    return v && v.trim().length > 0 ? v.trim() : null;
  };
  return {
    accountID: g("R2_ACCOUNT_ID"),
    accessKeyID: g("R2_ACCESS_KEY_ID"),
    secretAccessKey: g("R2_SECRET_ACCESS_KEY"),
    bucket: g("R2_BUCKET"),
    publicURL: g("R2_PUBLIC_URL"),
  };
}

export function isR2Configured(): boolean {
  const c = r2Config();
  return !!(c.accountID && c.accessKeyID && c.secretAccessKey && c.bucket && c.publicURL);
}

/**
 * Public URL for a stored object key, or null when R2 is not configured (or
 * the key is empty). No signing, no network: pure construction.
 */
export function r2PublicUrl(key: string | null | undefined): string | null {
  if (!key || key.trim().length === 0) return null;
  const c = r2Config();
  if (!c.publicURL) return null;
  const base = c.publicURL.replace(/\/+$/, "");
  const k = key.replace(/^\/+/, "");
  return `${base}/${k}`;
}

export const R2_ENV_VARS = [
  "R2_ACCOUNT_ID",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
  "R2_BUCKET",
  "R2_PUBLIC_URL",
] as const;

export const R2_STATUS_NOTE =
  "Media storage (Cloudflare R2) is not configured in this build: set R2_ACCOUNT_ID, " +
  "R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET and R2_PUBLIC_URL to enable it. " +
  "Until then no media assets are served and the /media page states that honestly.";
