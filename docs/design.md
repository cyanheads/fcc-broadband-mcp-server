# fcc-broadband-mcp-server — Design

## MCP Surface

### Tools

| Name | Description | Key Inputs | Annotations |
|:-----|:------------|:-----------|:------------|
| `fcc_search_availability` | Queries broadband providers and advertised speeds at a census block, filtered by technology and speed threshold. Answers "which ISPs serve this location and what speeds do they offer?" — the starting point for any address-level broadband lookup. Requires a 15-digit census block FIPS code; use `fcc_geocode_block` to convert coordinates first. | `block_fips`, `tech_filter`, `min_speed_down`, `consumer` | `readOnlyHint: true, openWorldHint: false` |
| `fcc_get_coverage_summary` | Returns a broadband coverage summary for a geography — population with zero, one, two, or three-plus providers at a given speed threshold, split by urban/rural and tribal/non-tribal. Primary tool for digital divide and equity analysis. Supports state, county, congressional district, census place, CBSA, tribal area, and national level. | `geography_type`, `geography_id`, `tech_filter`, `speed_down`, `urban_rural_filter`, `tribal_filter` | `readOnlyHint: true, openWorldHint: false` |
| `fcc_compare_areas` | Compares broadband coverage metrics across multiple geographies of the same type and returns a ranked table sorted by unserved or underserved population. Answers "which counties in this state have the worst broadband access?" and drives BEAD funding prioritization. | `geography_type`, `geography_ids`, `compare_all_states`, `tech_filter`, `speed_down`, `sort_by` | `readOnlyHint: true, openWorldHint: false` |
| `fcc_search_providers` | Searches for ISPs by holding company name, filtered by state and technology type. Returns a deduplicated list of matching providers with `hoconum` identifiers for follow-up calls. Answers "which ISPs serve Washington with fiber?" and "find all Comcast entities." Geographic filtering is state-level; sub-state granularity requires cross-referencing block data. The live path reads a bounded window of deployment rows to find which companies match and reports `scanTruncated` when that set is a sample rather than every match; each company it returns then carries its complete national states and technologies, resolved per company. | `name_search`, `state`, `tech_filter` | `readOnlyHint: true, openWorldHint: false` |
| `fcc_get_provider` | Returns a national-level coverage profile for a specific holding company (by `hoconum`): technologies deployed and the population covered at each download speed tier, taken from the provider summary table's all-technology roll-up. | `hoconum` | `readOnlyHint: true, openWorldHint: false` |
| `fcc_find_underserved` | Finds geographic areas with limited or no broadband coverage at a given speed threshold, ranked by underserved population. Accepts a state to narrow scope or runs nationwide. The core tool for BEAD program analysis and broadband equity research. Defaults to rural areas where underservice is most concentrated. | `state`, `geography_type`, `speed_down`, `tech_filter`, `min_unserved_pop`, `urban_rural_filter`, `limit` | `readOnlyHint: true, openWorldHint: false` |
| `fcc_geocode_block` | Converts a latitude/longitude coordinate to a census block FIPS code (15-digit), county FIPS, county name, state FIPS, state code, and state name. Required prerequisite for `fcc_search_availability` since the broadband dataset is indexed by census block, not address. Uses FCC's public Geo API — no auth required. | `latitude`, `longitude` | `readOnlyHint: true, openWorldHint: false, idempotentHint: true` |
| `fcc_list_filing_periods` | Returns the available data vintages: Form 477 filing periods (hardcoded Jun 2015 – Jun 2021, always available) and BDC as-of dates from the authenticated API (Jun 2022 onward, requires credentials). Call this before `fcc_list_downloads` to determine valid `as_of_date` values. | `include_bdc` | `readOnlyHint: true, openWorldHint: false` |
| `fcc_list_downloads` | Lists downloadable BDC data files for a specific as-of date — fixed availability by state and provider, mobile coverage, and challenge data — with file metadata (provider, state, technology, record count). Download URLs are included for each file. Requires BDC API credentials. | `as_of_date`, `data_type`, `state`, `provider_name`, `technology_type` | `readOnlyHint: true, openWorldHint: false` |

### Resources

| URI Template | Description | Pagination |
|:-------------|:------------|:-----------|
| `fcc-broadband://geography/{type}/{id}/summary` | Broadband coverage summary for a specific geography: provider counts by speed tier, urban/rural split, tribal breakdown. Addressable by type and GEOID. | No — single-geography summary |
| `fcc-broadband://providers/list/{offset}` | One page of the Form 477 holding-company directory: `hoconum` identifiers from the provider summary table, each resolved to a company name, plus the directory total. Reference for picking a `hoconum` before calling `fcc_get_provider`. | Yes — 25 per page, offset cursor, `nextOffset` in the response |

