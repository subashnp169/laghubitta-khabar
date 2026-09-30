/**
 * Statically discover the data endpoint a career page loads its vacancies from.
 *
 * The rule this file exists to enforce: no JavaScript is executed. A page's inline
 * and external script are read as TEXT and searched for URL literals. Nothing is
 * run, no browser is started, and no endpoint is ever discovered by calling it and
 * seeing what arrives. That is what makes a discovered endpoint auditable — the
 * candidate carries the exact source text that produced it, so a reviewer can check
 * the claim without trusting a runtime.
 *
 * Every institution here is a different codebase, but they overwhelmingly use the
 * same handful of calls, so one generic extractor covers them. Nothing in this file
 * names an institution, and nothing in it may: a rule that only fits one site is the
 * scraper-per-institution this phase forbids.
 */

export type EndpointMethod = "GET" | "POST" | "UNKNOWN";

export interface EndpointCandidate {
  /** Absolute URL, or null when the literal could not be resolved against the page. */
  url: string | null;
  /** The literal exactly as it appears in the source. */
  raw: string;
  method: EndpointMethod;
  /** Which call site produced it. Auditable, and used to rank same-literal results. */
  pattern: string;
  /** The enclosing script's `src`, or "inline" for an inline script. */
  origin: string;
  /** False when the URL is off-host, not HTTPS, or unparseable. */
  sameOriginHttps: boolean;
  /**
   * A conservative prior that the endpoint returns data rather than a page. This
   * only decides what is worth a probe; a candidate is never excluded on the basis
   * of this alone if the path is already a known data path.
   */
  looksLikeData: boolean;
  /** Why it was rejected, when sameOriginHttps is false. */
  rejectReason?: string;
}

/**
 * The body of a single- or double-quoted JavaScript literal, up to its terminator.
 *
 * A quote only ends the literal when it is not escaped, so `fetch("/a\"b")` is one
 * literal containing `/a"b` rather than a literal `/a\` followed by stray text. This
 * matters because truncating at the escaped quote yields `/a/` — a path the page
 * never requests, which would then be probed and reported as a real endpoint.
 *
 * A backslash is otherwise allowed, because one is legal in a URL path.
 */
// These are regular-expression sources, so the escape for "any escaped character"
// is the two characters backslash-dot. In a template literal a single backslash
// would be consumed by the string escape rules, hence the doubled form below.
const DQ_BODY = String.raw`(?:\\.|[^"\\]){2,300}`;
const SQ_BODY = String.raw`(?:\\.|[^'\\]){2,300}`;
const BT_BODY = String.raw`(?:\\.|[^` + "`" + String.raw`\\]){2,300}`;

/** The three quoted-literal alternatives, each already a capture group. */
const DQ = `"(${DQ_BODY})"`;
const SQ = `'(${SQ_BODY})'`;
const BT = "`(" + BT_BODY + ")`";

/**
 * Call sites, in the order they are searched. Each is a named, auditable pattern;
 * `pattern` on a candidate is the name that matched.
 *
 * `url:` is deliberately last. It is the least specific key in JavaScript and matches
 * image URLs, analytics configuration and CSS references as readily as an API, so a
 * hit from it is ranked below a hit from a call that can only be a request.
 */
