// ============================================================================
// Deterministic HTML canonicalizer (Phase Q) — used ONLY for change-detection
// hashing, NEVER for the stored evidence (raw bytes are preserved as-is).
//
// Conservative rule set (must never remove meaningful content; may only remove
// formatting/dynamic noise that is clearly non-content):
//   1. Line endings → LF (CRLF/CR normalize).
//   2. HTML comments removed.
//   3. <script>/<style> blocks removed (dynamic, non-content).
//   4. Block-level tags (p/div/li/table/... and <br>) → single space, so
//      paragraph re-wrapping / re-indentation is formatting noise.
//   5. Remaining tags stripped; element text content is KEPT as-is.
//   6. Common HTML entities decoded (attribute-encoding is formatting noise).
//   7. Whitespace runs collapsed to a single space.
//
// Deliberate NON-rules (deterministic but conservative — we prefer a spurious
// CHANGED over ever masking a real change):
//   - Visible timestamps/dates are NOT normalised (a published date is content).
//   - Case is preserved. Digits are preserved (interest rates, amounts).
//   - No DOM, no external libs: pure, total, deterministic byte→byte transform.
//
// Non-HTML content (application/pdf, octet-stream, …) is passed through: the
// raw bytes ARE the canonical form, so a PDF's identity is its content hash.
// ============================================================================

import type { Canonicalizer } from "./contract";

/** sha-256 hex digest of a byte buffer (identical scheme to the fetcher). */
export async function createSha256Hex(bytes: Uint8Array): Promise<string> {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const digest = await crypto.subtle.digest("SHA-256", copy);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const BLOCK_TAGS =
  "p|div|li|ul|ol|tr|td|th|tbody|thead|tfoot|table|section|article|header|footer|nav|main|aside|blockquote|pre|figure|figcaption|h1|h2|h3|h4|h5|h6";

/** A block-level boundary becomes one space (re-wrapping is formatting noise). */
const BLOCK_SPACE_RE = new RegExp(
  `<(?:\\s*/\\s*)?(?:${BLOCK_TAGS})\\b[^>]*>|<br\\s*/?>`,
  "gi",
);

/** Everything else that is an HTML tag is dropped (inline tags keep text). */
const TAG_RE = /<[^>]*>/g;

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  copy: "\u00a9",
  reg: "\u00ae",
  trade: "\u2122",
  middot: "\u00b7",
  ndash: "\u2013",
  mdash: "\u2014",
  hellip: "\u2026",
  laquo: "\u00ab",
  raquo: "\u00bb",
  times: "\u00d7",
  divide: "\u00f7",
};

function decodeEntities(s: string): string {
  const withNumeric = s.replace(
    /&#(x[0-9a-fA-F]+|\d+);?/g,
    (m, code: string) => {
      try {
        const n = code[0].toLowerCase() === "x" ? parseInt(code.slice(1), 16) : parseInt(code, 10);
        const ch = String.fromCodePoint(n);
        // Control chars must not be re-introduced as whitespace anchors.
        return n >= 32 ? ch : "";
      } catch {
        return m;
      }
    },
  );
  return withNumeric.replace(
    /&([a-z]+);/gi,
    (m, name: string) => NAMED_ENTITIES[name.toLowerCase()] ?? m,
  );
}

/**
 * Deterministic canonical text form of an HTML byte body. Total and pure:
 * same logical page → same string, regardless of line endings, indentation,
 * comment/script/style noise, tag flavour, and attribute-encoded tracking.
 */
export function canonicalizeHtml(source: Uint8Array): string {
  let s = new TextDecoder("utf-8").decode(source); // non-fatal → U+FFFD
  s = s.replace(/\r\n?/g, "\n");
  s = s.replace(/<!--[\s\S]*?-->/g, "");
  s = s.replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>|<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, "");
  s = s.replace(BLOCK_SPACE_RE, " ");
  s = s.replace(TAG_RE, "");
  s = decodeEntities(s);
  s = s.replace(/\s+/g, " ").trim();
  return s;
}

/**
 * Engine change-detection hasher. HTML is hashed from its canonical text form;
 * everything else (PDFs, archives, …) is hashed from the raw bytes.
 */
export const deterministicHtmlCanonicalizer: Canonicalizer = {
  async hash(contentType, body) {
    const mime = contentType ?? "";
    if (!/text\/html|application\/xhtml\+xml/i.test(mime)) {
      return createSha256Hex(body);
    }
    return createSha256Hex(new TextEncoder().encode(canonicalizeHtml(body)));
  },
};