### Prompts

| Name | Description | Args |
|:-----|:------------|:-----|
| `broadband_equity_analysis` | Structures a digital divide analysis comparing broadband access across demographic groups — guides chaining with Census and BLS data. | `region`, `focus` (`underserved`, `rural`, `tribal`, `all`) |

---

## Overview

`fcc-broadband-mcp-server` wraps three FCC data sources:

1. **Form 477 public data via FCC Open Data (Socrata)** — block-level and summary broadband deployment data filed by ISPs for 2015–June 2021. No auth required. Powers the availability search, coverage summary, comparison, and provider tools. June 2021 is the last Form 477 filing period before BDC replaced it.

2. **BDC Public Data API (`bdc.fcc.gov/api/public/map/`)** — post-2022 Broadband Data Collection filing periods and bulk download manifests. Requires account-based auth (email + hash token from broadbandmap.fcc.gov "Manage API Access"). Powers `fcc_list_filing_periods` and `fcc_list_downloads`. Note: BDC data is only accessible as bulk CSV downloads, not row-queryable via API.

3. **FCC Geo API (`geo.fcc.gov/api/census`)** — converts lat/lon to census block FIPS codes, county, and state. No auth required. Powers `fcc_geocode_block`.

The digital divide and broadband equity angle is the dominant use case: an agent can compare broadband coverage against Census demographic data, BLS remote-work statistics, or CDC telehealth access patterns in a few tool calls. The BEAD (Broadband Equity, Access, and Deployment) program makes this a live policy topic.

---

## Requirements

- All Form 477 data tools (`fcc_search_availability`, `fcc_get_coverage_summary`, `fcc_compare_areas`, `fcc_search_providers`, `fcc_get_provider`, `fcc_find_underserved`, `fcc_geocode_block`) work without any credentials
- BDC download tools (`fcc_list_filing_periods` with `include_bdc=true`, `fcc_list_downloads`) require a free FCC user account at broadbandmap.fcc.gov; credentials provided via env vars
- No write operations — all data is ISP-reported and read-only
- Geographic queries use FIPS codes; `fcc_geocode_block` bridges from coordinates
- Form 477 data covers 2015–June 2021; BDC data covers June 2022 onward — the server bridges both eras, with a data gap noted in tool descriptions
- Data is US federal government public domain (17 USC §105) — safe to distribute and cache
- Rate limits: Socrata is generous for reasonable use; FCC Geo API has no documented limit; BDC API is 10 calls/min per account

---

## Services

| Service | Wraps | Used By |
|:--------|:------|:--------|
| `OpenDataService` | FCC Open Data Socrata API (`opendata.fcc.gov/resource/`) | `fcc_search_availability`, `fcc_get_coverage_summary`, `fcc_compare_areas`, `fcc_search_providers`, `fcc_get_provider`, `fcc_find_underserved` |
| `BdcApiService` | BDC Public Data API (`bdc.fcc.gov/api/public/map/`) | `fcc_list_filing_periods`, `fcc_list_downloads` |
| `GeoApiService` | FCC Geo API (`geo.fcc.gov/api/census`) | `fcc_geocode_block` |

---

## Config

| Env Var | Required | Description |
|:--------|:---------|:------------|
| `FCC_BDC_USERNAME` | Optional | FCC account email for BDC API. Without this, `fcc_list_downloads` and BDC-era `fcc_list_filing_periods` return a `credentials_required` error. |
| `FCC_BDC_HASH_VALUE` | Optional | API token hash from broadbandmap.fcc.gov "Manage API Access" page. Paired with `FCC_BDC_USERNAME`. |
| `FCC_OPENDATA_APP_TOKEN` | Optional | Socrata app token. Increases rate limits; not required for functionality. |

---

## Implementation Order

1. Config and server setup
2. `GeoApiService` — single endpoint, no auth, validates the service pattern
3. `fcc_geocode_block` — validates the geo service
4. `OpenDataService` — Socrata client with dataset ID constants and retry logic
5. `fcc_get_coverage_summary` — single-geography area table query
6. `fcc_search_availability` — block-level deployment data query
7. `fcc_search_providers` and `fcc_get_provider` — provider table queries
8. `fcc_compare_areas` — multi-geography summary comparison
9. `fcc_find_underserved` — filtered area table with sorting
10. `BdcApiService` — authenticated BDC client
11. `fcc_list_filing_periods` and `fcc_list_downloads`
12. Resources and prompt

