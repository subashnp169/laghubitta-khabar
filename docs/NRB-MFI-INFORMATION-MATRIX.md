# NRB-MFI-INFORMATION-MATRIX

Candidate information categories classified per §2 (1–8). Not all must be displayed publicly; classification drives display rules.

## 1. Institution identity

| Field | Source | Class | Required? | Freq | Public? | Evidence | Display rule |
|---|---|---|---|---|---|---|---|
| Registered name (official) | NRB/license + MFI official | `REGULATORY_REQUIRED_DISCLOSURE`/`NRB_PUBLISHED_DATA` | Y | Update-on-change | Y | Grade A/B; source+verified | Canonical official_name |
| Short name | MFI official | `INSTITUTION_PUBLIC_INFORMATION` | N | Infrequent | Y | Grade B/D; verified only | Only if verified; else omit |
| Institution code (authoritative) | NRB (if published) | `NRB_PUBLISHED_DATA` | N | Stable | Y | Grade A | Only if authoritative; never guess |
| License class (D) | NRB | `NRB_PUBLISHED_DATA` | Y | Change-based | Y | Grade A | Always |
| License status | NRB | `NRB_PUBLISHED_DATA` | Y | Change-based | Y | Grade A | Explicit lifecycle (ACTIVE/MERGED/ACQUIRED/LIQUIDATED/SUSPENDED/HISTORICAL/UNKNOWN) |
| National/provincial scope | NRB/MFI official | `INSTITUTION_PUBLIC_INFORMATION`/`NRB_PUBLISHED_DATA` | N | Infrequent | Y | Grade A/B | Scope string; Partial if unclear |
| Head office | NRB/MFI official | `REGULATORY_REQUIRED_DISCLOSURE` | Y | Change-based | Y | Grade A/B | UNKNOWN if no evidence |
| Official website | MFI official | `INSTITUTION_PUBLIC_INFORMATION` | N | Change-based | Y | Grade B; websiteStatus | websiteStatus separate; never fabricate |
| Official contact/phone/email | MFI official | `INSTITUTION_PUBLIC_INFORMATION` | N | Change-based | Y | Grade B | Only if publicly disclosed + verified |
| Established date | NRB/MFI (verified) | `INSTITUTION_PUBLIC_INFORMATION` | N | Stable | Y | Grade A/B | Omit if source anomaly/unclear (never sentinel) |
| Operation status | NRB | `NRB_PUBLISHED_DATA` | Y | Change-based | Y | Grade A | Explicit |
| Merger/acquisition status | NRB | `NRB_PUBLISHED_DATA` | Y | Event | Y | Grade A | Timeline + Regulatory Events |
| Current regulatory status | NRB | `NRB_PUBLISHED_DATA` | Y | Change-based | Y | Grade A | Explicit |

## 2. Governance

| Field | Source | Class | Required? | Freq | Public? | Evidence | Display rule |
|---|---|---|---|---|---|---|---|
| Board Chair | MFI official (public) + NRB req | `INSTITUTION_PUBLIC_INFORMATION`/`REGULATORY_REQUIRED_DISCLOSURE` | N | Change-based | Y | Grade A/B; per-assertion (M3.6B) | Source-owned; never single-occupancy assumed |
| Directors | MFI official | `INSTITUTION_PUBLIC_INFORMATION` | N | Change-based | Y | Grade A/B; M3.6B | List all current with evidence |
| Independent Director | MFI official/NRB req | `REGULATORY_REQUIRED_DISCLOSURE` | N | Change-based | Y | Grade A/B | Only if publicly disclosed |
| CEO/MD | MFI official | `INSTITUTION_PUBLIC_INFORMATION` | N | Change-based | Y | Grade A/B; M3.6B | Source-owned, not inferred |
| Senior management | MFI official | `INSTITUTION_PUBLIC_INFORMATION` | N | Change-based | Y | Grade B | Only public disclosures |
| Company secretary | MFI official | `INSTITUTION_PUBLIC_INFORMATION` | N | Change-based | N (if internal) | Grade B | Public only |
| Board committees | MFI official/CG report | `REGULATORY_REQUIRED_DISCLOSURE` | N | Annual/change | Y | Grade A/B | Link to CG report/docs |
| Governance report (CG) | MFI official + NRB req | `REGULATORY_REQUIRED_DISCLOSURE` | N | Annual | Y | Grade A/B | Document ref; `NOT_FOUND`/`NOT_EXTRACTED` if missing (no compliance claim) |
| Code of conduct/policies | MFI official | `INSTITUTION_PUBLIC_INFORMATION` | N | Infrequent | Y | Grade B | Public only if published |

