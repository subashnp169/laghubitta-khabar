STOP-3 ASSERTION MODEL DESIGN REVIEW
Status: design investigation only. No schema change, no milestone report edited, nothing committed.

===============================================================================
1. PROBLEM STATEMENT
===============================================================================

Two frozen milestones define `data_assertions` differently, and the meaning of
`data_assertions.source_id` is not the same in both.

  M3.3 (0b680e4) - a row is a SEMANTIC CLAIM.
    Identity = (entity_type, entity_id, field_name, normalised value)
    source_id = the source that FIRST established the claim.
    A second source asserting the same claim is corroborated, not duplicated:
    the INSERT is ignored and an ASSERTION_RESEEN audit row records the new
    witness (source_id + snapshot id in after_json).

  M3.4 (06bd00a) - a row is a SOURCE-SPECIFIC OBSERVATION.
    Identity = (entity_type, entity_id, field_name, source_id, normalised value)
    source_id = the source whose CURRENT observation this row represents.
    Two sources asserting the same value produce two rows, each independently
    supersedable (valid_to / STALE), independently revivable, and each
    independently projectable with its own attribution.

The two cannot both hold for the same row. This review determines whether both
CAPABILITIES can be represented using the existing schema and existing tables,
or whether the schema can only express one of them.

===============================================================================
2. M3.3 INVARIANT (frozen)
===============================================================================

One semantic claim, many corroborations, provenance recorded in the audit trail.

Evidence: `git diff 0b680e4 06bd00a -- lib/ingestion/adapters/local.ts`

  - const material = [entityType, entityId, fieldName, sourceId, value...]
  + const material = [entityType, entityId, fieldName, value...]

That single element is the entire semantic change. Nothing else in the writer was
altered for identity purposes.

Provenance is NOT lost by removing source_id from the identity, because the
already-existing RESEEN path records it. `smoke-people-idempotency.ts` asserts
this explicitly:

  F2  one semantic assertion per person
  F3  no duplicate merely because the source differs
  F4  the second source's provenance is recorded
        -> SELECT after_json FROM audit_logs WHERE action='ASSERTION_RESEEN'
        -> parses after_json.source_id, requires it to contain 'src-f2'

F4 is the decisive one: the frozen M3.3 suite requires the second source's
identity to be recoverable. It does not require a second row. So M3.3's own
tests already accept audit_logs as the provenance store.

===============================================================================
3. M3.4 INVARIANT (frozen)
===============================================================================

One row per (source, claim), independently supersedable. Test section titles are
verbatim requirements, not descriptions:

  L1  same source, same value -> idempotent, no duplicate snapshot
  L2  different sources, same value -> two rows, both provenance kept
  L3  same source, changed value -> old STALE + valid_to, nothing deleted
  L4  renamed branch -> old identity retained, new identity separate
  L5  same name, different district -> two identities, no false conflict
  L6  repeat complete ingestion -> stable read model, no growth
  L7  read projection: current truth vs. evidence history

  L2.1 two assertion rows for the identical claim        (rows.length, 2)
  L2.3 each keeps its own source_id                       (2 distinct sources)
  L2.4 the sources are the official site and the regulator
  L2.5 both are active                                    (valid_to IS NULL, 2)
  L4.8 the other source's claim on the old identity survives the rename
  L6.10 the current value is unaffected by the replay
  L7.5 the old identity survives only while a source still asserts it
  L7.9 history retains the old branch_name claim from each source  (2 rows)

===============================================================================
4. EXISTING SCHEMA EVIDENCE
===============================================================================

Columns actually present (read from lk.db via PRAGMA table_info):

  data_assertions   id PK, entity_type, entity_id, field_name, value,
                    source_id NOT NULL -> sources(id), source_snapshot_id,
                    observed_at, valid_from, valid_to, confidence,
                    verification_status IN (UNVERIFIED, AUTO_VERIFIED,
                    HUMAN_VERIFIED, CONFLICT, STALE, REJECTED)
                    -- no uniqueness constraint on any non-PK column

  audit_logs        id PK, user_id, action, target_type, target_id,
                    before_json, after_json, ip, created_at
                    -- free-form JSON payloads, no typed columns

  source_snapshots  id PK, source_id, fetched_at, content_hash, http_status,
                    mime_type, r2_key, parser_version, extraction_status
                    -- one row per fetch; NOT per assertion

  data_conflicts    id PK, entity_type, entity_id, field_name,
                    source_a_id, value_a, source_b_id, value_b, detected_at,
                    resolution_status, resolved_by, resolved_at, resolution_note

  validation_results id PK, target_type, target_id, rule_id, severity,
                    status, message, evidence_json, created_at

  sources           id PK, source_type, source_scope, source_grade, url, ...