Each step is independently testable.

---

## Tool Detail

### `fcc_get_coverage_summary`

**Input schema:**
```ts
{
  geography_type: z.enum(['nation', 'state', 'county', 'cd', 'place', 'cbsa', 'tribal'])
    .describe('Geographic aggregation level. "nation" = US-wide totals (id not needed). "cd" = congressional district. "place" = census-designated place. "cbsa" = core-based statistical area (metro area). "tribal" = tribal land area.'),
  geography_id: z.string().optional()
    .describe('FIPS GEOID for the geography. State: 2-digit (e.g., "06" for California). County: 5-digit (e.g., "06037" for LA County). Congressional district: 4-digit state+district (e.g., "0601"). CBSA: 5-digit code. Omit for nation-level queries.'),
  tech_filter: z.enum(['acfosw', 'f', 'c', 'a', 'o', 's', 'w'])
    .default('acfosw')
    .describe('Technology filter. "acfosw" = any wired or fixed wireless (recommended baseline). "f" = fiber only. "c" = cable only. "a" = ADSL/DSL only. "s" = satellite only. "w" = fixed wireless only. Mix letters for combinations, e.g., "fc" = fiber or cable.'),
  speed_down: z.enum(['0.2', '4', '10', '25', '100', '250', '1000'])
    .default('25')
    .describe('Minimum download speed threshold in Mbps. 25 = FCC legacy broadband definition. 100 = BEAD program standard (use this for current policy analysis). "0.2" = any service above 200 Kbps.'),
  urban_rural_filter: z.enum(['all', 'R', 'U'])
    .default('all')
    .describe('Filter to urban ("U") or rural ("R") areas only, or "all" for both combined. Rural breakdown is key for BEAD program analysis.'),
  tribal_filter: z.enum(['all', 'T', 'N'])
    .default('all')
    .describe('Filter to tribal ("T") or non-tribal ("N") areas. Use "T" to assess Native American connectivity gaps.'),
}
```

**Output schema:**
```ts
{
  geography: z.object({ type: z.string(), id: z.string(), name: z.string().optional() }),
  tech_filter: z.string(),
  speed_down_mbps: z.number(),
  population: z.object({
    no_coverage: z.number().describe('Population living where zero providers offer service at the given speed.'),
    one_provider: z.number().describe('Population with exactly one provider — no competitive choice.'),
    two_providers: z.number(),
    three_or_more_providers: z.number(),
    total: z.number(),
  }),
  coverage_pct: z.number().describe('Percentage of population with at least one provider at the given speed.'),
  unserved_pct: z.number().describe('Percentage with zero providers — FCC "unserved" definition.'),
  competitive_pct: z.number().describe('Percentage with two or more providers.'),
  breakdown: z.array(z.object({
    urban_rural: z.enum(['R', 'U']),
    tribal: z.enum(['T', 'N']),
    population: z.object({ no_coverage: z.number(), one_provider: z.number(), two_providers: z.number(), three_or_more_providers: z.number(), total: z.number() }),
    coverage_pct: z.number(),
    unserved_pct: z.number(),
  })).describe('Per-segment breakdown by urban/rural and tribal/non-tribal.'),
}
```

**Error contract:**
- `geography_not_found` (`NotFound`): Geography ID not in dataset. Suggest checking FIPS code format or calling `fcc_list_filing_periods`.
- `invalid_geography_combo` (`InvalidParams`): `geography_id` omitted for a non-nation type, or `geography_type` is `nation` but `geography_id` provided.

---

### `fcc_search_availability`

**Input schema:**
```ts
{
  block_fips: z.string().regex(/^\d{15}$/)
    .describe('15-digit census block FIPS code on 2010 census boundaries (e.g., "530330081002024"). Obtain from fcc_geocode_block using address coordinates.'),
  tech_filter: z.array(z.enum(TECH_CODES))
    .optional()
    .describe('Technology codes to filter, from the complete Form 477 taxonomy: 0=All other, 10=Asymmetric xDSL, 11=ADSL2, 12=VDSL, 20=Symmetric xDSL, 30=Other copper wireline, 40=Cable modem, 41=Cable modem DOCSIS 1/1.1/2.0, 42=Cable modem DOCSIS 3.0, 43=Cable modem DOCSIS 3.1, 50=Fiber to the end user, 60=Satellite, 70=Terrestrial fixed wireless, 90=Electric power line. Omit to return all technologies.'),
  min_speed_down: z.number().min(0).optional()
    .describe('Minimum advertised download speed in Mbps to include. Omit to return all regardless of speed.'),
  consumer: z.boolean().optional()
    .describe('Filter to consumer service (true) or business service (false). Omit for both.'),
}
```

