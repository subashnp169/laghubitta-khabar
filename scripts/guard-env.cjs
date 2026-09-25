// ============================================================================
// Dev-tooling environment guard (docs/OPERATIONS.md rule 1).
//
// Destructive and/or dev-only scripts (seed, builder, smoke tests) must refuse
// to run when LK_ENV points at a non-local environment. This prevents:
//   - "seed test data into production"
//   - "run destructive commands against production"
//   - accidental use of production credentials during local testing
//
// LK_ENV is the single source of truth:
//   (unset | "development" | "local")  → local/dev tooling allowed
//   "staging" | "production"           → local tooling BLOCKED
//
// Require me FIRST in any script that writes/deletes/stages data.
// ============================================================================

const BLOCKED = new Set(["staging", "production"]);

/** @returns {string} the normalized LK_ENV value */
function currentEnv() {
  return (process.env.LK_ENV || "development").toLowerCase();
}

/**
 * Throws unless the current LK_ENV permits local dev tooling. Call before any
 * write/delete/seed step. `label` names the script for actionable errors.
 */
function requireLocalEnv(label) {
  const env = currentEnv();
  if (BLOCKED.has(env)) {
    throw new Error(
      `REFUSED: ${label} is local/dev tooling, but LK_ENV=${env}. ` +
        "It must never run in staging/production. Unset LK_ENV (or set it to " +
        '"development") to run locally.',
    );
  }
  return env;
}

/** Convenience for CLIs: prints the error and exits non-zero on failure. */
function guardOrExit(label) {
  try {
    requireLocalEnv(label);
    return true;
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}

module.exports = { currentEnv, requireLocalEnv, guardOrExit };