# NRB-SOURCE-MAP

Mapping NRB publications/categories to Laghubitta Khabar sections (logical mapping; physical extraction not implied). Based on NRB directives/publications referenced.

## NRB publication categories (logical)

| NRB publication/category | What it contains (regulatory scope) | Laghubitta Khabar section(s) | Evidence role | Public? |
|---|---|---|---|---|
| Unified Directive for "D" Class Licensed Microfinance Financial Institutions (2082) | Licensing, disclosure, governance, reporting, financial formats, ratios, interest rate requirements, consumer protection | Institutions (Regulatory), Governance, Financials, Interest Rates, Documents, NRB (Directives) | Primary (Grade A) — regulatory requirements/reporting | Yes (public directive) |
| MFI Situation / "Situation of Microfinance Institutions" | Sector-level/state of MFIs (coverage, status, aggregate/periodic) | NRB (MFI Situation), Research (sector context) | Grade A (published data) | Yes |
| Key Financial Indicators (KFIs) | Periodic financial indicators by MFI/sector | NRB (KFIs), Financials (ratios/indicators), Research | Grade A (NRB published data) | Yes |
| Interest Rates (MFI interest-rate structures) | Base rate/lending/deposit/structures, effective/reporting periods | NRB (Interest Rates), Interest Rates (per-institution), Institutions (Interest Rates) | Grade A | Yes |
| Progress Reports | Sector progress, developments | NRB (Progress Reports), Research | Grade A | Yes |
| Sources and Uses | Sources/uses of funds (sector/periodic) | NRB (Sources & Uses), Financials, Research | Grade A | Yes |
| Circulars/Amendments | Updates to directives, clarifications, effective dates | NRB (Circulars), Institutions (Regulatory Events/Timeline), Regulatory | Grade A | Yes |
| Supervision/Publications (relevant) | Supervision-related publications/events where public | NRB (Supervision), Institutions (Regulatory Events) | Grade A | Conditional (public items only) |
| Corporate Governance/Disclosure requirements | Governance report, disclosures | Governance, Documents (Governance), Institutions (Governance) | Grade A (requirements) | Evidence of published disclosures only |
| Financial Reporting/Prescribed formats | Annual/interim, prescribed ratios, NPL, provisioning, CAR, spread, cost of funds | Financials, Documents, NRB (Reports) | Grade A | Yes |

## Field classification mapping (candidate → section)

| Candidate field groups | Source class (from §2) | Primary source | Laghubitta Khabar canonical section | Notes |
|---|---|---|---|---|
| Identity (name, license class/status, head office, website, established/op status, mergers) | `NRB_PUBLISHED_DATA` / `REGULATORY_REQUIRED_DISCLOSURE` / `INSTITUTION_PUBLIC_INFORMATION` | NRB (license/status), MFI official | Institutions (Identity), Timeline | Prefer NRB for regulatory status; MFI official for public contact where verified. |
| Governance (Board/Chair/CEO/Directors/Senior Mgmt, committees, CG report) | `INSTITUTION_PUBLIC_INFORMATION` + `REGULATORY_REQUIRED_DISCLOSURE` | MFI official (published), NRB (requirements) | Governance (Institutions), People | People use M3.6B source-owned assertions. Do not infer single-occupancy. |
| Operations (working area, provinces/districts, branches, openings/closures/relocations) | `INSTITUTION_PUBLIC_INFORMATION` / `NRB_PUBLISHED_DATA` (where published) | MFI official + NRB where published | Operations/Branches (Institutions), Timeline | Unknown ≠ 0. Branches first-class. |
| Financials (capital, assets, loans, deposits/savings, equity, P/L, NPL, prov, CAR, cost of funds, spread, ratios) | `NRB_PUBLISHED_DATA`, `INSTITUTION_PUBLIC_INFORMATION`, `DERIVED_BY_LAGHUBITTA_KHABAR` | NRB published datasets + audited FS (official) | Financials, Institutions (Financials) | Period discipline (reporting period vs pub date). Only derive ratios with documented formula+authoritative inputs. |
| Interest Rates (product/rate type, base/premium/spread, effective date, period) | `NRB_PUBLISHED_DATA` / `INSTITUTION_PUBLIC_INFORMATION` | NRB MFI interest rates + MFI notices (official) | Interest Rates, Institutions (Interest Rates) | Never naked %. Must include product/category, effective date, source, evidence. |
| Documents (AR, AFS, interim/quarterly, CG report, AGM, notices, regulatory, vacancy, branch, merger) | `INSTITUTION_PUBLIC_INFORMATION` / `NRB_PUBLISHED_DATA` | Official sources + NRB | Documents (classified), Institutions (Documents) | Classify (not generic bucket). Distinguish NRB regulatory docs vs institution docs. |
| Regulatory Events (notices, actions, mergers, name changes, status changes) | `NRB_PUBLISHED_DATA` / `REGULATORY_REPORTING_DATA` | NRB (circulars/events), official | Institutions (Regulatory Events/Timeline), NRB (Regulatory Events) | Timeline events require evidence. |
| News/Activity (media) | `PUBLIC_MARKET_INFORMATION` | Reputable media (Grade C) | News/Activity | Separate from regulatory events and documents. |
| Careers | `INSTITUTION_PUBLIC_INFORMATION` | MFI official | Careers | Link back to institution. |

## Principle

NRB = regulatory evidence/reference layer. Laghubitta Khabar = intelligence/product layer. Do not mirror NRB design; map NRB information requirements to canonical institution model.