**Output:** Array of provider records per block, each with `provider_id`, `providername`, `holdingcompanyname`, `hoconum`, `techcode`, `maxaddown`, `maxadup`, `consumer`, `business`.

**Error contract:**
- `block_not_found` (`NotFound`): No providers in the dataset for this census block. Block may be a non-residential area or have no reported coverage.

---

### `fcc_search_providers`

**Input schema:**
```ts
{
  name_search: z.string().optional()
    .describe('Partial holding company name to search (case-insensitive). e.g., "Comcast", "T-Mobile", "Frontier". Omit to list all providers in a state.'),
  state: z.string().regex(/^[A-Z]{2}$/).optional()
    .describe('2-letter state abbreviation to limit results to providers serving that state.'),
  tech_filter: z.array(z.enum(TECH_CODES)).optional()
    .describe('Technology codes to filter, from the complete Form 477 taxonomy (0, 10–12, 20, 30, 40–43, 50, 60, 70, 90). Omit for all technologies.'),
  limit: z.number().int().min(1).max(200).default(50)
    .describe('Max providers to return.'),
}
```

**Output:** Deduplicated list of matching providers: `hoconum`, `holdingcompanyname`, `states_served` (array of state abbreviations), `tech_codes` (unique codes across all filings).

---

### `fcc_compare_areas`

**Input schema:**
```ts
{
  geography_type: z.enum(['state', 'county', 'cd', 'place', 'cbsa', 'tribal']),
  geography_ids: z.array(z.string()).min(2).max(50).optional()
    .describe('Array of FIPS GEOIDs to compare. Up to 50 geographies. For all 50 states, omit and set compare_all_states=true.'),
  compare_all_states: z.boolean().default(false)
    .describe('When true, compares all 50 states + DC. Overrides geography_ids. Useful for national ranking.'),
  tech_filter: z.enum(['acfosw', 'f', 'c', 'a', 'o', 's', 'w']).default('acfosw'),
  speed_down: z.enum(['0.2', '4', '10', '25', '100', '250', '1000']).default('25'),
  sort_by: z.enum(['unserved_pct', 'unserved_pop', 'coverage_pct', 'competitive_pct'])
    .default('unserved_pct')
    .describe('Ranking field. "unserved_pct" = share of population with no broadband. "unserved_pop" = raw headcount useful for BEAD funding allocation. "coverage_pct" = share with any coverage. "competitive_pct" = share with 2+ providers. Every option ranks worst-first, so rank 1 is the highest unserved share or headcount, or the lowest coverage or competitive share.'),
}
```

---

### `fcc_find_underserved`

**Input schema:**
```ts
{
  state: z.string().regex(/^[A-Z]{2}$/).optional()
    .describe('2-letter USPS state or territory code (e.g., "WY", "MS", "PR") to limit scope. An unrecognized code is rejected, not ignored. Omit for nationwide search — returns top areas only.'),
  geography_type: z.enum(['county', 'cd', 'place', 'cbsa']).default('county')
    .describe('Geographic granularity. "county" is most useful for policy analysis and BEAD eligibility.'),
  speed_down: z.enum(['0.2', '4', '10', '25', '100', '250', '1000']).default('25'),
  tech_filter: z.enum(['acfosw', 'f', 'c', 'a', 'o', 's', 'w']).default('acfosw'),
  min_unserved_pop: z.number().int().min(0).default(1)
    .describe('Minimum population with no coverage to include in results. Defaults to 1, which keeps fully covered areas out of a ranking of underserved ones. Set to 0 to rank every area regardless of unserved population, or higher to drop small gaps (e.g., 500 keeps only areas with at least 500 unserved residents).'),
  urban_rural_filter: z.enum(['all', 'R', 'U']).default('R')
    .describe('Defaults to rural ("R") — where underservice is most concentrated. Use "U" to find underserved urban areas (digital redlining research). Set to "all" for both.'),
  limit: z.number().int().min(1).max(100).default(20),
}
```

---

### `fcc_list_downloads`