const CALL_SITES: ReadonlyArray<{ name: string; re: RegExp; method: EndpointMethod }> = [
  { name: "fetch", re: new RegExp(String.raw`\bfetch\s*\(\s*(?:${SQ}|${DQ}|${BT}|([A-Za-z_$][\w$]{0,40}))`, "gi"), method: "GET" },
  { name: "$.getJSON", re: new RegExp(String.raw`\$\s*\.\s*getJSON\s*\(\s*(?:${SQ}|${DQ}|${BT}|([A-Za-z_$][\w$]{0,40}))`, "gi"), method: "GET" },
  { name: "$.get", re: new RegExp(String.raw`\$\s*\.\s*get\s*\(\s*(?:${SQ}|${DQ}|${BT}|([A-Za-z_$][\w$]{0,40}))`, "gi"), method: "GET" },
  { name: "$.post", re: new RegExp(String.raw`\$\s*\.\s*post\s*\(\s*(?:${SQ}|${DQ}|${BT}|([A-Za-z_$][\w$]{0,40}))`, "gi"), method: "POST" },
  { name: "$.ajax.url", re: new RegExp(String.raw`url\s*:\s*(?:${SQ}|${DQ}|${BT}|([A-Za-z_$][\w$]{0,40}))`, "gi"), method: "GET" },
  { name: "$.ajax.string", re: new RegExp(String.raw`\$\s*\.\s*ajax\s*\(\s*(?:${SQ}|${DQ}|${BT}|([A-Za-z_$][\w$]{0,40}))`, "gi"), method: "GET" },
  { name: "axios", re: new RegExp(String.raw`\baxios\s*(?:\.\s*(?:get|post)\s*)?\(\s*(?:${SQ}|${DQ}|${BT}|([A-Za-z_$][\w$]{0,40}))`, "gi"), method: "GET" },
  { name: "XHR.open", re: new RegExp(String.raw`\.open\s*\(\s*(?:'(GET|POST)'|"(GET|POST)")\s*,\s*(?:${SQ}|${DQ}|${BT}|([A-Za-z_$][\w$]{0,40}))`, "gi"), method: "GET" },
];

