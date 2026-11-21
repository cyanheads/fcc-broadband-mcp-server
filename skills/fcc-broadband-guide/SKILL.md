---
name: fcc-broadband-guide
description: Use fcc_* tools for multi-step broadband gap research, rural or tribal comparisons, and provider investigations. Resolve geographic and holding-company identifiers, align coverage populations, and check sampling and completeness before drawing conclusions.
license: Apache-2.0
metadata:
  author: "cyanheads"
  version: "1.1"
---

## Scope

Use this guide to compare historical fixed broadband gaps, investigate reported providers near a location, or select newer BDC bulk files for separate analysis. The area statistics measure people in coverage brackets, not serviceable addresses or households. Form 477 reporting can overstate coverage within a block; current purchasing decisions and location eligibility require newer location evidence.

## Identifiers

Keep every identifier as a string and carry its geography type or source alongside it.

| Identifier | Provenance and next use |
| --- | --- |
| Geography type and GEOID | Take the pair from fcc_search_geographies into fcc_get_coverage_summary or fcc_compare_areas. County and state IDs also come from fcc_geocode_block. Identical digit lengths do not make county and CBSA codes interchangeable. |
| Tribal area ID | Resolve the name with fcc_search_geographies. Preserve suffixes: a reservation and its off-reservation trust land can be distinct matches. Do not derive these IDs from a state prefix. |
| Holding-company number, hoconum | Take it from fcc_search_providers or a block offering into fcc_get_provider for the national profile. On the offering, providerId identifies the Form 477 filing. Use frn for a registration lookup, keeping any leading zeros, and dbaName for the reported trading name. |
| Filing date | Use fcc_list_filing_periods to find dates with an Area Table for historical coverage. To find newer bulk files, request BDC dates with `include_bdc: true` and pass a BDC date to fcc_list_downloads. |

## Gates

1. Resolve ambiguous geography names before comparing them. Search is a literal name substring, so include a location qualifier and inspect every candidate's type and name. Follow discovery continuation before treating a list as complete. Names alone do not establish exhaustive state membership, especially for CBSAs and tribal areas.
2. Carry the filing date, geography type, technology view, speed tier, and population segment from a ranking into its drill-down. For trends crossing December 2020, compare the population totals as well as the unserved counts. The difference alone cannot tell you how many residents gained service. Standalone name discovery uses 2021 names, so use the name returned with the historical coverage result when describing that filing.
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

Call fcc_list_filing_periods with `include_bdc: true` and check `hasBdcCredentials`. If credentials are unavailable, stop the BDC chain. Otherwise select a returned BDC date, then use fcc_list_downloads to discover the relevant files and exhaust manifest continuation. The result supplies file metadata and download URLs. Read the files to analyze their coverage.