**Input schema:**
```ts
{
  as_of_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
    .describe('BDC as-of date in YYYY-MM-DD format (e.g., "2024-06-30"). Get valid dates from fcc_list_filing_periods.'),
  data_type: z.enum(['availability', 'challenge']).default('availability')
    .describe('"availability" = ISP-reported coverage files (by state and provider). "challenge" = consumer and government dispute records.'),
  category: z.enum(['Summary', 'State', 'Provider']).optional()
    .describe('File category. "State" = per-state coverage files. "Provider" = per-provider files. "Summary" = aggregate coverage tables.'),
  technology_type: z.enum(['Fixed Broadband', 'Mobile Broadband', 'Mobile Voice']).optional(),
  state: z.string().regex(/^[A-Z]{2}$/).optional()
    .describe('Filter to one state\'s files.'),
  provider_name: z.string().optional()
    .describe('Partial provider holding company name to filter results.'),
  limit: z.number().int().min(1).max(200).default(50)
    .describe('Maximum number of files to return on one page.'),
  offset: z.number().int().min(0).default(0)
    .describe('Zero-based index of the first file to return, within the files matching the filters.'),
}
```

**Paging:** one as-of date can carry thousands of per-provider files, so the manifest comes back a page at a time. `output.totalFiles` counts every file matching the filters; the `offset`, `pageSize`, `count`, `nextOffset`, and `truncated` enrichment fields describe the page. `nextOffset` is present only while another page exists, and the notice separates an offset past the end from a filter set that matched nothing. Whether the BDC download endpoints accept paging parameters of their own is unestablished — the response envelope carries `result_count` but no cursor or offset field — so the window is cut server-side over the single upstream response.

**As-of date validation** runs in two stages, split by what each one needs. A date that is not on the calendar, or that falls before `BDC_FIRST_AS_OF_DATE` (2022-06-30), is answerable from the string alone and is rejected ahead of the credentials check. Membership in the published set is only knowable from the credentialed `/listAsOfDates` endpoint, so it runs after that check; the answer is memoized for an hour so the check does not double every call against the API's 10-calls-per-minute budget.

**Error contract:**
- `credentials_required` (`Unauthorized`): `FCC_BDC_USERNAME` or `FCC_BDC_HASH_VALUE` env vars not set. Set them from the broadbandmap.fcc.gov "Manage API Access" page.
- `invalid_as_of_date` (`ValidationError`): the date is not on the calendar, predates the first BDC filing period, or is not among the as-of dates the BDC API publishes. The thrown `recovery.hint` says which of the three it was.

---

## Domain Mapping

### Dataset IDs (Form 477, FCC Open Data — `opendata.fcc.gov`)

| Dataset | Socrata ID | Content | Last Filing Period |
|:--------|:-----------|:--------|:-------------------|
| Fixed Broadband Deployment (Jun 2021) | `jdr4-3q4p` | Block-level: provider × block × technology × speed. Also the source for provider name + `hoconum` crosswalk via `$group`. | Jun 2021 |
| Area Table (Jun 2021) | `xvwq-qtaj` | Geography-level: population by provider-count bracket × speed tier × urban_rural × tribal segment | Jun 2021 |
| Provider Summary Table (Jun 2021) | `yd9y-6jqe` | Provider × tech covered population (national totals only, no state breakdown; no holding-company name column). `d_1`–`d_8` = download speed tiers (0.2/4/10/25/100/250/500/1000 Mbps). `u_1`–`u_9` = upload tiers. `tech` carries both individual Form 477 codes and the overlapping roll-ups `all`, `adsl`, `cable`, `other` — the `all` row is the non-overlapping national total, so rows must never be summed. | Jun 2021 |
| Provider Geographic Footprint | `awrw-t4m8` | `hoconum` → bounding box only. Not a name crosswalk — names must come from `jdr4-3q4p`. | Updated |
| Geography Lookup | `v5vt-e7vw` | GEOID → name, centroid lat/lng, bounding box. Use to resolve geography IDs to human-readable names in tool output. | Updated |

### Area Table Schema (`xvwq-qtaj`)

