# DATA-STATUS-VOCABULARY

One universal evidence/status vocabulary for Laghubitta Khabar. All pages must use these exact terms. No page-specific variants.

## Status (record state)

| Term | Meaning | Usage |
|---|---|---|
| `VERIFIED` | A human or accepted authoritative review has confirmed this record against primary evidence. | Use only when evidence directly supports the claim and review is complete. |
| `AUTO_VERIFIED` | Derived/ingested from a structured authoritative source with basic validation, but not human-reviewed. | For structured, high-confidence extractions. |
| `HUMAN_VERIFIED` | Explicit human review against source artifact. | When reviewer has seen the source document/page. |
| `REPORTED` | Claimed by a source but not independently verified by review. | Default for source-owned observations. |
| `PARTIAL` | Evidence exists but is incomplete (missing period, page, number, or scope). | For fields where only subset of required context exists. |
| `CONFLICT` | Two or more independent sources make conflicting current assertions for the same entity+field. | Triggers M3.6B conflict semantics. Never auto-resolved by guessing. |
| `STALE` | Previously valid; source has since withdrawn/replaced (valid_to/superseded) or not observed within expected cadence. | Do not display as current. |
| `UNKNOWN` | No evidence located; cannot determine. | Do not substitute with 0, "—", fabricated date, or inferred value. |
| `NOT_EXTRACTED` | Evidence exists (document/source known) but value not yet extracted/normalized. | Distinguishes "known to exist" vs "not found". |
| `NOT_FOUND` | Monitored public sources do not contain this specific disclosure. | Do not imply non-compliance. |
| `HISTORICAL` | Applies to a past state/period (not current). | For archived values/timelines. |

## Evidence grade

| Grade | Definition | Notes |
|---|---|---|
| `A` | NRB / official institution source (primary, authoritative). | Highest evidentiary weight. |
| `B` | NEPSE/formal filing/equivalent authoritative regulated source. | Structured disclosure. |
| `C` | Reputable media (editorial, attributable). | Secondary; treat as reported unless corroborated. |
| `D` | Other public source with traceable URL/context. | Weakest; requires caution/corroboration. |

## Currency states

| Term | Meaning |
|---|---|
| `CURRENT` | The observation is not retired (valid_to unset/absent). |
| `RETIRED` | Source withdrew/superseded this claim (valid_to present). Excluded from public current views. |
| `SUPERSEDED` | Replaced by a newer assertion (same entity+field) from same or stronger source. |

## Missing-data presentation rule

- Unknown/Not extracted/Not found/Partial: display as `Unknown`, `Not extracted`, `Not found`, or `Partial` text — never `0`, `N/A` used to imply a number, never fabricated sentinel dates, never `Rs null`/`undefined`/`NaN`.
- Dates: absent → `Unknown` (or omit field). Never display `1900-01-09`/fact-like sentinels.
- Counts: absence → state honestly (Unknown/Partial/Not extracted).

Notes: M3.6B (People source-owned assertions, conflict/rejection/supersession/retired) remains the source of truth for people semantics. This vocabulary is product-wide and must not redefine M3.6B semantics.