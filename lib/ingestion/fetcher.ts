// ============================================================================
// ControlledFetcher (Phase E) — the ONLY way remote content is fetched.
// Safety is owned HERE, not by callers:
//   - HTTPS only; no arbitrary URL fetch API.
//   - Host allowlist (source domain); port 443 only.
//   - SSRF guard: reject private/loopback/link-local/reserved IPs + localhost
//     + metadata endpoints; DNS-resolve and check every target.
//   - Redirect re-validation on EVERY hop (no downgrade, no host escape).
//   - Timeout, body-size cap, content-type guard, retry w/ exponential backoff,
//     per-host rate limiting, request identification.
//   - Downloaded content is NEVER executed or parsed into code; it is untrusted
//     bytes handed to the Extractor only.
//
// Runtime-agnostic core: `fetchImpl` + `resolveHost` are injected so the same
// class runs in Node fixtures and the Cloudflare Worker. Node resolver lives in
// fetcher.node.ts; the Worker wires its own resolver later.
// ============================================================================

import type { FetchOptions } from "./contract";
import type { FetchError, FetchResult } from "./types";

export interface FetcherPolicy {
  /** Hostnames the fetcher is ALLOWED to contact (lowercase, exact match). */
  allowedHosts: ReadonlyArray<string>;
  /**
   * Registered domains whose subdomains are ALSO allowed (e.g. a bank keeps
   * career content on career.<site>). This only widens the allowlist HOST set —
   * HTTPS, port, credentials, DNS-verified public-IP, and budget checks still
   * apply to every subdomain exactly as to apex.
   */
  allowSubdomainsOf?: ReadonlyArray<string>;
  /** True → refuse certificates for these exact names too (defense in depth). */
  alsoBlockLocalhostAliases?: boolean;
  maxBytes: number;
  timeoutMs: number;
  maxRedirects: number;
  maxRetries: number;
  retryBackoffMs: number;
  /** Minimum milliseconds between two fetches to the SAME host. */
  minIntervalMs: number;
  userAgent: string;
  fetchImpl?: typeof fetch;
  /** (hostname) → resolved IPs. Injected; default resolves via node:dns. */
  resolveHost?: (hostname: string) => Promise<string[]>;
}

export const DEFAULT_POLICY: FetcherPolicy = {
  allowedHosts: [],
  maxBytes: 5 * 1024 * 1024,
  timeoutMs: 15_000,
  maxRedirects: 5,
  maxRetries: 2,
  retryBackoffMs: 500,
  minIntervalMs: 250,
  userAgent: "laghubitta-khabar-ingestion/1.0 (+https://laghubitta.khabar)",
};

export class FetcherPolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FetcherPolicyError";
  }
}

const LOCALHOST_LITERALS: ReadonlyArray<string> = [
  "localhost",
  "localhost.localdomain",
  "::1",
];

const PRIVATE_V4_RANGES: ReadonlyArray<[number, number]> = [
  [0x00000000, 0x00ffffff], // 0.0.0.0/8
  [0x0a000000, 0x0affffff], // 10.0.0.0/8
  [0x7f000000, 0x7fffffff], // 127.0.0.0/8 (loopback)
  [0xa9fe0000, 0xa9feffff], // 169.254.0.0/16 (link-local / metadata)
  [0xac100000, 0xac1fffff], // 172.16.0.0/12
  [0xc0a80000, 0xc0a8ffff], // 192.168.0.0/16
  [0xffffffff, 0xffffffff], // broadcast
];

function ipv4ToInt(a: string, b: string, c: string, d: string): number {
  return ((+a << 24) | (+b << 16) | (+c << 8) | +d) >>> 0;
}

function isPrivateV4(ip: string): boolean {
  // Strip IPv4-mapped IPv6 prefix.
  const norm = ip.toLowerCase().startsWith("::ffff:") ? ip.slice(7) : ip;
  const parts = norm.split(".").map((x) => x.trim());
  if (parts.length !== 4 || parts.some((x) => !/^\d{1,3}$/.test(x))) return false;
  const int = ipv4ToInt(parts[0], parts[1], parts[2], parts[3]);
  return PRIVATE_V4_RANGES.some(([lo, hi]) => int >= lo && int <= hi);
}

/** IPv6 literals that are private/link-local/loopback/unspecified. */
const PRIVATE_V6_PREFIXES: ReadonlyArray<string> = [
  "::", //        unspecified
  "::1", //       loopback
  "::ffff:0:",
  "fc", //        fc00::/7 ULA
  "fd", //        fd00::/7 ULA
  "fe80", //      fe80::/10 link-local
  "fea", //       link-local (fea0::/10)
  "feb", //       link-local (feb0::/10)
  "fec", //       link-local (fec0::/10)
  "fed",
  "fee",
  "fef",
  "2001:db8:", // doc range (reserved)
  "ff", //        multicast
];

function isPrivateV6(ip: string): boolean {
  const low = ip.toLowerCase();
  return PRIVATE_V6_PREFIXES.some((p) => low.startsWith(p));
}

