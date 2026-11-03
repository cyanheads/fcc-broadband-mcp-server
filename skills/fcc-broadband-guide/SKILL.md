---
name: fcc-broadband-guide
description: Use fcc_* tools for multi-step broadband gap research, rural or tribal comparisons, and provider investigations. Resolve geographic and holding-company identifiers, align coverage populations, and check sampling and completeness before drawing conclusions.
license: Apache-2.0
metadata:
  author: "cyanheads"
  version: "1.0"
---

## Scope

Use this guide to compare historical fixed broadband gaps, investigate reported providers near a location, or select newer BDC bulk files for separate analysis. The area statistics measure people in coverage brackets, not serviceable addresses or households. Form 477 reporting can overstate coverage within a block; current purchasing decisions and location eligibility require newer location evidence.

## Identifiers

Keep every identifier as a string and carry its geography type or source alongside it.

| Identifier | Provenance and next use |
| --- | --- |
| Geography type and GEOID | Take the pair from fcc_search_geographies into fcc_get_coverage_summary or fcc_compare_areas. County and state IDs also come from fcc_geocode_block. Identical digit lengths do not make county and CBSA codes interchangeable. |
| Tribal area ID | Resolve the name with fcc_search_geographies. Preserve suffixes: a reservation and its off-reservation trust land can be distinct matches. Do not derive these IDs from a state prefix. |
| Holding-company number, hoconum | Take it from fcc_search_providers or an offering in fcc_search_availability into fcc_get_provider. An offering's providerId is a different identifier. |
| BDC as-of date | Request BDC dates with fcc_list_filing_periods using `include_bdc: true`, then select a published BDC date before discovering manifests with fcc_list_downloads. Listing legacy Form 477 periods does not enable historical selection in the analysis tools. |

## Gates

1. Resolve ambiguous geography names before comparing them. Search is a literal name substring, so include a location qualifier and inspect every candidate's type and name. Follow discovery continuation before treating a list as complete. Names alone do not establish exhaustive state membership, especially for CBSAs and tribal areas.
2. Align geography type, technology view, speed tier, and population segment before comparing percentages or counts. A rural-only ranking and an all-population summary have different denominators. A tribal geography and the tribal segment of a county describe different scopes.
3. Check the requested and returned technology views before reusing a baseline across tools or the geography summary resource. Establish whether satellite is included in each view. Technology combinations overlap, so do not sum separate views into a total.
4. Inspect population totals and notices before interpreting a zero percentage. An empty requested segment has no population to assess; it does not establish that residents are fully served or unserved. Keep a missing geography distinct from an empty segment.
5. Check pagination, unmatched-ID guidance, and truncation notices before claiming a statewide ranking or exhaustive provider roster. A sampled provider search remains incomplete even after its returned pages are exhausted; a company absent from that sample is not proven absent from the region.
6. Keep company-wide evidence separate from local evidence. Provider-search filters select matching companies, while their returned state and technology footprints and fcc_get_provider population figures are national. One sampled census block cannot establish every provider serving a county.

## Core chain

For a location investigation, obtain coordinates, resolve the block with fcc_geocode_block, and inspect offerings with fcc_search_availability. Use the returned county ID to obtain area context, and an offering's hoconum for the company's national profile. Report each finding at its actual scope: block offering, county population, or national holding company.

## Workflows

### Rank gaps across a region

For a rural gap shortlist, start with fcc_find_underserved and retain its applied filters when drilling into fcc_get_coverage_summary. For an explicit peer comparison, discover the named geographies, resolve the intended IDs, and pass the set to fcc_compare_areas. Review the entire comparison's notices before calling it complete. Ranking by unserved population prioritizes headcount; ranking by unserved share prioritizes concentration. Every comparison metric ranks the worst coverage first.

For urban/rural or tribal/non-tribal analysis, compare segments within the same geography and baseline. Retain each segment's population beside its percentage. Cross-reference demographic data only after aligning geography and vintage; a county correlation cannot identify individual eligible addresses.

### Investigate a provider

Find the holding company by name with fcc_search_providers, then inspect its profile with fcc_get_provider. If a name-plus-technology search is empty, search the name alone before concluding the company lacks that technology: acquired brands can file under different names within one holding company. Read the company's complete returned technology footprint, and use block availability for local offerings. Deployment technology lists can exceed profile technology lists because profiles count technologies with reported covered population.

### Move to newer evidence

Call fcc_list_filing_periods with `include_bdc: true` and check `hasBdcCredentials`. If credentials are unavailable, stop the BDC chain: legacy dates cannot substitute for BDC dates, and fcc_list_downloads is not advertised. Otherwise select a returned BDC date, then use fcc_list_downloads to discover the relevant files and exhaust manifest continuation. The result supplies file metadata and download URLs; reading and analyzing those files is a separate step. Do not substitute a newer filing date into the fixed-vintage Form 477 tools or treat a manifest as analyzed coverage.
