// ============================================================================
// Node DNS resolver for ControlledFetcher (Phase E, Node side).
// Fixtures, seed, and smoke scripts import this to give the fetcher real
// SSRF DNS verification. The Worker ships its own resolver in worker/src.
// ============================================================================

import { promises as dns } from "node:dns";

// DNS lookups in Node cannot be aborted via Fetch abort signals; bound them so
// a hanging resolver never stalls the fetcher beyond the fetch timeout.
const DNS_TIMEOUT_MS = 4000;

/** Resolve a hostname to its IPv4/IPv6 literals (never throws — [] on failure/timeout). */
export async function nodeResolveHost(hostname: string): Promise<string[]> {
  try {
    const results = await Promise.race([
      Promise.all([dns.resolve4(hostname), dns.resolve6(hostname)]),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("dns timeout")), DNS_TIMEOUT_MS)),
    ]);
    return [...new Set(results.flat())];
  } catch {
    return [];
  }
}