/** A bare string literal that is shaped like a data path. */
const DATA_PATH_RE = /^\/(?:api|ajax|data|services?|rest|json|graphql|webservice)[/\-?]/i;
const DATA_SUFFIX_RE = /\.(?:json|geojson)(?:$|[?#])/i;
const QUERY_JSON_RE = /[?&](?:format|output|type|Accept|accept)\s*=\s*json\b/i;
const QUERY_API_RE = /[?&](?:api|ajax|json|action|task|op)\s*=/i;
/** Paths that name the domain of the request rather than its data. */
const ASSET_RE = /\.(?:js|mjs|css|png|jpe?g|gif|svg|webp|ico|woff2?|ttf|eot|map|mp4|woff|avif)$/i;

/** An HTML attribute that can hold a request target. */
const ATTR_SITES: ReadonlyArray<{ name: string; re: RegExp; method: EndpointMethod }> = [
  { name: "form.action", re: new RegExp(String.raw`<form\b[^>]*\baction\s*=\s*(?:${SQ}|${DQ})`, "gi"), method: "POST" },
  { name: "data-url", re: new RegExp(String.raw`\bdata-(?:url|api|endpoint|src-?url|action|href)\s*=\s*(?:${SQ}|${DQ})`, "gi"), method: "GET" },
];

/** Same-origin script files worth reading, in preference order, per page. */
export const MAX_EXTERNAL_SCRIPTS = 6;

/**
 * True when a candidate came from a call that can only be a request, rather than
 * from an HTML attribute.
 *
 * The distinction matters for one decision. A `<form action>` is a place a browser
 * would go if a person submitted something; it is not evidence that the page fetches
 * its own content. Counting form actions as data loads put five institutions into
 * "we cannot see their vacancies" when their pages are static and their only forms
 * are application and newsletter forms.
 */
export function isRequestCallPattern(pattern: string): boolean {
  return pattern.startsWith("form.action") === false && pattern.startsWith("data-") === false;
}

/**
 * A URL a call site passed as a bare identifier, and the string constant it holds.
 *
 * The one endpoint this phase actually found is written as
 *
 *   var url = "/content/Careers/7";
 *   fetch(url)
 *
 * so a pattern that only matches quoted literals inside a call misses it. One level
 * of constant substitution recovers that case, and only that case: a variable built
 * by concatenation, a loop or a function call is not resolvable without executing the
 * page, which this phase does not do. A candidate found this way says so, so a
 * reviewer knows it came from a substitution rather than from the call site.
 */
export function constantStringIn(text: string, name: string): string | null {
  if (!/^[A-Za-z_$][\w$]{0,40}$/.test(name)) return null;
  // The literal must be the whole right-hand side. Without the trailing lookahead,
  // '/api/' matches out of "'/api/' + id", and resolving that would fetch a
  // different request than the page makes.
  const re = new RegExp(
    `\\b(?:var|let|const)\\s+${name}\\s*=\\s*(?:${SQ}|${DQ}|${BT})\\s*(?=[;\\r\\n)])`,
    "g",
  );
  const m = re.exec(text);
  if (!m) return null;
  const template = m[3];
  // An interpolated template is a concatenation in disguise.
  if (template !== undefined && template.includes("${")) return null;
  const literal = m[1] ?? m[2] ?? template;
  // A captured literal keeps JavaScript's backslash escapes, which are not part of
  // the URL. Unescaping here means the resolved URL is the one the page requests.
  return literal === undefined ? null : unescapeJsString(literal);
}

/** True when a captured literal is a template with a `${...}` hole in it. */
function isInterpolated(raw: string): boolean {
  return raw.includes("${");
}

/**
 * True when the next non-space character after a matched literal is `+`, meaning the
 * literal is the first operand of a concatenation. The match already consumed the
 * closing quote, so what follows is what decides.
 */
function isConcatenated(text: string, afterMatch: number): boolean {
  for (let i = afterMatch; i < text.length; i += 1) {
    const c = text[i];
    if (c === " " || c === "\t" || c === "\n" || c === "\r") continue;
    return c === "+";
  }
  return false;
}

/**
 * True when the last non-space character before a match is `+`, meaning the matched
 * literal is the second operand of a concatenation and is only part of a longer
 * value. `data-url=base+'/api/x'` contains `/api/x`, but the page requests
 * `base + "/api/x"`, and the fragment alone is not a target.
 */
function isConcatenatedBefore(text: string, startMatch: number): boolean {
  for (let i = startMatch - 1; i >= 0; i -= 1) {
    const c = text[i];
    if (c === " " || c === "\t" || c === "\n" || c === "\r") continue;
    return c === "+";
  }
  return false;
}

/** Resolve JavaScript's simple string escapes. Anything unrecognised is left alone. */
function unescapeJsString(s: string): string {
  return s.replace(/\\(u\{[0-9a-fA-F]+\}|u[0-9a-fA-F]{4}|x[0-9a-fA-F]{2}|.)/g, (whole, esc: string) => {
    if (esc.startsWith("u{")) return String.fromCodePoint(Number.parseInt(esc.slice(2, -1), 16));
    if (esc[0] === "u" || esc[0] === "x") return String.fromCharCode(Number.parseInt(esc.slice(1), 16));
    switch (esc) {
      case "n": return "\n";
      case "t": return "\t";
      case "r": return "\r";
      case "b": return "\b";
      case "f": return "\f";
      case "v": return "\v";
      case "0": return "\0";
      case "\\": return "\\";
      case "'": return "'";
      case '"': return '"';
      case "`": return "`";
      case "\n": return "";
      default: return whole;
    }
  });
}

function pick(m: RegExpExecArray): string | null {
  // Every CALL_SITES pattern ends with an optional bare identifier group, so all
  // groups but the last are quoted literals and the last is the variable name.
  for (let i = 1; i < m.length - 1; i += 1) {
    const v = m[i];
    if (typeof v === "string" && v.length > 0) return v;
  }
  return null;
}

function pickIdentifier(m: RegExpExecArray): string | null {
  const v = m[m.length - 1];
  return typeof v === "string" && v.length > 0 && pick(m) === null ? v : null;
}

/** First non-empty group, used by the attribute patterns, which take no identifier. */
function pickAll(m: RegExpExecArray): string | null {
  for (let i = 1; i < m.length; i += 1) {
    const v = m[i];
    if (typeof v === "string" && v.length > 0) return v;
  }
  return null;
}

function looksLikeData(raw: string): boolean {
  if (ASSET_RE.test(raw)) return false;
  return DATA_PATH_RE.test(raw) || DATA_SUFFIX_RE.test(raw) || QUERY_JSON_RE.test(raw) || QUERY_API_RE.test(raw);
}

/**
 * Resolve a source literal against the page and apply the same-origin HTTPS rule.
 *
 * A literal is rejected, never followed, when it names another host, an insecure
 * scheme, or a non-HTTP protocol. `javascript:`, `data:` and `blob:` literals are
 * dropped here rather than handed to a fetcher that would have to refuse them.
 */
export function resolveCandidate(raw: string, pageUrl: string): { url: string | null; sameOriginHttps: boolean; rejectReason?: string } {
  const trimmed = raw.trim();
  if (!trimmed) return { url: null, sameOriginHttps: false, rejectReason: "empty literal" };
  if (/^(?:javascript|data|blob|mailto|tel|about):/i.test(trimmed)) {
    return { url: null, sameOriginHttps: false, rejectReason: "non-fetchable scheme" };
  }
  let resolved: URL;
  try {
    resolved = new URL(trimmed, pageUrl);
  } catch {
    return { url: null, sameOriginHttps: false, rejectReason: "unparseable literal" };
  }
  // Characters that cannot occur in a static request target. A literal carrying them
  // is a fragment of an expression that the attribute regex cut in the wrong place —
  // `data-url='obj.action||'/api/x''` matches as `obj.action||` — so the resolved
  // "URL" is a piece of JavaScript rather than a path the page requests. It is
  // refused with a reason instead of being probed and reported as an endpoint.
  const IMPOSSIBLE_IN_TARGET = /[(|){}`'"><\s\\]/;
  if (IMPOSSIBLE_IN_TARGET.test(resolved.pathname) || IMPOSSIBLE_IN_TARGET.test(resolved.search)) {
    return { url: null, sameOriginHttps: false, rejectReason: "literal is a fragment of an expression, not a static request target" };
  }
  if (resolved.protocol !== "https:") {
    return { url: resolved.toString(), sameOriginHttps: false, rejectReason: `scheme ${resolved.protocol} is not https` };
  }
  // Credentials in a URL are refused here as well as in the fetcher. They are never
  // legitimate on a public careers endpoint, and a literal carrying them is a sign
  // the page is trying to authenticate — which this pipeline does not do.
  if (resolved.username || resolved.password) {
    return { url: null, sameOriginHttps: false, rejectReason: "url carries credentials" };
  }
  // Same site is not same origin: a different port is a different service, and one
  // an institution does not publish a careers API on. Refusing it here keeps an
  // internal port out of the candidate set entirely.
  const page = new URL(pageUrl);
  if (resolved.port && resolved.port !== page.port) {
    return { url: resolved.toString(), sameOriginHttps: false, rejectReason: `port ${resolved.port} is not the page port` };
  }
  if (!isSameSite(resolved, pageUrl)) {
    return { url: resolved.toString(), sameOriginHttps: false, rejectReason: "different site" };
  }
  return { url: resolved.toString(), sameOriginHttps: true };
}

/**
 * Same SITE, not strictly same host: a `www.` host and its apex are the same
 * institution, and pages under one routinely call an endpoint on the other. The
 * registrable-domain comparison is done on the last two labels, which is
 * deliberately conservative for `.com.np` and `.org.np` sites — an institution's
 * own subdomains match, and nothing else does.
 */
export function isSameSite(a: URL | string, b: URL | string): boolean {
  const ua = typeof a === "string" ? new URL(a) : a;
  const ub = typeof b === "string" ? new URL(b) : b;
  return siteOf(ua.hostname) === siteOf(ub.hostname);
}

function siteOf(host: string): string {
  const labels = host.toLowerCase().replace(/^www\./, "").split(".");
  if (labels.length <= 2) return labels.join(".");
  return labels.slice(-3).join(".");
}

/**
 * Every endpoint candidate in one document, de-duplicated by resolved URL with the
 * most specific pattern retained. A URL found by both `$.get` and `url:` keeps
 * `$.get`, because a call site that can only be a request is stronger evidence than
 * a generic key.
 */
export function extractEndpointCandidates(html: string, pageUrl: string, origin = "inline"): EndpointCandidate[] {
  const found = new Map<string, EndpointCandidate>();
  const rank = (c: EndpointCandidate): number => CALL_SITES.findIndex((s) => s.name === c.pattern) + ATTR_SITES.findIndex((s) => s.name === c.pattern) * 10 + (c.origin === "inline" ? 0 : 5);

  const scan = (text: string, originLabel: string): void => {
    for (const site of CALL_SITES) {
      const re = new RegExp(site.re.source, site.re.flags);
      let m: RegExpExecArray | null;
      while ((m = re.exec(text)) !== null) {
        const literal = site.name === "XHR.open" ? pick(m.slice(3) as unknown as RegExpExecArray) : pick(m);
        if (literal !== null) {
          // A literal followed by `+` is one operand of a concatenation. The URL the
          // page requests includes the operands that follow, so this fragment is not
          // the request target and must not be probed as if it were.
          if (!isConcatenated(text, m.index + m[0].length)) add(literal, site.name, site.method, originLabel);
          continue;
        }
        const ident = pickIdentifier(m);
        if (ident === null) continue;
        const resolved = constantStringIn(text, ident);
        if (resolved === null) continue;
        add(resolved, `${site.name}+const`, site.method, originLabel);
      }
    }
    for (const site of ATTR_SITES) {
      const re = new RegExp(site.re.source, site.re.flags);
      let m: RegExpExecArray | null;
      while ((m = re.exec(text)) !== null) {
        const raw = pickAll(m);
        if (raw === null) continue;
        // An attribute value is often JavaScript that this phase does not run, so the
        // same concatenation rule as the call sites applies here. `data-url="/api/"+id`
        // does not request `/api/`; it requests `/api/` plus an unknown id, and
        // probing the prefix would report an endpoint the page never calls. Both
        // sides matter: the literal may be the first operand, and a literal that is
        // the *second* operand is a fragment of a longer value, not a target.
        if (isConcatenated(text, m.index + m[0].length)) continue;
        if (isConcatenatedBefore(text, m.index)) continue;
        add(raw, site.name, site.method, originLabel);
      }
    }
  };

  const add = (raw: string, pattern: string, method: EndpointMethod, originLabel: string): void => {
    // The raw literal may carry JavaScript backslash escapes, which are not part of
    // the request target. Resolving the unescaped form means the URL under review
    // is the URL the page actually requests.
    const literal = unescapeJsString(raw);
    const r = resolveCandidate(literal, pageUrl);
    const key = r.url ?? `~${literal}`;
    const prev = found.get(key);
    // An interpolated template is a concatenation in disguise. `` /api/${id} ``
    // matches the pattern because its characters look literal, but the URL it
    // builds is not knowable without running the page, so it is not a candidate.
    // Recorded with a reason rather than dropped, so a reviewer can see the page
    // does call something here.
    const interpolated = isInterpolated(raw);
    const rejectReason = interpolated
      ? "interpolated template literal is not a static URL"
      : r.rejectReason;
    const candidate: EndpointCandidate = {
      // `raw` stays byte-for-byte as the page wrote it, because it is quoted
      // evidence; `url` is the unescaped target the request would actually use.
      url: interpolated ? null : r.url,
      raw,
      method,
      pattern,
      origin: originLabel,
      sameOriginHttps: interpolated ? false : r.sameOriginHttps,
      looksLikeData: looksLikeData(literal),
      ...(rejectReason ? { rejectReason } : {}),
    };
    if (!prev || rank(candidate) < rank(prev)) found.set(key, candidate);
  };

  // The label is recorded on every candidate as the place it was found, because
  // "an endpoint exists" is only reviewable alongside "where I read it". Comments
  // are removed first: a commented-out call is not a request.
  for (const block of scriptBodies(html)) scan(stripJsComments(stripHtmlComments(block)), origin);
  for (const site of ATTR_SITES) {
    const re = new RegExp(site.re.source, site.re.flags);
    let m: RegExpExecArray | null;
    // An HTML comment is not an attribute, so a commented-out request is not a
    // request. Both passes preserve offsets, so the pattern still sees the
    // original document shape.
    const attrText = stripJsComments(stripHtmlComments(html));
    re.lastIndex = 0;
    while ((m = re.exec(attrText)) !== null) {
      const raw = pickAll(m);
      if (raw === null) continue;
      // Same concatenation rule as everywhere else: a fragment of a concatenated
      // value is not a request target, on either side of the literal.
      if (isConcatenated(attrText, m.index + m[0].length)) continue;
      if (isConcatenatedBefore(attrText, m.index)) continue;
      add(raw, site.name, site.method, "attribute");
    }
  }
  return [...found.values()].sort((a, b) => a.url?.localeCompare(b.url ?? "") ?? 0);
}

/**
 * Blank out comments, preserving length and newlines so that offsets and line
 * numbers still refer to the original text.
 *
 * A commented-out `fetch("/api/jobs")` is not a request, and reporting it as a
 * candidate would put a URL in front of a reviewer that the page never calls. A
 * regex cannot do this correctly, because `//` and `/*` both occur inside string
 * literals — `fetch("https://host/x")` is a real request whose URL contains `//`.
 * So this walks the text the way a lexer would, tracking whether it is in a
 * string or a comment, and blanks the comment bodies in place.
 *
 * Nothing here executes anything. It is a character scan of text already in hand.
 */
export function stripJsComments(src: string): string {
  const out = src.split("");
  let i = 0;
  const n = src.length;
  const blank = (from: number, to: number): void => {
    for (let k = from; k < to && k < n; k += 1) {
      // Newlines survive so line numbers and regex anchoring stay correct.
      if (out[k] !== "\n" && out[k] !== "\r") out[k] = " ";
    }
  };
  while (i < n) {
    const ch = src[i];
    // Line comment.
    if (ch === "/" && src[i + 1] === "/") {
      let j = i + 2;
      while (j < n && src[j] !== "\n" && src[j] !== "\r") j += 1;
      blank(i, j);
      i = j;
      continue;
    }
    // Block comment.
    if (ch === "/" && src[i + 1] === "*") {
      const end = src.indexOf("*/", i + 2);
      const j = end === -1 ? n : end + 2;
      blank(i, j);
      i = j;
      continue;
    }
    // String literal: consume it whole so a `//` inside it is never a comment.
    if (ch === '"' || ch === "'" || ch === "`") {
      const quote = ch;
      i += 1;
      while (i < n) {
        if (src[i] === "\\") {
          i += 2;
          continue;
        }
        if (src[i] === quote) {
          i += 1;
          break;
        }
        i += 1;
      }
      continue;
    }
    i += 1;
  }
  return out.join("");
}

/**
 * Blank out `<!-- ... -->` sections, preserving length and newlines.
 *
 * An HTML comment is not JavaScript, so `stripJsComments` will not touch it, but a
 * commented-out request is still not a request. Applied to page text before the
 * attribute patterns run.
 */
export function stripHtmlComments(src: string): string {
  const out = src.split("");
  let i = 0;
  while (i < src.length) {
    if (src.startsWith("<!--", i)) {
      const end = src.indexOf("-->", i + 4);
      const j = end === -1 ? src.length : end + 3;
      for (let k = i; k < j; k += 1) {
        if (out[k] !== "\n" && out[k] !== "\r") out[k] = " ";
      }
      i = j;
      continue;
    }
    i += 1;
  }
  return out.join("");
}

/** Inline script bodies, including `<script src>` elements (empty for those). */
export function scriptBodies(html: string): string[] {
  const out: string[] = [];
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const body = m[2] ?? "";
    if (body.trim()) out.push(body);
  }
  return out;
}

/**
 * Same-origin `<script src>` URLs, which frequently hold the endpoint that the
 * inline script calls. Returned resolved and filtered, so a caller can fetch them
 * under the same policy as a page.
 */
export function externalScriptUrls(html: string, pageUrl: string): string[] {
  const out: string[] = [];
  const re = /<script\b[^>]*\bsrc\s*=\s*(?:'([^']+)'|"([^"]+)")/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const raw = (m[1] ?? m[2] ?? "").trim();
    const r = resolveCandidate(raw, pageUrl);
    if (r.sameOriginHttps && r.url) out.push(r.url);
  }
  return [...new Set(out)].slice(0, MAX_EXTERNAL_SCRIPTS);
}
