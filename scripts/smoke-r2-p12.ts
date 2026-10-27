// ============================================================================
// P12 — R2 media storage contract.
//
// Locks the configuration + URL construction layer:
//   * unconfigured (no env) -> isR2Configured() false, every helper null;
//   * configured (all env set) -> isR2Configured() true, r2PublicUrl builds a
//     URL from the public base + key (no double slashes, no signing);
//   * empty/null keys -> null;
//   * R2_ENV_VARS lists all five required vars.
//
// Run: npm run smoke:r2-p12
// ============================================================================
import { r2Config, isR2Configured, r2PublicUrl, R2_ENV_VARS, R2_STATUS_NOTE } from "../lib/storage/r2";

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean): void {
  if (cond) { pass += 1; console.log("  ok  ", name); }
  else { fail += 1; console.log("  FAIL", name); }
}

// Unconfigured (current process has no R2 env).
check("unconfigured: isR2Configured() is false", isR2Configured() === false);
check("unconfigured: r2PublicUrl returns null", r2PublicUrl("foo/bar.png") === null);
check("unconfigured: empty key returns null", r2PublicUrl("") === null);
check("unconfigured: null key returns null", r2PublicUrl(null) === null);
check("R2_ENV_VARS lists 5 vars", R2_ENV_VARS.length === 5);
check("R2_STATUS_NOTE is non-empty", R2_STATUS_NOTE.length > 0);

// Configured scenario: set env, re-evaluate by reading config directly.
const prev: Record<string, string | undefined> = {};
for (const k of R2_ENV_VARS) { prev[k] = process.env[k]; }
process.env.R2_ACCOUNT_ID = "acct";
process.env.R2_ACCESS_KEY_ID = "key";
process.env.R2_SECRET_ACCESS_KEY = "secret";
process.env.R2_BUCKET = "bucket";
process.env.R2_PUBLIC_URL = "https://media.example.com/";
check("configured: r2Config reads publicURL", r2Config().publicURL === "https://media.example.com/");
check("configured: isR2Configured() true", isR2Configured() === true);
check("configured: r2PublicUrl builds URL", r2PublicUrl("videos/x.mp4") === "https://media.example.com/videos/x.mp4");
check("configured: no double slash", r2PublicUrl("/videos/x.mp4") === "https://media.example.com/videos/x.mp4");

// Restore env.
for (const k of R2_ENV_VARS) {
  if (prev[k] === undefined) delete process.env[k];
  else process.env[k] = prev[k];
}

console.log(`\nsmoke:r2-p12: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