## 3. Operations

| Field | Source | Class | Required? | Freq | Public? | Evidence | Display rule |
|---|---|---|---|---|---|---|---|
| Working area | MFI official/NRB | `INSTITUTION_PUBLIC_INFORMATION` | N | Infrequent | Y | Grade A/B | UNKNOWN/Partial if unclear |
| Provinces | MFI official | `INSTITUTION_PUBLIC_INFORMATION` | N | Change-based | Y | Grade B | Unknown if not extracted |
| Districts | MFI official | `INSTITUTION_PUBLIC_INFORMATION` | N | Change-based | Y | Grade B | Unknown if not extracted |
| Branches (count) | MFI official/NRB (if published) | `INSTITUTION_PUBLIC_INFORMATION` | N | Change-based | Y | Grade A/B | `UNKNOWN`/`NOT_EXTRACTED` if no evidence; never 0 inferred |
| Branch list (first-class) | MFI official | `INSTITUTION_PUBLIC_INFORMATION` | N | Change-based | Y | Grade B | Each with address/district/province/locality/phone/email/mgr/status/events |
| Branch open/close/relocate | MFI official/NRB | `INSTITUTION_PUBLIC_INFORMATION`/`NRB_PUBLISHED_DATA` | N | Event | Y | Grade A/B | Timeline event + evidence |
| Service points/counters | MFI official | `INSTITUTION_PUBLIC_INFORMATION` | N | Change-based | Y | Grade B | Only if authoritative |
| Branch manager (public) | MFI official | `INSTITUTION_PUBLIC_INFORMATION` | N | Change-based | Y | Grade B | Public disclosures only |

## 4. Financial

| Field | Source | Class | Required? | Freq | Public? | Evidence | Display rule |
|---|---|---|---|---|---|---|---|
| Paid-up capital | NRB published + AFS (official) | `NRB_PUBLISHED_DATA`/`INSTITUTION_PUBLIC_INFORMATION` | N | Periodic | Y | Grade A | Period labeled (reporting period vs pub/as_of); never overwrite history |
| Capital fund | NRB/KFIs + AFS | `NRB_PUBLISHED_DATA` | N | Periodic | Y | Grade A | Period discipline |
| Total assets | NRB/KFIs + AFS | `NRB_PUBLISHED_DATA`/`INSTITUTION_PUBLIC_INFORMATION` | N | Periodic | Y | Grade A | Historical preserved |
| Total loan/loan portfolio | NRB/KFIs + AFS | `NRB_PUBLISHED_DATA` | N | Periodic | Y | Grade A | Period+source labeled |
| Total deposits/savings | NRB/KFIs + AFS (if applicable) | `NRB_PUBLISHED_DATA`/`INSTITUTION_PUBLIC_INFORMATION` | N | Periodic | Y | Grade A | Only if applicable; UNKNOWN if not published |
| Borrowings | AFS/NRB | `NRB_PUBLISHED_DATA`/`INSTITUTION_PUBLIC_INFORMATION` | N | Periodic | Y | Grade A | Period labeled |
| Equity | AFS/NRB | `NRB_PUBLISHED_DATA` | N | Periodic | Y | Grade A | Period labeled |
| Profit/Loss (P/L) | AFS/NRB | `NRB_PUBLISHED_DATA`/`INSTITUTION_PUBLIC_INFORMATION` | N | Periodic | Y | Grade A | Period labeled |
| NPL (non-performing loan) | NRB/KFIs + AFS | `NRB_PUBLISHED_DATA` | N | Periodic | Y | Grade A | Metric definition explicit |
| Loan-loss provision | NRB/KFIs + AFS | `NRB_PUBLISHED_DATA` | N | Periodic | Y | Grade A | Definition + period |
| Capital adequacy (CAR/RWA) | NRB/KFIs (prescribed) | `NRB_PUBLISHED_DATA` | N | Periodic | Y | Grade A | Prescribed formula referenced if shown |
| Cost of funds | NRB (prescribed) | `NRB_PUBLISHED_DATA` | N | Periodic | Y | Grade A | Definition explicit |
| Base rate | NRB | `NRB_PUBLISHED_DATA` | N | Periodic | Y | Grade A | See Interest Rates |
| Interest-rate spread | NRB (prescribed) | `NRB_PUBLISHED_DATA` | N | Periodic | Y | Grade A | Definition explicit (not mixed) |
| Other ratios | NRB/KFIs | `NRB_PUBLISHED_DATA` / `DERIVED_BY_LAGHUBITTA_KHABAR` | N | Periodic | Y | Grade A | Only derive if formula+inputs authoritative+documented |

