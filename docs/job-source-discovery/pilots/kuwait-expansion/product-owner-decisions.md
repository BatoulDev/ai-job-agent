# Product-Owner Decision Items — Kuwait Expansion (Final, Pass 6)

Every item below has a **final decision** for this pass. Per this pass's explicit instruction, a well-supported hold that is excluded from promotion is a valid, complete resolution — it does not need to become an approval to count as "resolved." No item below is left as a silently-ambiguous staged row.

## A. Americana Group lineage / canonical-ID policy

**Entities in play:** `cc-americana-group` (existing `kuwait.csv` row: "Americana Group (Kuwait Food Company)", legal name "Kuwait Food Company (Americana) K.S.C.P.", founded 1964, KSE ticker FOOD.KW). "Americana Restaurants International plc" (supplied lead #93, held) — own site states its history as originating "in Kuwait back in 1964" and being "publicly traded on the Kuwait Stock Exchange," the identical founding fact used for `cc-americana-group`. "Americana Foods" (supplied lead #30, held) — official domain americanafoods.com, confirmed real Kuwait bakery factory since 1985, publicly the packaged/manufactured-foods side of a 2022 corporate split.

**Repository precedent checked:** the master-company-registry.csv does not carry a separate "Americana Restaurants International" or "Americana Foods" row in any other market (UAE/Qatar/Saudi/Lebanon) — this pass found no cross-market entity to collide with, and no other market's pilot has resolved this same lineage question.

**Final decision: KEEP HELD, EXCLUDED FROM PROMOTION.** Neither "Americana Restaurants International plc" (#93) nor "Americana Foods" (#30) is staged. No production ID is touched, renamed, merged, or split this pass. The specific unresolved human choice is: whether `cc-americana-group`'s legal name/ticker should be updated to reflect the post-2022 restructuring, and whether #93 is the same legal entity under a new trading name (→ `duplicate_or_alias`) or a genuinely distinct successor (→ a new `cc-americana-restaurants-international` row). This requires a direct read of americanarestaurants.com's own corporate-history/investor-relations page, which this tool could not reliably render this pass — a human or browser-equipped pass should do this before any change. **This hold is a complete, safe resolution for this pass and does not block `READY_TO_APPLY_CORRECTIONS`**, since #93 and #30 are both excluded from the promotable subset in `final-promotion-eligibility-manifest.csv`.

## B. Hilton brand-versus-property policy

**Precedent comparison across this project's actual staged rows:**

| Brand | Treatment | Basis |
|---|---|---|
| Marriott | 3 specific property rows staged (Courtyard, JW Marriott, Marriott Executive Apartments — all Kuwait City) | Each had its own confirmed live listing on the official Marriott ATS filtered to Kuwait |
| Millennium | 2 specific property rows staged (Millennium Hotel & Convention Centre, Millennium Central Downtown) | Each had its own confirmed property-specific ATS subdomain with live listings |
| Hyatt | 2 specific property rows staged (Grand Hyatt Kuwait, Hyatt Regency Kuwait) | Each confirmed via an official Hyatt newsroom press release (a fallback tier since the live ATS was blocked), naming the specific property |
| Four Seasons | 1 specific property row staged (Four Seasons Hotel Kuwait at Burj Alshaya) | Confirmed via the official careers domain showing Kuwait-specific live roles |
| Radisson | 1 specific property/market row staged (Radisson Hotel Group — effectively Radisson Blu Hotel, Kuwait) | Confirmed via the official Radisson ATS showing Kuwait-specific live roles by sub-location |
| IHG | **NOT staged** — held at brand level | No single confirmed property could be tied to a specific live job; 2 specific properties found (Holiday Inn Kuwait Salmiya, Al Thuraya City) were logged as separate independent-discovery candidates, also held, not staged |
| Accor | Not present in this project's Kuwait leads at all — no precedent to compare |

**The consistent rule across every brand actually staged in this project is: stage a specific named property with its own confirmed evidence, never a market-level or brand-level row.** Hilton's own official ATS domain (jobs.hilton.com) was found this project, with one job-detail URL (Concierge Agent, Al Farwaniya) that does not cleanly map to any of the 4 confirmed named Kuwait Hilton properties (Hilton Garden Inn Kuwait/The Avenues, Waldorf Astoria Kuwait, Hampton by Hilton Kuwait Salmiya, Hilton Kuwait Mangaf Resort).

**Final decision: `hold_manual_review`, EXCLUDED FROM PROMOTION.** A brand-level "Hilton Worldwide"/"Hilton Kuwait" row was briefly staged in an earlier pass and correctly reverted by the adversarial audit for violating exactly this policy — that reversion stands as the final state. No Hilton row is staged. The specific remaining human choice: confirm one specific property (Hilton Garden Inn Kuwait is the best-evidenced candidate, having its own official hotel page with a hotel code) with a matching live `jobs.hilton.com` posting, then stage that single property the same way Marriott/Millennium/Hyatt/Four Seasons/Radisson were staged. **This hold is a complete, safe resolution and does not block `READY_TO_APPLY_CORRECTIONS`.**

## C. Three flagged name-mixup candidates

### C1. SSC HR Solutions (supplied lead #44) ↔ SOS HR Solutions
**Identity:** the real "SSC HR Solutions" (ssc-hr.com) operates only in Saudi Arabia/Egypt/UAE — no Kuwait presence. A distinct, genuinely Kuwait-based firm, "SOS HR Solutions" (soshr.net, est. 1975), was found with live current vacancies and a direct contact channel. Single-letter transposition, identical business type, only Kuwait-based match found across two passes.
**Final decision: KEEP HELD at `hold_manual_review`, EXCLUDED FROM PROMOTION.** High confidence this is a transcription error, but first-party identity evidence for the *exact supplied name* "SSC HR Solutions" as a Kuwait entity does not exist — approving would mean staging a company under a name it may not actually use. The specific remaining human choice: confirm whether to re-file this lead under "SOS HR Solutions" and promote that entity instead.

### C2. Aloula (supplied lead #119) ↔ Al Oula Steel Manufacturing Company
**Identity:** real official domain is `oulasteel.com` (a prior wrong guess of `al-oula.net` was corrected). Al Oula Steel Manufacturing Company is Kuwait's first and only steel plant (est. 2003, Fahaheel), with its own careers page (`oulasteel.com/career`). This pass's 79-candidate Boursa verification surfaced a **third** same-name-adjacent entity: Boursa ticker `ALOLA` = "First Investment Company" (`fic.com.kw`), completely unrelated. A fourth, the Saudi "Aloula Aviation," was already ruled out in an earlier pass as a different market entirely.
**Final decision: KEEP HELD, EXCLUDED FROM PROMOTION.** With now 3–4 distinct "Al Oula/Aloula"-adjacent entities identified across different contexts, this is genuinely more ambiguous than a simple typo — approving any one of them under the supplied lead's identity without confirmation would risk staging the wrong company. The specific remaining human choice: confirm which entity (most likely Al Oula Steel Manufacturing Company, the only Kuwait-domiciled real-economy operator among the candidates) was actually intended.

### C3. Anton (supplied lead #3) ↔ Anton Oilfield Services Group (#4) ↔ Anton-OSS
**Identity:** Anton Oilfield Services Group's own domain (antonoil.com) remains technically unreachable (persistent TLS certificate error across 3 passes) but is independently confirmed real and active in Kuwait via multiple reputable trade-press sources reporting a KD35 million KOC maintenance contract. "Anton-OSS" is a specifically-branded entity with sustained, recurring Kuwait recruiting activity (2023 and 2026 postings) but no dedicated official domain of its own.
**Final decision: KEEP HELD, EXCLUDED FROM PROMOTION.** "Anton-OSS" is very likely Anton Oilfield Services Group's Kuwait-market operating name, but this has not been first-party confirmed (antonoil.com itself has never successfully loaded across 3 passes). The specific remaining human choice: a browser or a different fetch path to antonoil.com to confirm the Anton-OSS relationship directly, after which #3 would become `duplicate_or_alias` of #4.

## D. New disambiguation surfaced this project (not one of the original 3, same risk class): KIC / KIA / KINS

Three near-identically-named, near-identically-domained Kuwait "Kuwait Investment/Insurance ..." entities were confirmed genuinely distinct during the 79-candidate Boursa verification:
- **Kuwait Investment Authority (KIA)** — `kia.gov.kw`, the sovereign wealth fund, already `already_present` in `kuwait.csv` (`cc-kuwait-investment-authority`).
- **Kuwait Investment Company (KIC, Boursa ticker KINV)** — `kic.com.kw`, a private listed investment firm, 117 employees. **Final decision: `hold_manual_review`, excluded from promotion** (identity/domain confirmed, careers page not individually verified).
- **Kuwait Insurance Company (KINS)** — `kic-kw.com`, an insurer, already staged from an earlier pass (`cc-kuwait-insurance-company`).

**No merge, no ID collision.** All three are correctly kept as three separate entities across `kuwait.csv` (KIA), `kuwait-promotion-staging.csv` (KINS), and the held Boursa walk (KINV). Flagged here explicitly so a future pass never conflates them based on name/domain similarity alone.

## Summary — promotion impact of this section

| Item | Final decision | Staged? | Blocks READY_TO_APPLY_CORRECTIONS? |
|---|---|---|---|
| Americana lineage | Hold, excluded | No | No |
| Hilton brand/property | Hold, excluded | No | No |
| SSC ↔ SOS HR Solutions | Hold, excluded | No | No |
| Aloula ↔ Al Oula Steel (↔ 2 more) | Hold, excluded | No | No |
| Anton ↔ Anton-OSS ↔ Anton Oilfield | Hold, excluded | No | No |
| KIC ↔ KIA ↔ KINS | Disambiguated, KINV held/excluded | No (KINV) | No |

Every item has a final, documented, safe decision. None is silently ambiguous inside `kuwait-promotion-staging.csv` — all are either fully excluded (held) or, where already staged under a different, unambiguous identity, correctly and permanently kept apart.