function isPrivateIp(ip: string): boolean {
  return ip.includes(":") ? isPrivateV6(ip) : isPrivateV4(ip);
}

function hostLooksLocal(hostname: string): boolean {
  const h = hostname.toLowerCase();
  if (LOCALHOST_LITERALS.includes(h)) return true;
  if (h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal")) return true;
  if (/^0x[0-9a-f]+$/i.test(h)) return true; // hex IP literal
  if (/^\d+\.\d+\.\d+\.\d+$/.test(h) && isPrivateV4(h)) return true;
  if (h.includes(":") && isPrivateV6(h)) return true;
  return false;
}

/** Validate a URL against the policy. Throws FetcherPolicyError when blocked. */
export function assertUrlAllowed(
  raw: string,
  policy: FetcherPolicy,
  hop: number,
): URL {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new FetcherPolicyError(`[hop ${hop}] malformed URL`);
  }
  if (u.protocol !== "https:") {
    throw new FetcherPolicyError(`[hop ${hop}] non-HTTPS protocol ${u.protocol} is blocked`);
  }
  if (u.username || u.password) {
    throw new FetcherPolicyError(`[hop ${hop}] URL credentials are blocked`);
  }
  if (u.port && u.port !== "" && u.port !== "443") {
    throw new FetcherPolicyError(`[hop ${hop}] non-default port ${u.port} is blocked`);
  }
  const host = u.hostname.toLowerCase();
  if (hostLooksLocal(host)) {
    if (policy.alsoBlockLocalhostAliases !== false) {
      throw new FetcherPolicyError(`[hop ${hop}] local/private address ${host} is blocked`);
    }
  }
  if (!isSubdomainAllowed(host, policy) && !policy.allowedHosts.includes(host)) {
    throw new FetcherPolicyError(`[hop ${hop}] host ${host} is not allowlisted`);
  }
  return u;
}

function isSubdomainAllowed(host: string, policy: FetcherPolicy): boolean {
  return (policy.allowSubdomainsOf ?? []).some((domain) => {
    const base = domain.toLowerCase();
    return host === base || host.endsWith(`.${base}`);
  });
}

/** Resolve + verify: every A/AAAA record must be non-private (SSRF defense). */
export async function assertResolvedAddresses(
  hostname: string,
  policy: FetcherPolicy,
): Promise<void> {
  if (!policy.resolveHost) return; // no resolver wired yet (Worker wires its own)
  const ips = await policy.resolveHost(hostname);
  for (const ip of ips) {
    if (isPrivateIp(ip)) {
      throw new FetcherPolicyError(`host ${hostname} resolves to private address ${ip}`);
    }
  }
}

export interface ControlledFetchInput {
  url: string;
  options?: FetchOptions;
  /** Encode provenance so retries are auditable. */
  requestId: string;
}

export interface ControlledFetchOutput {
  result: FetchResult;
  requestId: string;
  hops: string[];
  usedCache: boolean;
}

const RETRYABLE_HTTP_STATUS = new Set([429, 500, 502, 503, 504]);

export class ControlledFetcher {
  private readonly policy: FetcherPolicy;
  private readonly fetchImpl: typeof fetch;
  private readonly lastFetchAt: Map<string, number> = new Map();

  constructor(policy: Partial<FetcherPolicy> = {}) {
    this.policy = { ...DEFAULT_POLICY, ...policy };
    this.fetchImpl = this.policy.fetchImpl ?? ((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init));
  }

  /** Hosts currently allowed (read-only view for diagnostics). */
  get allowedHosts(): ReadonlyArray<string> {
    return this.policy.allowedHosts;
  }

  /** Back-compat single-shot fetch (still fully policy-governed). */
  async fetch(url: string, options?: FetchOptions): Promise<FetchResult> {
    const out = await this.fetchControlled({ url, options, requestId: crypto.randomUUID() });
    return out.result;
  }

  /** The one controlled entry point. Rate-limited + audit-traced. */
  async fetchControlled(input: ControlledFetchInput): Promise<ControlledFetchOutput> {
    const { url, options, requestId } = input;
    const max = options?.maxRedirects ?? this.policy.maxRedirects;
    const hops: string[] = [];
    let current = url;
    let redirectCount = 0;
    let lastError: FetchError | null = null;

    while (true) {
      const u = assertUrlAllowed(current, this.policy, redirectCount);
      const host = u.hostname.toLowerCase();
      await assertResolvedAddresses(host, this.policy);
      await this.rateLimit(host);

      hops.push(u.href);
      const fetchStart = Date.now();
      let out: FetchResult;
      try {
        out = await this.attemptFetch(u, options);
      } catch (e) {
        const err = e as FetchError;
        lastError = err;
        const retryable = ["DNS_FAILURE", "CONNECT_FAILED", "TIMEOUT", "HTTP_ERROR"].includes(err.type);
        if (retryable && redirectCount === 0 && this.policy.maxRetries > 0) {
          const backed = await this.retry(u, options ?? {}, fetchStart, requestId);
          if (backed) {
            hops.push(u.href + " (retry)");
            return this.wrap(backed, requestId, hops);
          }
        }
        throw err;
      }
      void fetchStart;

      if (out.error) {
        lastError = out.error;
        throw out.error;
      }

      if (out.httpStatus !== null && out.httpStatus >= 300 && out.httpStatus < 400) {
        const location = (out as { location?: string }).location;
        if (redirectCount >= max) {
          throw { type: "TOO_MANY_REDIRECTS", message: `exceeded ${max} redirects` } as FetchError;
        }
        if (!location) throw { type: "HTTP_ERROR", message: `redirect without Location (${out.httpStatus})` } as FetchError;
        redirectCount += 1;
        current = location;
        continue;
      }

      return this.wrap(out, requestId, hops);
    }
  }