## 5. Interest Rates

| Field | Source | Class | Required? | Freq | Public? | Evidence | Display rule |
|---|---|---|---|---|---|---|---|
| Institution | Canonical | — | Y | Event/change | Y | — | Linked to canonical |
| Product/category | MFI notice/NRB | `INSTITUTION_PUBLIC_INFORMATION`/`NRB_PUBLISHED_DATA` | N | Change-based | Y | Grade A/B | Must specify (never generic) |
| Rate type | MFI notice/NRB | `NRB_PUBLISHED_DATA`/`INSTITUTION_PUBLIC_INFORMATION` | N | Change-based | Y | Grade A/B | base/lending/premium/spread/fixed/adjustable/deposit |
| Rate (value) | MFI notice/NRB | `NRB_PUBLISHED_DATA`/`INSTITUTION_PUBLIC_INFORMATION` | N | Change-based | Y | Grade A/B | UNKNOWN/NOT_EXTRACTED if missing; never 0 inferred; never naked % without context |
| Effective date | MFI notice/NRB | `NRB_PUBLISHED_DATA` | N | Change-based | Y | Grade A | Required for meaningful comparison |
| Reporting period | NRB/MFI | `NRB_PUBLISHED_DATA` | N | Periodic | Y | Grade A | Separate from pub date |
| Source (id/url/title) | Canonical | — | Y | Change-based | Y | Grade A–D | Always shown |
| Last verified | System | — | N | Cadence | Y | Timestamp | Evidence line |

## 6. Documents

| Type | Source | Class | Required? | Freq | Public? | Evidence | Display rule |
|---|---|---|---|---|---|---|---|
| Annual Report | Official | `INSTITUTION_PUBLIC_INFORMATION` | N | Annual | Y | Grade A/B | Classified (not generic) |
| Audited Financial Statements | Official/NRB | `INSTITUTION_PUBLIC_INFORMATION`/`NRB_PUBLISHED_DATA` | N | Annual | Y | Grade A/B | Classified |
| Interim/Quarterly | Official/NRB | `INSTITUTION_PUBLIC_INFORMATION`/`NRB_PUBLISHED_DATA` | N | Quarterly | Y | Grade A/B | Classified |
| CG Report | Official/NRB req | `REGULATORY_REQUIRED_DISCLOSURE` | N | Annual | Y | Grade A/B | Classified; no compliance claim if missing |
| AGM documents/notices | Official | `INSTITUTION_PUBLIC_INFORMATION` | N | Annual/event | Y | Grade B | Classified |
| Notice (general) | Official | `INSTITUTION_PUBLIC_INFORMATION` | N | Event | Y | Grade B | Classified |
| Regulatory notice | NRB | `NRB_PUBLISHED_DATA` | N | Event | Y | Grade A | Classified (NRB regulatory) |
| Interest-rate notice | Official/NRB | `NRB_PUBLISHED_DATA`/`INSTITUTION_PUBLIC_INFORMATION` | N | Event | Y | Grade A/B | Classified |
| Vacancy notice | Official | `INSTITUTION_PUBLIC_INFORMATION` | N | Ad-hoc | Y | Grade B | Classified; links to Careers/Institution |
| Branch notice | Official/NRB | `INSTITUTION_PUBLIC_INFORMATION`/`NRB_PUBLISHED_DATA` | N | Event | Y | Grade B/A | Classified → Branch events/Timeline |
| Merger/acquisition notice | Official/NRB | `NRB_PUBLISHED_DATA` | N | Event | Y | Grade A | Classified → Regulatory Events/Timeline |
| Policy/public disclosures | Official | `INSTITUTION_PUBLIC_INFORMATION` | N | Infrequent | Y | Grade B | Classified |
| NRB regulatory documents | NRB | `NRB_PUBLISHED_DATA` | N | Event/pub | Y | Grade A | NRB section; institution links where identifiable |
| Research/report documents | Authoritative | `PUBLIC_MARKET_INFORMATION`/`OPTIONAL/ENRICHMENT` | N | Ad-hoc | Y | Grade C/D | Research section; link to sources |

