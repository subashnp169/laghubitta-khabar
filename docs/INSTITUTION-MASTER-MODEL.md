# INSTITUTION-MASTER-MODEL

Canonical institution information architecture. One institution = single entity with canonical identity. Everything else references it.

## Canonical identity (single source of truth)

| Field | Type | Source | Required | Notes |
|---|---|---|---|---|
| `institution_id` | string (stable) | canonical mapping (generated/authoritative) | Y | Never re-use pilot IDs like `mfi-045` style unresolved. Stable across time. |
| `institution_slug` | string (kebab-case) | derived from official name (stable) | Y | Deterministic. No inconsistent slugs. |
| `official_name` | string | NRB/license + official disclosure (verified) | Y | Primary name. |
| `short_name` | string \| null | institution public (if verified) | N | For UI compactness; never invent. |
| `aliases` | string[] | verified public sources/NRB history | N | Historical names/mergers. |
| `license_class` | string (e.g. "D") | NRB | Y | Class-D MFIs. |
| `license_status` | string | NRB | Y | Explicit (ACTIVE/MERGED/ACQUIRED/LIQUIDATED/SUSPENDED/HISTORICAL/LICENSE STATUS UNKNOWN). |
| `coverage_type` | string | data/institutions | Y | From current model. |
| `head_office` | string \| null | verified | Y (presence) | If unknown → `UNKNOWN` state, not empty string implying fact. |
| `operation_date` | string \| null | verified evidence | N | If source anomaly → suppress as fact; display honest state (see existing rules). |
| `working_area` | string \| null | verified | N | Geographic scope. |
| `official_website` | string \| null | verified | N | websiteStatus tracked separately. |
| `digital_presence` | { website: str\|null, status: str\|null, other?: any } | verified | N | No guessing colors/logos. |

## Evidence envelope (applies to public claims)

Every public claim must carry: `source_id`, `source_url` (if known), `grade` (A-D), `observed_at`/`as_of`/`reporting_period`, `verification_status`, `evidence_status` (from vocabulary), `last_verified_at`. Currency rules: RETIRED excluded from current views.

## Institution entity tree

```text
Institution
│
├── Identity (canonical + lifecycle/status)
├── Regulatory Status (license, class, events, NRB refs)
├── Governance
│   ├── Board (Chair/Directors/Independent where public)
│   ├── CEO/MD
│   ├── Senior Management
│   ├── Committees (where public)
│   └── CG Report (document refs)
│
├── People (source-owned assertions; M3.6B semantics frozen)
│
├── Operations
│   ├── Working Area (provinces/districts)
│   ├── Branches (first-class: address, district/province, phone/email, mgr if public, status, history)
│   └── Branch events (open/close/relocate) with evidence
│
├── Financials
│   ├── Current (latest verified per period)
│   ├── Historical (time series, never overwritten)
│   ├── Ratios (only if formula+inputs documented & authoritative)
│   └── Notes (period vs pub date, source)
│
├── Interest Rates
│   ├── Rate items (institution, product/category, rate type, rate, effective date, reporting period, source, evidence)
│   └── Notes (base/premium/spread/distinctions)
│
├── Documents (classified taxonomy)
│   ├── Annual Report / AFS
│   ├── Interim/Quarterly
│   ├── CG Report
│   ├── AGM/Notices (institution)
│   ├── Regulatory Notices (NRB)
│   ├── Interest-rate notices
│   ├── Vacancy/Branch/Merger
│   └── Other prescribed disclosures
│
├── News / Activity (media)
├── Regulatory Events (NRB/authoritative regulatory)
├── Careers
├── Timeline (unified, evidence-backed)
├── Sources & Evidence (provenance, pipeline telemetry where appropriate)
└── Digital Presence (branding only; never overrides facts)
```

## Document taxonomy (detailed)

Classify documents by type (separate from generic bucket):

| Type | Meaning | Source |
|---|---|---|
| `annual_report` | Annual report | Official/NRB where published |
| `audited_financial_statements` | Audited FS | Official/NRB |
| `interim_financial` / `quarterly` | Interim/quarterly | Official/NRB |
| `corporate_governance_report` | CG report | Official/NRB (req) |
| `agm_documents` | AGM docs/notices | Official |
| `notice` | General notice | Official/NRB |
| `regulatory_notice` | NRB notice/circular link | NRB |
| `interest_rate_notice` | Interest rate notice | Official/NRB |
| `vacancy_notice` | Vacancy | Official |
| `branch_notice` | Branch open/close/relocate | Official/NRB |
| `merger_acquisition_notice` | M&A notice | Official/NRB |
| `policy_disclosure` | Policy/public disclosure | Official |
| `nrb_regulatory_document` | NRB directive/circular/pub | NRB |
| `research_report` | External/research artifact | Authoritative |

## Status model (lifecycle)

| Status | Meaning |
|---|---|
| `ACTIVE` | Currently licensed/operating as Class-D MFI (evidence supports). |
| `MERGED` | Merged into another entity (record historical state). |
| `ACQUIRED` | Acquired (historical). |
| `LIQUIDATED`/`CLOSED` | Ceased operations (evidence). |
| `SUSPENDED` | Regulatory suspension (evidence). |
| `HISTORICAL` | Historical entity (queryable but not indistinguishable from current). |
| `LICENSE STATUS UNKNOWN` | No authoritative evidence to determine license status. |

Historical institutions must remain queryable historically; do not present them as current licensed institutions.

## Branch model (first-class)

Each branch (where evidence exists): `branch_name`, `district`, `province`, `municipality/locality`, `address`, `phone`, `email`, `manager` (if publicly disclosed), `source_id`, `source_url`, `observed_at`, `last_verified_at`, `status` (OPEN/CLOSED/RELOCATED/UNKNOWN), `events[]` (history). Unknown ≠ 0. Do not claim complete coverage unless evidence supports.

## Financial model (period discipline)

For each metric/value: `value`, `unit` (NPR/crore/etc), `reporting_period` (FY 2082/83, Q1–Q4, Asar/Chaitra end, etc), `as_of_date`, `publication_date`, `source_id/source_url`, `grade`, `verification_status`, `last_verified_at`. Historical values never overwritten. Distinguish NRB-published vs institution-published vs derived. Only derive ratios if formula+inputs authoritative and documented.

## Interest rates (must include context)

Rate item: `institution_id`, `product/category`, `rate_type` (base/lending/premium/spread/fixed/adjustable/deposit), `rate_value` (numeric or UNKNOWN), `effective_date`, `reporting_period`, `source_id`, `source_url`, `grade`, `observed_at`, `last_verified_at`, `evidence_status`. Never show naked % without explanation; `NOT_EXTRACTED`/`UNKNOWN` if missing.

## Canonical navigation hub

`/institutions/[slug]` is the canonical hub. All cross-links (People→Institution, News→Institution, Documents→Institution, Jobs→Institution, Financials→Institution, NRB events→Institution, Research findings→Institution) must resolve to this slug using canonical identity (no duplicated naming/mapping).