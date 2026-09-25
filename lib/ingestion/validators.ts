// ============================================================================
// Phase I — deterministic validation rules. Generic, evidence-driven, NEVER AI.
// Each rule derives PASS/FAIL from extracted evidence only and results persist
// via EvidenceWriter.saveValidation attached to the source snapshot (the
// evidence the rule judged). Rules never touch network, never publish, and a
// throwing rule degrades to FAIL (recorded), never crashes the run.
// ============================================================================

import type { Validator } from "./contract";

/** SANITY — the page produced at least one non-empty extracted FIELD. */
export const titlePresentValidator: Validator = {
  ruleId: "r-pilot-title",
  severity: "warning",
  async validate(ctx) {
    const fields = ctx.evidence.filter(
      (e) => e.kind === "FIELD" && (e.text ?? "").trim().length > 0,
    );
    return {
      status: fields.length > 0 ? "PASS" : "FAIL",
      severity: "warning",
      ruleId: "r-pilot-title",
      message: fields.length > 0
        ? `evidence field present: ${fields[0]?.text?.trim().slice(0, 60) ?? ""}`
        : "no non-empty extracted field",
      evidence: {
        fieldCount: fields.length,
        parserId: ctx.evidence[0]?.parserId ?? null,
      },
    };
  },
};

/** SANITY — any email-shaped field must be a plausible address, not junk. */
export const emailFormatValidator: Validator = {
  ruleId: "r-pilot-email",
  severity: "warning",
  async validate(ctx) {
    const emails = ctx.evidence.filter(
      (e) => e.kind === "FIELD" && (e.text ?? "").includes("@"),
    );
    const bad = emails.filter((e) =>
      !/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test((e.text ?? "").trim()),
    );
    return {
      status: bad.length === 0 ? "PASS" : "FAIL",
      severity: "warning",
      ruleId: "r-pilot-email",
      message: bad.length === 0
        ? (emails.length > 0
            ? `${emails.length} email field(s) look well-formed`
            : "no email field present (sanitised)")
        : `malformed email-shaped field: ${bad[0].text}`,
      evidence: { emailCount: emails.length, malformed: bad.length },
    };
  },
};

/** Default rule set wired by the pilot runner. */
export const pilotValidators: ReadonlyArray<Validator> = [
  titlePresentValidator,
  emailFormatValidator,
];