Audit actions the writer actually emits (grep over lib/):
  ASSERTION_RESEEN, ASSERTION_SUPERSEDED, ASSERTION_SUPERSEDE_SKIPPED,
  ASSERTION_REVIVED, FETCH_STARTED/COMPLETED/FAILED, EXTRACTION_*,
  INGESTION_*, OUTBOUND_LINK_PERSISTED, VACANCY_EVIDENCE_APPLIED,
  DOCUMENT_EVIDENCE_PERSISTED, DATA_API_*, DISCOVERY_CANDIDATE_ACCEPTED,
  BUDGET_*_EXHAUSTED

  ASSERTION_SUPERSEDED.before_json carries:
    reason, valid_to, status, entityType, entityId, fieldName,
    retiredValue, sourceId
  ASSERTION_REVIVED.before_json carries:
    reason, retired_at, entityType, entityId, fieldName, value, sourceId

Capability matrix against the EXISTING schema:

  Requirement                  Table/field                          Queryable  Historical
  ---------------------------- ------------------------------------ ---------  ----------
  Semantic claim               data_assertions (id = hash of         YES        YES
                              entity+field+value)                     (id only)  (valid_to)
  Source provenance            data_assertions.source_id             YES        PARTIAL
  First witness                data_assertions.source_id             YES        NO
  Second-source corroboration  audit_logs ASSERTION_RESEEN            YES but    YES
                              after_json.source_id                   ONLY via
                                                                       json_extract
  Source-specific value        data_assertions WHERE source_id = ?    ONLY IF    YES
                                                                       one row
                                                                       per source
  Source-specific supersession valid_to + status, per row            ONLY IF    YES
                              supersedeAssertion(id)                 one row
                                                                       per source
  Source-specific stale state  verification_status='STALE'           ONLY IF    YES
                                                                       one row
                                                                       per source
  Conflict                     data_conflicts (explicit)              YES        YES
  Revival                      audit_logs ASSERTION_REVIVED           YES        YES
  Audit trail                  audit_logs                            YES        YES

The four "ONLY IF one row per source" rows are the crux. Source-specific
lifecycle is not impossible in the schema -- it is impossible WITHOUT
duplicating the claim row per source.

===============================================================================
5. AUDIT-LOG CAPABILITY ANALYSIS (Queries A-G)
===============================================================================