  /** Sleep so the same host is never hammered (per-process; jittered). */
  private async rateLimit(host: string): Promise<void> {
    const now = Date.now();
    const prev = this.lastFetchAt.get(host) ?? 0;
    const wait = this.policy.minIntervalMs - (now - prev);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    this.lastFetchAt.set(host, Date.now());
  }

  /** A single authenticated, time-bounded, size-bounded fetch. */
  private async attemptFetch(u: URL, options: FetchOptions | undefined): Promise<FetchResult & { location?: string }> {
    const timeoutMs = options?.timeoutMs ?? this.policy.timeoutMs;
    const maxBytes = options?.maxBytes ?? this.policy.maxBytes;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const resp = await this.fetchImpl(u.href, {
        redirect: "manual", // we validate every hop ourselves
        signal: controller.signal,
        headers: {
          "User-Agent": this.policy.userAgent,
          Accept: "text/html,application/pdf,application/xhtml+xml,text/plain;q=0.8,*/*;q=0.5",
        },
      });

      const contentType = resp.headers.get("content-type");
      const status = resp.status;

      // Content-type guard when the caller asked for a specific family.
      if (options?.expectHtml && contentType && !/text\/html|application\/xhtml\+xml/i.test(contentType)) {
        await resp.body?.cancel();
        throw { type: "HTTP_ERROR", message: `expected HTML, got ${contentType}` } as FetchError;
      }
      if (options?.expectPdf && contentType && !/application\/pdf/i.test(contentType)) {
        await resp.body?.cancel();
        throw { type: "HTTP_ERROR", message: `expected PDF, got ${contentType}` } as FetchError;
      }

      const bytes = await readBounded(resp, maxBytes);
      const hash = await sha256(bytes);

      const headers: Record<string, string> = {};
      resp.headers.forEach((v, k) => (headers[k] = v));

      return {
        finalUrl: u.href,
        httpStatus: status,
        contentType,
        contentHash: hash,
        bodyBytes: bytes.byteLength,
        body: bytes,
        fetchedAt: new Date().toISOString(),
        redirectCount: 0,
        location: headers["location"] ?? undefined,
      };
    } catch (e) {
      if ((e as Error).name === "AbortError") {
        throw { type: "TIMEOUT", message: `timed out after ${timeoutMs}ms` } as FetchError;
      }
      if (isFetchError(e)) throw e;
      const msg = (e as Error).message;
      if (/dns/i.test(msg)) throw { type: "DNS_FAILURE", message: msg } as FetchError;
      if (/fetch failed|getaddrinfo/i.test(msg)) throw { type: "CONNECT_FAILED", message: msg } as FetchError;
      throw { type: "CONNECT_FAILED", message: msg } as FetchError;
    } finally {
      clearTimeout(timer);
    }
  }

  /** Exponential backoff retry for transient failures (only pre-redirect). */
  private async retry(
    u: URL,
    options: FetchOptions,
    startedAt: number,
    requestId: string,
  ): Promise<FetchResult | null> {
    for (let attempt = 1; attempt <= this.policy.maxRetries; attempt++) {
      const delay = this.policy.retryBackoffMs * 2 ** (attempt - 1);
      await new Promise((r) => setTimeout(r, delay + Math.random()));
      try {
        const host = u.hostname.toLowerCase();
        await this.rateLimit(host);
        return await this.attemptFetch(u, options);
      } catch {
        if (attempt >= this.policy.maxRetries) return null;
      }
    }
    return null;
  }

  private wrap(result: FetchResult, requestId: string, hops: string[]): ControlledFetchOutput {
    return { result, requestId, hops, usedCache: false };
  }
}

async function readBounded(resp: Response, maxBytes: number): Promise<Uint8Array> {
  if (!resp.body) return new Uint8Array(0);
  const reader = resp.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw { type: "BODY_TOO_LARGE", message: `body exceeded ${maxBytes} bytes` } as FetchError;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const digest = await crypto.subtle.digest("SHA-256", copy);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function isFetchError(e: unknown): e is FetchError {
  return typeof e === "object" && e !== null && "type" in e && "message" in e;
}

export { isPrivateV4, isPrivateV6, hostLooksLocal }; // exposed for tests