## 7. Regulatory/Events/Timeline

| Field | Source | Class | Required? | Freq | Public? | Evidence | Display rule |
|---|---|---|---|---|---|---|---|
| License/establishment | NRB | `NRB_PUBLISHED_DATA` | N | Stable/event | Y | Grade A | Timeline |
| Area expansion | NRB/MFI | `NRB_PUBLISHED_DATA`/`INSTITUTION_PUBLIC_INFORMATION` | N | Event | Y | Grade A/B | Timeline (evidence required) |
| Branch events | Official/NRB | as above | N | Event | Y | Grade B/A | Timeline |
| Capital events | NRB/AFS | `NRB_PUBLISHED_DATA` | N | Event | Y | Grade A | Timeline |
| CEO/Board changes | Official (public) | `INSTITUTION_PUBLIC_INFORMATION` | N | Event | Y | Grade B; M3.6B for people | Timeline + People |
| Regulatory notices | NRB | `NRB_PUBLISHED_DATA` | N | Event | Y | Grade A | Regulatory Events (separate from News) |
| Merger/acquisition | NRB | `NRB_PUBLISHED_DATA` | N | Event | Y | Grade A | Timeline + Status change |
| Name change | NRB/MFI | `NRB_PUBLISHED_DATA`/`INSTITUTION_PUBLIC_INFORMATION` | N | Event | Y | Grade A/B | Timeline + Aliases |
| Interest-rate changes | NRB/MFI notice | `NRB_PUBLISHED_DATA`/`INSTITUTION_PUBLIC_INFORMATION` | N | Event | Y | Grade A/B | Timeline + Interest Rates |
| Important disclosures | Official/NRB | mixed | N | Event | Y | Grade A/B | Timeline/Docs |

## 8. Classification summary (per §2)

| Class | Definition | Treatment |
|---|---|---|
| `REGULATORY_REQUIRED_DISCLOSURE` | Required by NRB directive | Eligible for public display if published; missing → `NOT_FOUND`/`NOT_EXTRACTED`, no non-compliance claim by LK. |
| `REGULATORY_REPORTING_DATA` | Reported to regulator (not necessarily public full set) | Public only where NRB publishes it; else `NOT_PUBLIC`/`DO_NOT_COLLECT`. |
| `NRB_PUBLISHED_DATA` | Published by NRB | Grade A; map to NRB/sections. |
| `INSTITUTION_PUBLIC_INFORMATION` | Public on MFI website/disclosures | Grade B; verify only. |
| `PUBLIC_MARKET_INFORMATION` | Reputable media/market | Grade C. |
| `DERIVED_BY_LAGHUBITTA_KHABAR` | Calculated by us | Must document formula+inputs; label clearly (separate from source data). Never present as NRB data. |
| `OPTIONAL/ENRICHMENT` | Enrichment only | Include only if evidence-backed. |
| `NOT_PUBLIC / DO_NOT_COLLECT` | Not public | Do not collect/display. |

## Rules applied

- No field added just because "useful". Every field needs reason.
- Unknown/Not extracted/Not found/Partial: display honestly (never 0/fabricated).
- Period vs publication date vs effective date vs last verified: distinct.
- M3.6B People semantics frozen.
- Only derive ratios with documented formula+authoritative inputs.
- Historical values never overwritten.