| Field | Values | Notes |
|:------|:-------|:------|
| `type` | `nation`, `state`, `county`, `cd`, `place`, `cbsa`, `tribal` | Geography level — `nation` uses `id='0'` |
| `id` | FIPS GEOID string | `'0'` for nation, `'06'` for state, `'06037'` for county |
| `tech` | Letter combinations: `a`=ADSL, `c`=cable, `f`=fiber, `o`=other, `s`=satellite, `w`=wireless | Combined letters = any of those technologies |
| `urban_rural` | `R` (rural), `U` (urban) | Single letter — not the full word |
| `tribal_non` | `T` (tribal), `N` (non-tribal) | Single letter |
| `speed` | `'0.2'`, `'4'`, `'10'`, `'25'`, `'100'`, `'250'`, `'1000'` | Mbps download threshold; string type |
| `has_0` | integer (as string) | Population with zero providers at this speed |
| `has_1` | integer (as string) | Population with exactly one provider |
| `has_2` | integer (as string) | Population with exactly two providers |
| `has_3more` | integer (as string) | Population with three or more providers |

Multiple rows per geography — one per `urban_rural` × `tribal_non` combination (4 combos max). Aggregate by summing across the relevant rows.

### Deployment Table Schema (`jdr4-3q4p`)

Key fields: `blockcode` (15-digit FIPS), `provider_id`, `frn`, `providername`, `holdingcompanyname`, `hoconum`, `stateabbr`, `techcode`, `maxaddown`, `maxadup`, `consumer`, `business`.

Tech codes: 0 = All other, 10–12 = DSL (ADSL, ADSL2, VDSL), 20 = DSL (symmetric xDSL), 30 = Other copper wireline, 40–43 = Cable modem (unqualified, DOCSIS 1/1.1/2.0, DOCSIS 3.0, DOCSIS 3.1), 50 = Fiber to premises, 60 = Satellite, 70 = Fixed wireless, 90 = Electric power line. `TECH_CODES` and `TECH_CODE_LABELS` in `src/services/open-data/types.ts` are the single source — the dataset's own `techcode` column definition is quoted there.

---

## Workflow Analysis

### "What broadband is available at this address?"

| # | Tool | Purpose |
|:--|:-----|:--------|
| 1 | `fcc_geocode_block` | Convert address coordinates → 15-digit census block FIPS |
| 2 | `fcc_search_availability` | Query providers for that census block |
| 3 | `fcc_get_coverage_summary` | Get county-level context (how does this area compare to its peers?) |

### "Find rural counties for BEAD funding analysis" (digital divide chain)

| # | Tool / Chain | Purpose |
|:--|:-------------|:--------|
| 1 | `fcc_find_underserved` | Ranked list of most-underserved rural counties |
| 2 | Census `census_compare_geographies` | Cross-reference income, demographics, remote work rates |
| 3 | Congress `congressgov_bill_summaries` | Find BEAD program appropriations for the region |
| 4 | BLS labor data | Remote work capability by county |

### "Compare broadband across a state"

| # | Tool | Purpose |
|:--|:-----|:--------|
| 1 | `fcc_compare_areas` | Ranked table of all counties in state by unserved population |
| 2 | `fcc_get_coverage_summary` | Drill into worst-performing counties |
| 3 | `fcc_search_providers` | Which ISPs operate in those counties? |

---

## Design Decisions

**Tool prefix: `fcc_` not `fcc_broadband_`.** The server name `fcc-broadband-mcp-server` implies the prefix is `fcc_broadband_`, but that makes every tool name 17+ characters before the verb-noun pair. The server's context makes "broadband" implicit — `fcc_get_coverage_summary` is clearer than `fcc_broadband_get_coverage_summary`. Short, clear prefixes reduce cognitive load in tool-selection contexts.

**Auth-optional design.** The BDC tools require credentials but the server runs without them — those tools return `credentials_required` with a clear setup hint. The no-auth tools always work. This mirrors the actual data access model: most analysis uses the public Socrata data; the BDC download API serves bulk data processing and data pipeline workflows.

**Form 477 vs. BDC.** The Form 477 datasets (2015–2021) are queryable row-by-row via Socrata. The post-2022 BDC data is only accessible via bulk CSV downloads from the authenticated API — not row-level queries. The server wraps what's queryable at the row level. A future enhancement could pre-load and index BDC CSVs into a local DuckDB instance; this design scopes to the API-accessible layer and notes the data ceiling clearly.

**Area Table aggregation for equity analysis.** The raw deployment table (`jdr4-3q4p`) has ~50M rows — block × provider × technology. Querying it for equity analysis at county scale requires expensive aggregation. The Area Table (`xvwq-qtaj`) is pre-aggregated at the geography level with population-by-provider-count breakdowns, which is exactly what equity analysis needs. The deployment table is reserved for `fcc_search_availability` (block-level, geographically scoped queries).