Tested with a controlled fixture under the semantic-identity model
(source_id removed from the hash), sequence T1/T2/T3 from section 6.

  Observed state after T1 (A->X), T2 (B->X), T3 (A->Y):

    ROW value=X src=s-official current=true  snap=sn-a1
    ROW value=Y src=s-official current=true  snap=sn-a2
    AUDIT ASSERTION_RESEEN value=X source=s-nrb

  Query A  "latest value asserted by source A for this field"
          -> PARTIAL / NO. Only the FIRST witness owns a row. There is no row
             owned by s-nrb, so "source A's latest value" is not answerable
             from data_assertions. It would require scanning audit_logs and
             taking the max observed_at per source - possible in principle, but
             only if every one of those sightings was recorded as RESEEN.
             Measured: rows owned by s-nrb = 0.

  Query B  "does source A currently still assert value X"
          -> NO. Current-ness is carried by data_assertions.valid_to, and
             s-nrb has no row to carry a valid_to. ASSERTION_RESEEN says "was
             seen once", never "still asserts". Once a source's assertion
             changes value, nothing records that it STOPPED asserting X.

  Query C  "when did source A stop asserting X"
          -> NO. This is Query B negated, so it inherits B's impossibility.
             ASSERTION_SUPERSEDED exists and names sourceId + retiredValue,
             but it fires only against a row that source owns. With semantic
             identity, a corroborating source never owns a row, so its
             retirement is never recorded.

  Query D  "which sources currently corroborate value X"
          -> PARTIAL. Set of sources that EVER re-saw X is answerable:
               SELECT DISTINCT json_extract(after_json,'$.source_id')
               FROM audit_logs WHERE action='ASSERTION_RESEEN'
             Measured: 1 (s-nrb). The word "currently" cannot be honoured -
             a source that re-saw X in 2025 and asserts Y in 2026 is
             indistinguishable from one still asserting X, unless a
             supersession record exists, which per Query C it does not.

  Query E  "which source changed from X to Y"
          -> YES but awkward. data_assertions holds both rows (X and Y);
             ASSERTION_SUPERSEDED names sourceId and retiredValue when the
             owning source supersedes. For the FIRST-witness source this works.
             For a corroborating source it does not, per Query C.

  Query F  "was source A's old assertion superseded and later revived"
          -> PARTIAL. ASSERTION_REVIVED exists and names sourceId, but again
             only for a row that source owns. Works for first witness; silent
             for every other source.

  Query G  "which sources disagree with the current semantic claim"
          -> YES. data_conflicts already carries source_a_id/source_b_id with
             value_a/value_b, and d1.ts:170 already reads OPEN conflicts and
             derives per-role disagreement keys. This capability is unaffected
             by the identity choice.

