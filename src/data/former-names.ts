// GENERATED FILE - do not edit. Run `npm run build:former-names` to rebuild.
//
// 62 former name(s) across 25 institution(s), from the canonical FORMER-alias register (P1-B); event types are the NRB lineage's own, and no event date is recorded
//
// A former name is a predecessor identity this institution absorbed through a
// merger, acquisition or rename, taken verbatim from the canonical FORMER-alias
// register (data/master/canonical-former-aliases.json, P1-B). The register is the
// same lineage the identity checks close against, so a name on the public profile
// always traces to a closed record. No event date is stored, so none is emitted.
//
// Keyed by canonical institution id (`mfi-0NN`), NOT by slug or name. Read it
// through the site-data facade: `formerNames[institution.id]` is [] when the
// institution absorbed nothing.

export type FormerEventType = "MERGED" | "ACQUIRED" | "RENAMED";

export interface FormerName {
  /** The predecessor name, exactly as the regulator's lineage recorded it. */
  alias: string;
  /** What the lineage records happened: a merger, an acquisition, or a rename. */
  eventType: FormerEventType;
  /** The source the register attributes the name to. */
  sourceId: string;
}

/** What this build was based on, so an empty result is legible. */
export const formerNamesProvenance: string = "62 former name(s) across 25 institution(s), from the canonical FORMER-alias register (P1-B); event types are the NRB lineage's own, and no event date is recorded";