**No address → availability in one call.** The FCC broadband map web UI offers address lookup, but that endpoint requires session auth (confirmed: 401 with credentials, 405 without for all tested paths). The correct programmatic path is: geocode coordinates → census block FIPS → query deployment table. The `fcc_geocode_block` tool handles step one.

**Provider search is state-level, not sub-state.** The deployment table (`jdr4-3q4p`) indexes providers by `stateabbr`, not by county or CBSA FIPS. Sub-state provider geographic filtering would require a block-code cross-reference (expensive, ~50M rows). `fcc_search_providers` therefore accepts `state` as a filter, not `geography_type` + `geography_id`. For "which ISPs serve King County?", the practical path is `fcc_search_availability` on a representative census block in that county, not a geographic provider filter.

**Provider names come from the deployment table, one hoconum at a time.** The provider lookup dataset (`awrw-t4m8`) contains only bounding box coordinates, and the provider summary table (`yd9y-6jqe`) has no name column at all — `jdr4-3q4p` is the only source. It offers no shape that returns many names in one pass: `$group` over it is bounded by how many rows match before grouping rather than by the key list (measured 2026-08-13 — 5.2s for a 25-key `hoconum IN (…)`, 44s for one large carrier), and an ungrouped `hoconum IN (…)` window fills with whichever company has the most block rows. So `hoconum` → name resolution is a `$where=hoconum='<id>'&$limit=1` point query per company, indexed and sub-second, run a few at a time. The `fcc-broadband://providers/list/{offset}` resource enumerates from `yd9y-6jqe` and decorates each page this way; `fcc_get_provider` uses the same point query for its one name.

**Provider search reads a window, not an aggregate.** `fcc_search_providers` cannot group the deployment table either — the same bound applies, and a `LIKE '%fragment%'` on `holdingcompanyname` cannot use an index, so no filter combination keeps a grouped search inside the 30s budget. It instead reads a bounded window of raw matching rows (unordered, since `$order` sorts the whole match before the window is taken and collapses the page onto one company) and deduplicates by `hoconum` server-side. Window size is the whole design: cost tracks how far Socrata scans to collect `$limit` matching rows, so a wide window buys sample breadth on common names and pays for it on the rare ones — measured 2026-08-13, 20,000 rows answered `'%Tele%'` in 1.5s but took 44s for one small carrier's full name and 42s for a name matching nothing, both of which are exactly what a caller resolving a name to a `hoconum` types. At 1,000 rows every measured shape lands in 0.2–7s. The result is a sample: `scanTruncated` says so, and no match total is reported while it is true, because computing one needs the grouping that does not work. Deployment rows are per census block, so a match of almost any size fills the window — narrowing the filters raises the share of matches the sample surfaces but never makes it complete. The local Form 477 mirror's FTS5 index over the holding-company name is the only complete path.

**The window decides which companies match; nothing else about them.** Block-level rows sample a large carrier's blocks far more thinly than its states or technologies, so aggregating a window into a per-provider footprint understates it: measured 2026-08-13, a 1,000-row window shows Comcast (`hoconum` 130317) in 3 of the 5 technology codes and 37 of the 49 states it actually filed. `fcc_search_providers` therefore takes only `hoconum` and a name off the window and resolves each returned company's footprint separately, with `$select=stateabbr,techcode&$where=hoconum='<id>'&$group=stateabbr,techcode`. That group is indexed on the point filter and stays near a second even on the largest carriers, where the same group under an `IN (…)` key list is not — 32s for two large carriers against 3.4s for the same two one at a time, the same asymmetry the name lookups hit — so the resolution fans point queries out twelve at a time rather than batching them. Cost is one lookup per provider returned: measured over fresh companies at that concurrency, 4.4s for 50 and 8.4s for 200 on a typical mix, 13.9s for a page of 50 drawn entirely from the largest carriers. What comes back is each company's whole national footprint, never narrowed to the search's own `state` or `tech_filter` — the filters choose which companies come back, not what is true of them. So the sample is of *which* companies appear, and every company that appears is complete; the `scanTruncated` notice says both. The one field still read off the window is `holdingCompanyName`, because a `hoconum` can carry more than one filed name (130317 files as both Comcast Corporation and Midcontinent Communications) and the name on the matched rows is the one that answers a name search; its description says so.