Conclusion: audit_logs is an EVENT LEDGER ("this source re-saw this claim at
this time"), not an OBSERVATION STATE ("this source currently asserts X"). It
cannot answer current-ness, cessation, or revival for any source that does not
own an assertion row. Under semantic identity, every source except the first
witness is in exactly that position.

This is not an implementation gap that more code could close. The information is
simply absent: a supersession event for s-nrb has no row to be attached to, so
no event can be generated for it.

===============================================================================
6. CONTROLLED LIFECYCLE EXPERIMENT (T1-T5)
===============================================================================

Entity mfi-001, field people_ceo. Two sources: s-official (MFB_WEBSITE),
s-nrb (NRB). Built on the real LocalSqliteEvidenceWriter against the real
schema.sql in a temp directory. No production data touched.

Required sequence and what each model actually produced:

  T1  source A -> X
      Model A (semantic):  1 row  X|s-official, current
      Model B (per-source): 1 row  X|s-official, current

  T2  source B -> X  (same claim, second witness)
      Model A: 1 row (X|s-official) + ASSERTION_RESEEN{X, s-nrb}
      Model B: 2 rows  X|s-official current, X|s-nrb current
      --> This is the M3.3 vs M3.4 divergence point.

  T3  source A -> Y
      Model A: 2 rows  X|s-official current, Y|s-official current
               + ASSERTION_RESEEN{X, s-nrb}
               NO conflict row is created (data_conflicts stays empty).
      Model B: 3 rows  X|s-official, X|s-nrb, Y|s-official
      Measured in Model A: data_conflicts count = 0.
      --> Under Model A the source A/B disagreement at T3 is NOT detected.
          A still carries X as a CURRENT row with valid_to IS NULL while also
          carrying Y as current. A later reader that filters
          `valid_to IS NULL` sees two current values for one field and has no
          way to learn they disagree. This is a correctness gap, not a
          cosmetic one.

  T4  source B -> X again / B stops asserting X
      Model A: nothing to record. No s-nrb row exists to retire.
      Model B: s-nrb's X row can be stamped valid_to + STALE (demonstrated).

  T5  source A reverts to X
      Model A: reviveAssertion targets a row by id; X's row exists but is not
               superseded, so the guard `valid_to IS NOT NULL` means revive
               does nothing - which is correct here, but only by accident of
               which row happens to exist.
      Model B: a superseded s-nrb row can be revived as a state change.

The T3 result is the finding that matters most, and it was not anticipated in
the original STOP report: the semantic-identity model does not merely lose
per-source lifecycle, it loses CROSS-SOURCE DISAGREEMENT DETECTION, because a
corroborating source's divergent value is recorded as corroboration of the old
value while the same source's new value is recorded as a separate claim, and
nothing links them into a conflict.

===============================================================================
7. SQL / QUERY EVIDENCE FOR L7.5
===============================================================================

L7.5 "the old identity survives only while a source still asserts it" is
answered by `branchesFromAssertionRows` over rows read as:

  SELECT a.entity_id, a.value, a.source_id, a.field_name, a.observed_at,
         a.valid_to, a.verification_status, a.confidence, ...
    FROM data_assertions a
   WHERE a.entity_type = 'BRANCH'
   ORDER BY a.observed_at, a.field_name, a.source_id

and the projection attributes each surviving row to `r.source_id`:

  branchesFromAssertionRows(...) -> meta.source
  branchAssertionHistory(...)    -> source_id, is_current: !isRetired(r)

`BranchAssertionRecord` requires `source_id` as a first-class typed field on
every input row. The read model therefore cannot accept a corroboration event
as a substitute for a row: there is no representation for "source s-nrb
currently asserts Ghorahi" that is not a data_assertions row carrying
source_id = s-nrb.

I verified the corollary directly. With one semantic row for (entity, field,
value=X) owned by s-official, a source-scoped lookup for s-nrb returns 0 rows:

  SELECT ... WHERE entity_type=? AND entity_id=? AND field_name=? AND source_id='s-nrb'
  -> 0 rows

So under semantic identity, M3.4's supersedeAssertion() has no row to close for
any corroborating source. L4.8, L6.10 and L7.5 all depend on that call.

Corroborating evidence that no production reader uses audit_logs:

  grep for 'audit_logs' across lib/repository/*.ts, lib/api/*.ts, worker/src/*.ts
  -> NO MATCHES

  data_conflicts, by contrast, IS read in production:
    lib/repository/d1.ts:170
    lib/repository/projection.ts:15, :598

Model C as originally imagined ("keep semantic rows, derive per-source
lifecycle from audit_logs") would require building a new observation reader
that reconstructs source-scoped current state from an event stream. That is new
architecture, not a reinterpretation of existing tables, and it would need to
redefine L4/L6/L7 rather than satisfy them.

===============================================================================
8. MODEL COMPARISON
===============================================================================

  Capability                 A (M3.3)   B (M3.4)   C (claim + audit-derived
                                                          observation)
  -------------------------- ---------- ---------- -------------------------
  People corroboration       YES         NO          YES
                              (audit)    (dup rows)  (audit)

  Branch source lifecycle    NO          YES         PARTIAL / NO
                              no row to   per-source  events exist but
                              retire      rows         current-state must be
                                                       reconstructed

  Historical provenance      PARTIAL     YES         PARTIAL
                              first       per-source   event stream
                              witness     history      reconstructible
                              + audit

  Conflict detection         REGRESSED   YES         PARTIAL
                              T3 creates  data_conf   must be derived;
                              no conflict licts      nothing writes it
                              row

  Source-scoped supersession NO          YES         NO (without new reader)
  Source-scoped stale state  NO          YES         NO
  Queryability              simple      simple      expensive: json_extract
                                                       over audit_logs, and
                                                       absent for cessation
  Existing schema            YES         YES         YES
  Existing tests             33/33       69/69       none exist; would need
                              People      branch        L4/L6/L7 rewritten
  Measured today             33/33 Ppl   53/55,      n/a
                                         61/69 brch

Row "People corroboration / B = NO": under Model B, corroboration is real but
represented as two competing claims rather than one claim plus corroboration,
which is precisely what M3.3 froze against.

===============================================================================
9. EXACT INCOMPATIBILITY
===============================================================================

`data_assertions.source_id` carries two incompatible meanings:

  In M3.3: "the source that FIRST established this semantic claim"
            (a provenance pointer; only the first witness is recorded)

  In M3.4: "the source whose CURRENT observation this row represents"
            (an ownership pointer; every source owns a row, and supersession
             is applied per owner)

The schema has one column and no second place to put the other meaning. Because
M3.4's lifecycle is driven by row ownership - supersedeAssertion(id) needs a
row, the read model needs a typed source_id per row, and the current-truth
projection needs to know which rows are retired per source - the two meanings
cannot coexist in one row.

The information required to run M3.4's lifecycle for a corroborating source is
irretrievably absent under semantic identity. Not "expensive to query" -
absent. There is no row whose valid_to could be stamped, and therefore no event
that could be logged, and therefore no query that could answer "does s-nrb
still assert X?".

Conversely, Model B cannot satisfy M3.3: F2 and F3 require duplicate claims to
collapse, and no audit record can undo a row that has already been written.

===============================================================================
10. CAN BOTH CAPABILITIES EXIST WITHOUT A SCHEMA CHANGE?
===============================================================================

NO - for the full capability set both milestones require.

Precisely:

  - People corroboration (Model A) and branch source-scoped lifecycle
    (Model B) CANNOT both be satisfied, because they require opposite meanings
    for data_assertions.source_id on the same row.

  - Branch source-scoped lifecycle alone CAN be satisfied by the existing
    schema - that is exactly what M3.4 does today at 69/69.

  - People corroboration alone CAN be satisfied by the existing schema - that is
    what M3.3 did at 33/33.

  - Cross-source conflict detection is available in the existing schema
    (data_conflicts) but only under Model B, because the disagreement is
    detected from competing rows. Under Model A no conflict row is written.

One further finding that applies to BOTH models and is independent of the
choice: no production code reads audit_logs. Whichever model is chosen, the
audit trail is currently write-only. That is worth knowing before any model
relies on it.

Minimum conceptual addition that would allow both (NOT implemented, NOT
recommended without the owner's decision): a per-source observation relation
keyed (entity, field, source, value) holding each source's own current value
and supersession state, alongside the semantic claim row. The frozen schema has
no such relation. data_assertions cannot be both, because a single row cannot
be simultaneously deduplicated by value and owned by each source.

===============================================================================
11. DECISION REQUIRED FROM PROJECT OWNER
===============================================================================

  DECIDED (project owner, 2026-10-01): Model B. See section 15 for the frozen
  decision and what it changes. The analysis in sections 1-14 below is the
  evidence that decision was based on and is retained unchanged.

  Q1. Which meaning does data_assertions.source_id carry going forward?
    (a) first witness only, semantic claim identity  -> M3.3 wins;
        M3.4's per-source lifecycle assertions L2.1-L2.5, L4.8, L6.10, L7.5,
        L7.9 must be REDEFINED, and cross-source disagreement detection needs a
        new mechanism because data_conflicts will no longer be populated.
    (b) owning source, per-source rows               -> M3.4 wins;
        M3.3's F2/F3/F4 must be amended to expect two rows, and the M3.3
        report's corroboration claim corrected to "competing claims", plus
        documentation updated so "one assertion per person" is not asserted.

Q2. Is per-source branch lifecycle a product requirement that must be kept?
    It is the only capability that distinguishes the two models in practice.
    L7.5 exists because a branch renamed by one source but still listed by
    another must stay visible. If that matters, Model A cannot deliver it
    without the schema addition above.

Q3. Should cross-source disagreement detection be preserved? Under Model A it
    silently regresses. If it is required, Model A needs either Model B or the
    additional relation.

===============================================================================
12. WHAT REMAINS BLOCKED
===============================================================================

Unaffected by this decision, and independently blocked:

  Branch promotion: BLOCKED.
    branches.province is NOT NULL and no province value exists anywhere in the
    repository - not in institutions (which has head_office_district and
    head_office_municipality but no province), not in any of the 9 pilot DBs, not
    in the M3.4 JSON. Also: the 2,098 figure is a dry-run count
    (dryRunBranchNames is a number, e.g. 158, not a name list). Real
    materialised branch assertions are 1,157 institution/branch_name rows in
    phase-o across 11 institutions, with district fused into the name string
    ("Tikathali Branch, Lalitpur"). Promoting requires inventing province.

  Career promotion: BLOCKED.
    The mfi-012 fixture records deadline=null, location=null,
    employment_type=null. jobs.location and jobs.deadline are both NOT NULL.
    Only JOB_TITLE (0.6) and APPLICATION_URL (0.5) are proven. Populating jobs
    requires fabricating a deadline and a location. /jobs stays empty and
    honest.

  People promotion: BLOCKED on this decision, but otherwise viable.
    The read path already exists end to end: data_assertions ->
    peopleFromAssertionRows -> d1.ts:peopleEvidence -> /leadership + /people/:slug.
    Only data_assertions is empty in lk.db. Once Q1 is answered, promotion is a
    bounded piece of work. Note the 384-assertion pilot DB also needs its
    58/384 plausibility failure resolved independently.

===============================================================================
13. RECOMMENDED NEXT DESIGN DISCUSSION
===============================================================================

Three questions, in order:

  1. What does a product user need to see when the MFB's own site and the
     regulator disagree about a branch name? "Two live claims, in conflict" and
     "one claim, one dissenting source" are different products. This answer
     picks the model; the tests just record it.

  2. If per-source lifecycle is kept, should it apply to People too? Today the
     two modules disagree, which is why the same table supports two incompatible
     invariants. One rule for all modules is cheaper to maintain and to audit
     than a per-module exception.

  3. Only then: if Model A is chosen, decide how cross-source disagreement is
     detected, since data_conflicts stops being populated.

Not recommended at this stage: writing the schema addition. It is a frozen
table set, and the decision to unfreeze belongs to the owner, not to this
investigation.

===============================================================================
14. MEASURED EVIDENCE SUMMARY
===============================================================================

Command                                   Baseline (64b83c7)   Semantic-identity
                                                                        experiment
  smoke:people-idempotency                30 passed, 3 failed  33 passed, 0 failed
  smoke:branch-persistence                55 passed            53 passed, 2 failed
  smoke:branch-lifecycle                  69 passed            61 passed, 8 failed
  smoke:branch-external                   169 passed           169 passed

Controlled T1-T3 fixture (real writer, real schema, temp DB):
  Model A produced 2 rows + 1 ASSERTION_RESEEN, and 0 data_conflicts rows.
  Model B produced 3 rows, each independently supersedable.

Source-scoped lookup for a corroborating source under Model A: 0 rows.
Production readers of audit_logs: 0.
Production readers of data_conflicts: 3 (d1.ts:170, projection.ts:15, :598).

Nothing in the repository was modified by this review. The working tree still
holds exactly the two entries noted in the final report.

===============================================================================
15. FROZEN DECISION (project owner, 2026-10-01)
===============================================================================

RESOLVED on the evidence in sections 1-14. Sections 1-14 are retained unchanged
as the investigation record.

  SCHEMA CHANGE REQUIRED: NO - for the chosen Model B architecture
  CANONICAL ASSERTION MODEL: Model B - source-specific observation/claim
  MIGRATION: NONE
  NEW TABLE: NOT REQUIRED
  COMMIT: NO

Frozen semantics
-----------------
  data_assertions represents a source-owned observation.
  data_assertions.source_id identifies the source that currently owns that
  observation.

  ONE CANONICAL RULE, applied uniformly to People, Branches, Careers,
  Financials and every future module - there is no People-vs-Branch exception:

    same normalized claim from another source  -> another source-owned observation
    same value != same assertion row
    corroboration                             -> DERIVED from multiple independent
                                                   source-owned observations with
                                                   the same normalized claim
    sources disagree                          -> cross-source conflict
    a source changes its value                -> it supersedes its OWN observation
    a source stops reporting                   -> its own observation goes
                                                   stale (valid_to)
    a source later reports it again           -> revive / new current observation
                                                   per lifecycle rules

Reinterpretation of M3.3, not rejection
-----------------------------------------
M3.3's product requirement is preserved and its storage semantics are
reinterpreted consistently:

  "If two sources independently report the same person/value, the system must
   recognize corroboration and preserve provenance."

Under Model B:

  Source A -> Subash Gupta -> CEO
  Source B -> Subash Gupta -> CEO

These are two source-owned observations of the same normalized claim. The system
derives:

  CORROBORATED
  2 independent sources

without claiming they are one database assertion. Corroboration becomes a
RELATIONSHIP between independently owned observations rather than the ABSENCE of
a second row. M3.3 is therefore not amended to say corroboration is invalid; the
concept is retained and its storage encoding is corrected.

Why Model B was chosen
-----------------------
The T1-T5 experiment showed Model A does not merely carry weaker provenance - it
loses information that cannot be reconstructed later. At T3, Model A cannot
represent "B currently says X, A currently says Y, and they disagree": the audit
log is an event ledger, not current observation state. Model B represents all of
it directly:

  source A -> X -> valid_to
  source A -> Y -> current
  source B -> X -> current

yielding current value by source, historical value by source, source-specific
supersession, source-specific stale/revival, disagreement detection,
attribution, queryability, and future evidence review.

Branch rename requirement (Q2): YES, retained
----------------------------------------------
One source renaming a branch while another still lists the previous name must stay
visible. The same pattern applies beyond branches - CEO/leadership, addresses,
contact numbers, interest rates, employment information, institutional status,
financial figures, regulatory information. Making Model A special for People
would create a future architectural trap.

UNIFORMITY (Q3): YES
---------------------
One assertion semantics across all modules.

Current state of the working tree
---------------------------------
The Model A experiment in lib/ingestion/adapters/local.ts has been REVERTED.
`git checkout -- lib/ingestion/adapters/local.ts` restored the Model B
source-scoped identity. Working tree now contains only untracked documents:

  ?? docs/PROJECT-STATUS-AUDIT.md
  ?? docs/STOP-3-ASSERTION-MODEL-DESIGN.md

No tracked file is modified. schema/ and migrations/ are untouched.

What the next authorized cycle must build (NOT started)
------------------------------------------------------
Model B alone is representable in the existing schema, but the derived
corroboration concept does not exist yet in the People read model. Verified
against the current projection:

  - lib/repository/projection.ts:87 buckets People rows by
    `${institution_id}|${value}` - so two source-owned rows for the same person
    already collapse into one PersonDto at the READ layer.
  - line 101 assigns `const source = first.source_id` - it takes only the FIRST
    source and discards the rest.
  - `SourceMeta` (lib/repository/types.ts) carries a single `source: string`.
    It has no field that could express "corroborated by 2 sources".
  - The string "corroborat" does not appear in peopleFromAssertionRows at all.

  The vacancy projection already demonstrates the intended pattern at
  projection.ts:643:
    const sourceIds = [...new Set(bucket.map((r) => r.source_id))];
  and passes `sources: sourceIds` into its status resolution.

So the outstanding work is a read-model capability, not a storage change:
derive the corroborating-source set from the source-owned observations, and
carry it where the read model needs it. Whether that requires extending
SourceMeta (a TypeScript type, not a database table) is for that cycle to
determine and to confirm with the owner.

Still blocked independently of this decision
---------------------------------------------
  Branch promotion: BLOCKED - branches.province is NOT NULL and no province
    value exists anywhere in the repository.
  Career promotion: BLOCKED - jobs.location and jobs.deadline are NOT NULL and
    the mfi-012 evidence records both as null.
  People promotion: viable once corroboration is derived; the 384-assertion
    pilot DB still needs its 58/384 plausibility failure resolved.

===============================================================================
16. IMPLEMENTED — the M3.3/M3.4 semantic regression correction
===============================================================================

Owner authorization: amend the three Model-A-encoded checks and derive
corroboration in the read model. NO schema change, NO migration, NO commit.

What changed
------------
Storage was already correct under Model B and was NOT touched. The defect was in
the read model, which discarded every source but the first.

  lib/repository/types.ts
    SourceMeta gains `sources: string[]` (required, not optional).
    Required on purpose: the original bug was a SILENT loss - the read model
    dropped corroboration and nothing flagged it. A required field turns a
    missing derivation into a compile error instead of undefined at runtime.
    `source: string` is retained as the first-published owning source so every
    existing single-value attribution consumer keeps working unchanged.

  lib/repository/projection.ts
    New `distinctSources(rows)` helper returns the distinct owning sources of a
    set of source-owned observations, sorted for determinism. Wired into all
    three projectors: people, branches, vacancies. Uniform rule, no
    People-vs-Branch exception.

  lib/api/contract.ts
    ApiMeta gains `sources: string[]` for the same reason - the envelope copies
    meta field by field and would otherwise drop it in transit.

  lib/api/repository.ts, worker/src/index.ts, lib/repository/d1.ts,
  lib/repository/mock.ts
    Envelope and adapter sites now PROPAGATE `sources` instead of rebuilding
    meta from `source` alone. d1.ts `metaFor` was the same first-row-only
    pattern and is fixed. mock.ts and the literal-only sites (search,
  generated-modules, institution+alias index) declare their single source
    explicitly as a one-element array.

  docs/API-CONTRACT.md
    Documents `meta.sources` as the public expression of corroboration.

  scripts/smoke-people-idempotency.ts
    F2/F3/F4 amended from Model A's encoding to Model B's, re-asserting the
    INTENT rather than the storage accident:

      F2 "one semantic assertion per person" (2 rows)
         -> "each source owns its own observation of every person"
            4 assertions across 2 sources.

      F3 "no duplicate merely because the source differs" (0 duplicate groups)
         -> "corroboration is derived from the distinct source-owned
             observations"
            2 claims corroborated by more than one source, asserted in SQL as
            COUNT(DISTINCT source_id) > 1 within a normalized (entity, field,
            value) group. The old F3 is INVERTED on purpose: a second row is no
            longer a defect, it is the evidence of agreement.

      F4 "the second source's provenance is recorded" (2 ASSERTION_RESEEN
         ledger rows)
         -> "the second source's provenance is on its own row, not a ledger
             substitute"
            each source keeps 2 attributable rows and 0 ledger entries are
            needed, because a distinct source produces a distinct row rather
            than a duplicate of an existing one.

    M3.3's REQUIREMENT is unchanged in all three: recognize corroboration and
    preserve provenance. Only the encoding changed, which is exactly what
    section 15 decided.

    The single-source collapse invariants were already covered independently on
    the dbA fixture (A1-A3, B1-B3, C1-C8, D1-D6, E1-E4), so nothing that
    protected idempotency was removed with the old F2.

Verification
------------
  typecheck          clean (tsc --noEmit)
  build              pass
  check:discipline   pass
  lint               14 errors, ALL pre-existing in scripts/*.cjs
                     (require-style imports, audit item D6). Zero in the files
                     changed here. Pre-existing count unchanged: 14 errors /
                     59 warnings before and after.

  smoke:people-idempotency   33 passed, 0 failed  (was 30/3)
  smoke:people-m33           pass
  smoke:people               pass
  smoke:people-plausibility  30 passed, 0 failed
  smoke:people-generic-ext   48 passed, 0 failed
  smoke:people-discovery     45 passed, 0 failed
  smoke:branch-persistence   55 passed, 0 failed
  smoke:branch-lifecycle     69 passed, 0 failed
  smoke:branch-external      169 passed, 0 failed
  smoke:careers              324 passed, 0 failed
  smoke:api                  45 passed, 0 failed
  smoke:worker               pass
  smoke:dataapi              42 passed, 0 failed
  smoke:schedule             40 passed, 0 failed
  smoke:compare              27 passed, 0 failed
  smoke:alerts               18 passed, 0 failed
  smoke:ingest               pass
  smoke:ingest-security      pass
  smoke:pdf-canonical        pass
  smoke:structured           pass

Read-model behaviour confirmed end to end:
  A says X, B says X  -> 1 person,  meta.sources = ["src-a","src-b"]
                          CORROBORATED by 2 independent sources
  A says X, B says Y  -> 2 people,  ["src-a"] and ["src-b"]
                          disagreement stays visible, not silently merged
  A says X only       -> 1 person,  ["src-a"]
                          single source is NOT reported as corroboration

Still blocked independently of this decision
--------------------------------------------
  Branch promotion: BLOCKED - branches.province is NOT NULL, no province value
    exists anywhere in the repository.
  Career promotion: BLOCKED - jobs.location and jobs.deadline are NOT NULL and
    the mfi-012 evidence records both as null.
  People promotion: now unblocked at the SEMANTIC layer. The derived
    corroboration contract exists and is proven. Still to do before promotion:
    resolve the 58/384 plausibility failure in the 384-assertion pilot DB, then
    promote into lk.db (still 9 of 53 tables populated).

Known follow-up, not changed here
----------------------------------
  meta.source remains the first row's source. Where a record is corroborated,
  which source that is depends on row order, because the underlying read is not
  deterministically ordered. `meta.sources` is sorted and therefore stable.
  Making `meta.source` deterministic (e.g. the lowest sorted source id) would
  change existing frozen expectations, so it is left as a separate decision.