export const formerNames: Record<string, FormerName[]> = {
  "mfi-002": [
    { alias: "Adarsha Laghubitta Bittiya Sanstha Limited", eventType: "ACQUIRED", sourceId: "nrb-bfi-mid-may-2026" },
  ],
  "mfi-005": [
    { alias: "RMDC Laghubitta Bittiya Sanstha Limited", eventType: "MERGED", sourceId: "nrb-bfi-mid-may-2026" },
  ],
  "mfi-006": [
    { alias: "Buddha Jyoti Laghubitta Bittiya Sanstha Limited", eventType: "ACQUIRED", sourceId: "nrb-bfi-mid-may-2026" },
    { alias: "Cweda Laghubitta Bittiya Sanstha Limited", eventType: "ACQUIRED", sourceId: "nrb-bfi-mid-may-2026" },
    { alias: "Mirmire Laghubitta Bittiya Sanstha Limited", eventType: "ACQUIRED", sourceId: "nrb-bfi-mid-may-2026" },
    { alias: "Nagbeli Laghubitta Bikas Bank Limited", eventType: "ACQUIRED", sourceId: "nrb-bfi-mid-may-2026" },
    { alias: "Nerude Laghubitta Bittiya Sanstha Limited", eventType: "MERGED", sourceId: "nrb-bfi-mid-may-2026" },
  ],
  "mfi-008": [
    { alias: "Janakpur Laghubitta Bittiya Sanstha Limited", eventType: "ACQUIRED", sourceId: "nrb-bfi-mid-may-2026" },
  ],
  "mfi-010": [
    { alias: "Janasewi Laghubitta Bittiya Sanstha Limited", eventType: "MERGED", sourceId: "nrb-bfi-mid-may-2026" },
  ],
  "mfi-012": [
    { alias: "Grameen Swayamsewak Laghubitta Bittiya Sanstha Limited", eventType: "MERGED", sourceId: "nrb-bfi-mid-may-2026" },
    { alias: "Nagarik Laghubitta Bittiya Sanstha Limited", eventType: "MERGED", sourceId: "nrb-bfi-mid-may-2026" },
    { alias: "Suryodaya Laghubitta Bittiya Sanstha Limited", eventType: "MERGED", sourceId: "nrb-bfi-mid-may-2026" },
    { alias: "Trilok Laghubitta Bittiya Sanstha Limited", eventType: "MERGED", sourceId: "nrb-bfi-mid-may-2026" },
    { alias: "Womi Laghubitta Bittiya Sanstha Limited", eventType: "MERGED", sourceId: "nrb-bfi-mid-may-2026" },
  ],
  "mfi-014": [
    { alias: "Civil Laghubitta Bittiya Sanstha Limited", eventType: "RENAMED", sourceId: "nrb-bfi-mid-may-2026" },
  ],
  "mfi-015": [
    { alias: "Naya Nepal Laghubitta Bittiya Sanstha Limited", eventType: "MERGED", sourceId: "nrb-bfi-mid-may-2026" },
    { alias: "Naya Sarathi Laghubitta Bittiya Sanstha Limited", eventType: "MERGED", sourceId: "nrb-bfi-mid-may-2026" },
    { alias: "Sarathi Laghubitta Bittiya Sanstha Limited", eventType: "MERGED", sourceId: "nrb-bfi-mid-may-2026" },
    { alias: "Satyawoti Laghubitta Bittiya Sanstha Limited", eventType: "MERGED", sourceId: "nrb-bfi-mid-may-2026" },
  ],
  "mfi-018": [
    { alias: "Sparsha Laghubitta Bittiya Sanstha Limited", eventType: "ACQUIRED", sourceId: "nrb-bfi-mid-may-2026" },
  ],
  "mfi-019": [
    { alias: "Mahuli Samudayik Laghubitta Bittiya Sanstha Limited", eventType: "ACQUIRED", sourceId: "nrb-bfi-mid-may-2026" },
    { alias: "Nawa Kiran Laghubitta Bittiya Sanstha Limited", eventType: "ACQUIRED", sourceId: "nrb-bfi-mid-may-2026" },
  ],
  "mfi-021": [
    { alias: "Gharelu Laghubitta Bittiya Sanstha Limited", eventType: "MERGED", sourceId: "nrb-bfi-mid-may-2026" },
    { alias: "Manakamana Laghubitta Bittiya Sanstha Limited", eventType: "MERGED", sourceId: "nrb-bfi-mid-may-2026" },
    { alias: "Manakamana Smart Laghubitta Bittiya Sanstha Limited", eventType: "MERGED", sourceId: "nrb-bfi-mid-may-2026" },
    { alias: "Samata Laghubitta Bittiya Sanstha Limited", eventType: "MERGED", sourceId: "nrb-bfi-mid-may-2026" },
    { alias: "Smart Laghubitta Bittiya Sanstha Limited", eventType: "MERGED", sourceId: "nrb-bfi-mid-may-2026" },
  ],
  "mfi-024": [
    { alias: "Mahila Sahayatra Laghubitta Bittiya Sanstha Limited", eventType: "ACQUIRED", sourceId: "nrb-bfi-mid-may-2026" },
    { alias: "Sajilo Laghubitta Bittiya Sanstha Limited", eventType: "MERGED", sourceId: "nrb-bfi-mid-may-2026" },
    { alias: "Summit Laghubitta Bittiya Sanstha Limited", eventType: "MERGED", sourceId: "nrb-bfi-mid-may-2026" },
  ],
  "mfi-025": [
    { alias: "Madhya Paschimanchal Grameen Bikash Bank Limited", eventType: "MERGED", sourceId: "nrb-bfi-mid-may-2026" },
    { alias: "Madhyamanchal Grameen Bikash Bank Limited", eventType: "MERGED", sourceId: "nrb-bfi-mid-may-2026" },
    { alias: "Paschimanchal Grameen Bikash Bank Limited", eventType: "MERGED", sourceId: "nrb-bfi-mid-may-2026" },
    { alias: "Purwanchal Grameen Bikash Bank Limited", eventType: "MERGED", sourceId: "nrb-bfi-mid-may-2026" },
    { alias: "Sudur Paschimanchal Grameen Bikash Bank Limited", eventType: "MERGED", sourceId: "nrb-bfi-mid-may-2026" },
  ],
  "mfi-026": [
    { alias: "Nepal Sewa Laghubitta Bittiya Sanstha Limited", eventType: "MERGED", sourceId: "nrb-bfi-mid-may-2026" },
    { alias: "WEAN Laghubitta Bittiya Sanstha Ltd.", eventType: "MERGED", sourceId: "nrb-bfi-mid-may-2026" },
  ],
  "mfi-027": [
    { alias: "Sahakarya Laghubitta Bittiya Sanstha Limited", eventType: "MERGED", sourceId: "nrb-bfi-mid-may-2026" },
    { alias: "Unnati Microfinance Bittiya Sanstha Limited", eventType: "MERGED", sourceId: "nrb-bfi-mid-may-2026" },
  ],
  "mfi-030": [
    { alias: "Deurali Laghubitta Bittiya Sanstha Limited", eventType: "ACQUIRED", sourceId: "nrb-bfi-mid-may-2026" },
    { alias: "Aarambha Laghubitta Bittiya Sanstha Ltd.", eventType: "MERGED", sourceId: "nrb-bfi-mid-may-2026" },
    { alias: "Chautari Laghubitta Bittiya Sanstha Limited", eventType: "MERGED", sourceId: "nrb-bfi-mid-may-2026" },
  ],
  "mfi-031": [
    { alias: "Rastra Utthan Laghubitta Bittiya Sanstha Limited", eventType: "ACQUIRED", sourceId: "nrb-bfi-mid-may-2026" },
  ],
  "mfi-034": [
    { alias: "Nepal Agro Laghubitta Bittiya Sanstha Limited", eventType: "ACQUIRED", sourceId: "nrb-bfi-mid-may-2026" },
  ],
  "mfi-036": [
    { alias: "Aarthik Samriddhi Laghubitta Bittiya Sanstha Limited", eventType: "ACQUIRED", sourceId: "nrb-bfi-mid-may-2026" },
    { alias: "Sadhana Laghubitta Bittiya Sanstha Limited", eventType: "ACQUIRED", sourceId: "nrb-bfi-mid-may-2026" },
    { alias: "Sabaiko Laghubitta Bittiya Sanstha Limited", eventType: "MERGED", sourceId: "nrb-bfi-mid-may-2026" },
  ],
  "mfi-037": [
    { alias: "Swadeshi Laghubitta Bittiya Sanstha Limited", eventType: "MERGED", sourceId: "nrb-bfi-mid-may-2026" },
  ],
  "mfi-040": [
    { alias: "Ghodighoda Laghubitta Bittiya Sanstha Limited", eventType: "MERGED", sourceId: "nrb-bfi-mid-may-2026" },
  ],
  "mfi-042": [
    { alias: "Khaptad Laghubitta Bittiya Sanstha Limited", eventType: "MERGED", sourceId: "nrb-bfi-mid-may-2026" },
  ],
  "mfi-043": [
    { alias: "Shaligram Laghubitta Bittiya Sanstha Limited", eventType: "ACQUIRED", sourceId: "nrb-bfi-mid-may-2026" },
    { alias: "Adhikhola Laghubitta Bittiya Sanstha Limited", eventType: "MERGED", sourceId: "nrb-bfi-mid-may-2026" },
  ],
  "mfi-047": [
    { alias: "Jalpa Laghubitta Bittiya Sanstha Limited", eventType: "ACQUIRED", sourceId: "nrb-bfi-mid-may-2026" },
    { alias: "Jalpa Samudayik Laghubitta Bittiya Sanstha Limited", eventType: "ACQUIRED", sourceId: "nrb-bfi-mid-may-2026" },
    { alias: "Mahila Samudayik Laghubitta Bittiya Sanstha Limited", eventType: "ACQUIRED", sourceId: "nrb-bfi-mid-may-2026" },
    { alias: "Creative Laghubitta Bittiya Sanstha Limited", eventType: "MERGED", sourceId: "nrb-bfi-mid-may-2026" },
    { alias: "Dibya Laghubitta Bittiya Sanstha Limited", eventType: "MERGED", sourceId: "nrb-bfi-mid-may-2026" },
    { alias: "Kisan Microfinance Bittiya Sanstha Limited", eventType: "MERGED", sourceId: "nrb-bfi-mid-may-2026" },
    { alias: "NRN Laghubitta Bittiya Sanstha Limited", eventType: "MERGED", sourceId: "nrb-bfi-mid-may-2026" },
    { alias: "Rama Roshan Laghubitta Bittiya Sanstha Limited", eventType: "MERGED", sourceId: "nrb-bfi-mid-may-2026" },
  ],
  "mfi-048": [
    { alias: "Garibi Niunikaran Laghubitta Bittiya Sanstha Limited", eventType: "MERGED", sourceId: "nrb-bfi-mid-may-2026" },
    { alias: "Solve Laghubitta Bittiya Sanstha Limited", eventType: "MERGED", sourceId: "nrb-bfi-mid-may-2026" },
  ],
};