**Filters select filings; the footprint describes the company.** `name_search`, `state`, and `tech_filter` all go into one `$where` against the deployment table, so they are evaluated together against the full corpus — not against the window, which is drawn from rows that already satisfy them. That conjunction is the right semantic for the pair that matters: `state=WA` with `tech_filter=[50]` returns companies that filed fiber *in Washington*, where a company-level AND would also return one with fiber in Texas and DSL in Washington. It is surprising in one combination, though, and the multi-name `hoconum` is why: every techcode-40 row under 130317 is filed as Midcontinent Communications, so `name_search=Comcast` with `tech_filter=[40]` matches no row and returns nothing, while the same company's resolved `techCodes` list 40 (verified live 2026-08-13). Filtering was left row-level — moving `state` and `tech_filter` onto the resolved footprint would make an unnamed state search draw its window from the whole unfiltered table, trading a real sampling loss for a narrow gain — and the gap is closed by disclosure instead: the two filter descriptions say the filters meet on a single filing, and an empty result from a name paired with either one says so again and points the caller at searching the name alone and reading the footprint off the result.

**`fcc_list_downloads` returns file manifests, not file contents.** BDC availability files are large zipped CSVs — not suitable for inline API response. The tool returns download URLs so callers can retrieve files with their preferred tooling. This is consistent with the BDC API's design: it's a bulk data distribution system, not a query API.

---

## Known Limitations

- **Data ceiling at June 2021 for no-auth queries.** Form 477 data on Socrata tops out at June 2021. BDC (post-2022) is available via authenticated download API only as bulk CSVs, not row-queryable. All coverage analysis reflects ISP-reported availability as of ~3 years ago.
- **Census block granularity in Form 477.** Coverage is reported at the census block level. A provider reporting a block as "served" may not serve every address within it — over-reporting is a known Form 477 methodology limitation that BDC's location-level Fabric was designed to address.
- **No mobile broadband in Form 477 Open Data.** The FCC Open Data portal has only fixed broadband deployment from Form 477. Mobile coverage (4G/5G by H3 hexagon) is BDC-only and requires auth.
- **No address-level queries via public API.** Programmatic address → provider lookup requires geocode → census block → deployment table. The FCC's direct address lookup endpoint requires session auth not supported by the public API token system.
- **BDC auth requires manual token generation.** Users must log in at broadbandmap.fcc.gov and manually generate a token via "Manage API Access". There is no OAuth or machine-to-machine flow.

---

## API Reference

### FCC Open Data (Socrata)

Base URL: `https://opendata.fcc.gov/resource/{dataset_id}.json`

SoQL query parameters:
- `$limit`, `$offset` — pagination (default 1000, max 50000)
- `$where` — SQL-like filter (URL-encode single quotes as `%27` in `$where` clauses)
- `$select`, `$group` — projection and aggregation
- Field equality: `?stateabbr=WA` or `?type=county`

**Important:** Socrata returns all numeric fields as strings. Parse `has_0`, `has_1`, `has_2`, `has_3more`, `maxaddown`, `maxadup` as integers.

### FCC Geo API

`GET https://geo.fcc.gov/api/census/block/find?latitude={lat}&longitude={lon}&censusYear=2010&format=json`

Returns: `Block.FIPS` (15-digit census block), `County.FIPS`, `County.name`, `State.FIPS`, `State.code`, `State.name`

No auth required. No documented rate limit.

`censusYear` is pinned to 2010. The API defaults to 2020, but the deployment table (`jdr4-3q4p`) is keyed by 2010 blocks — an unpinned request returns a well-formed block ID that matches no deployment row, so the geocode → availability chain fails with `block_not_found`.

### BDC Public Data API

Base URL: `https://bdc.fcc.gov/api/public/map/`

Auth headers (required on every request):
- `username: {FCC_BDC_USERNAME}`
- `hash_value: {FCC_BDC_HASH_VALUE}`

Rate limit: 10 calls/min per account.

| Endpoint | Method | Description |
|:---------|:-------|:------------|
| `/listAsOfDates` | GET | Returns available filing dates (e.g., `"2022-06-30"`, `"2024-06-30"`) |
| `/downloads/listAvailabilityData/{as_of_date}` | GET | Lists downloadable availability files; filter by `category`, `subcategory`, `technology_type`, `speed_tier` |
| `/downloads/listChallengeData/{as_of_date}` | GET | Lists challenge data files by state |
| `/downloads/downloadFile/{data_type}/{file_id}/{file_type}` | GET | Downloads a file by ID; `file_type` 1=Shapefile, 2=GeoPackage |

Response envelope: `{ data: [...], result_count: N, status_code: 200, status: "successful" }`
Error envelope: `{ status: "fail", status_code: 401, message: "Unauthorized" }`
