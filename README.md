<div align="center">
  <h1>@cyanheads/fcc-broadband-mcp-server</h1>
  <p><b>Access FCC broadband availability, coverage analysis, and digital divide data for US geographies and census blocks via MCP. STDIO or Streamable HTTP.</b>
  <div>10 Tools • 2 Resources • 1 Prompt • 1 Skill</div>
  </p>
</div>

<div align="center">

[![Version](https://img.shields.io/badge/Version-0.5.0-blue.svg?style=flat-square)](./CHANGELOG.md) [![License](https://img.shields.io/badge/License-Apache%202.0-orange.svg?style=flat-square)](./LICENSE) [![Docker](https://img.shields.io/badge/Docker-ghcr.io-2496ED?style=flat-square&logo=docker&logoColor=white)](https://github.com/users/cyanheads/packages/container/package/fcc-broadband-mcp-server) [![MCP SDK](https://img.shields.io/badge/MCP%20SDK-^2.4.0-green.svg?style=flat-square)](https://modelcontextprotocol.io/) [![npm](https://img.shields.io/npm/v/@cyanheads/fcc-broadband-mcp-server?style=flat-square&logo=npm&logoColor=white)](https://www.npmjs.com/package/@cyanheads/fcc-broadband-mcp-server) [![TypeScript](https://img.shields.io/badge/TypeScript-^7.0.2-3178C6.svg?style=flat-square)](https://www.typescriptlang.org/) [![Bun](https://img.shields.io/badge/Bun-v1.4.4-blueviolet.svg?style=flat-square)](https://bun.sh/)

</div>

<div align="center">

[![Install in Claude Desktop](https://img.shields.io/badge/Install_in-Claude_Desktop-D97757?style=for-the-badge&logo=anthropic&logoColor=white)](https://github.com/cyanheads/fcc-broadband-mcp-server/releases/latest/download/fcc-broadband-mcp-server.mcpb) [![Install in Cursor](https://cursor.com/deeplink/mcp-install-dark.svg)](https://cursor.com/en/install-mcp?name=fcc-broadband-mcp-server&config=eyJjb21tYW5kIjoibnB4IiwiYXJncyI6WyIteSIsIkBjeWFuaGVhZHMvZmNjLWJyb2FkYmFuZC1tY3Atc2VydmVyIl19) [![Install in VS Code](https://img.shields.io/badge/VS_Code-Install_Server-0098FF?style=for-the-badge&logo=visualstudiocode&logoColor=white)](https://vscode.dev/redirect?url=vscode:mcp/install?%7B%22name%22%3A%22fcc-broadband-mcp-server%22%2C%22command%22%3A%22npx%22%2C%22args%22%3A%5B%22-y%22%2C%22%40cyanheads%2Ffcc-broadband-mcp-server%22%5D%7D)

[![Framework](https://img.shields.io/badge/Built%20on-@cyanheads/mcp--ts--core-67E8F9?style=flat-square)](https://www.npmjs.com/package/@cyanheads/mcp-ts-core)

</div>

<div align="center">

**Public Hosted Server:** [https://fcc-broadband.caseyjhand.com/mcp](https://fcc-broadband.caseyjhand.com/mcp)

</div>

---

## Overview

FCC broadband data from Form 477 and the Broadband Data Collection (June 2022 onward). Geocode coordinates to census blocks, look up June 2021 ISP offerings and advertised speeds, and summarize, compare, or rank geographies using Area Tables from December 2016 through June 2021.

### Tools

| Tool | Description |
|:---|:---|
| `fcc_geocode_block` | Convert a lat/lon coordinate to a 2010-vintage census block FIPS code, with county and state identifiers |
| `fcc_search_availability` | List the providers and advertised speeds at a census block, filtered by technology and speed |
| `fcc_search_geographies` | Find state, county, congressional district, place, CBSA, and tribal GEOIDs by name |
| `fcc_get_coverage_summary` | Population by provider count for one geography, split by urban/rural and tribal/non-tribal |
| `fcc_compare_areas` | Rank coverage across several geographies of the same type, worst first |
| `fcc_find_underserved` | Rank the most underserved areas in a state or nationwide by unserved population |
| `fcc_search_providers` | Search holding companies by name, state, and technology; returns `hoconum` identifiers |
| `fcc_get_provider` | National coverage profile for one holding company: technologies and population per speed tier |
| `fcc_list_filing_periods` | List Form 477 filing periods, which ones support Area Table queries, and BDC as-of dates |
| `fcc_list_downloads` | List BDC bulk data files for one as-of date |

### Resources

| Resource | Description |
|:---|:---|
| `fcc-broadband://geography/{type}/{id}/summary` | Coverage summary for one geography at 25 Mbps |
| `fcc-broadband://providers/list/{offset}` | One page of the Form 477 holding-company directory, 25 entries per page |

Resource data is also reachable through tools: `fcc_get_coverage_summary` for geographies, `fcc_search_providers` for holding companies.

### Prompts

| Prompt | Description |
|:---|:---|
| `broadband_equity_analysis` | Structure a digital divide analysis that chains FCC coverage with Census and BLS data |

### Skill

[`fcc-broadband-guide`](./skills/fcc-broadband-guide/SKILL.md) covers geography and holding-company identifier chains, comparable population scopes, and sampling limits. It ships with plugin installs, npm, Docker, and the desktop bundle, and is available over MCP at `skill://fcc-broadband-guide/SKILL.md`.

## Capability reference

### `fcc_geocode_block` <sub>tool</sub>

- `latitude` and `longitude` in decimal degrees, resolved against 2010 census boundaries through the FCC Geo API
- Returns `blockFips` (15 digits, ready for `fcc_search_availability`), `censusVintage`, `countyFips`, `countyName`, `stateFips`, `stateCode`, and `stateName`; coordinates over water or outside US coverage fail as `block_not_found`. Structured FCC backend faults fail as `geo_backend_unavailable` with guidance to retry the same coordinates later

---

### `fcc_search_availability` <sub>tool</sub>

- `block_fips` (15 digits, 2010 vintage) is required; `tech_filter` (Form 477 technology codes), `min_speed_down` (Mbps), and `consumer` (`true` consumer, `false` business) narrow the rows
- One row per offering with a Form 477 filing number (`providerId`), optional FCC Registration Number (`frn`) and doing-business-as name (`dbaName`), `hoconum`, `techCode` / `techLabel`, `maxDownloadMbps`, `maxUploadMbps`, `consumer`, and `business`. Filing numbers and FRNs are strings that preserve leading zeros
- `totalProviders` counts distinct holding companies. An unfiltered block with no providers fails as `block_not_found`. A filtered query that matches nothing returns an empty list with a `notice`

---

### `fcc_search_geographies` <sub>tool</sub>

- Required nonblank `name` matches a case-insensitive literal substring; optional `geography_type` is `state`, `county`, `cd`, `place`, `cbsa`, or `tribal`, `limit` defaults to 20 (max 100), and `offset` starts at 0
- Returns distinct `{ geography_type, geography_id, name }` matches in stable name/type/GEOID order, plus `count`, `offset`, and `nextOffset` only when more matches remain. Empty and past-end pages carry guidance; no total count is computed
- Uses the live FCC lookup with `year='2021'` even when the mirror is enabled. Include a location qualifier in `name` to narrow matches; CBSA codes do not establish state membership. Pass the selected type and GEOID to `fcc_get_coverage_summary`

---

### `fcc_get_coverage_summary` <sub>tool</sub>

- `geography_type` is one of `nation`, `state`, `county`, `cd`, `place`, `cbsa`, `tribal`; `geography_id` is required for every type but `nation`; `urban_rural_filter` (`all` / `R` / `U`) and `tribal_filter` (`all` / `T` / `N`) narrow the population
- Omit `as_of_date` for June 2021, or select a supported Area Table date, for example `{"geography_type":"county","geography_id":"28115","as_of_date":"2016-12-31"}`. The result reports the filing in `dataVintage`
- Returns `population` by provider count (`noCoverage`, `oneProvider`, `twoProviders`, `threeOrMore`, `total`), `coveragePct`, `unservedPct`, `competitivePct`, and a per-segment `breakdown`. An empty demographic selection returns zero totals and a notice after confirming geography rows exist; a missing geography still fails as `geography_not_found`
- Required reads share a 48-second deadline (`coverage_timeout`); invalid geography inputs fail as `invalid_geography_combo` or `invalid_geography_id_shape`
- National coverage is named `United States` locally and retains `geography.id: "0"`; it needs no geography-name lookup

---

### `fcc_compare_areas` <sub>tool</sub>

- `geography_ids` of one `geography_type` (every type but `nation`), or `compare_all_states: true` for the 50 states plus DC; the first 300 distinct IDs are compared, with duplicates and excluded IDs disclosed. `sort_by` is `unserved_pct` (default), `unserved_pop`, `coverage_pct`, or `competitive_pct`
- `as_of_date` selects one supported Area Table filing for the entire comparison. June 2021 is the default
- Every sort ranks worst first, so `rank` 1 is the area most in need; rows carry `id`, `name` when resolved, the provider-count populations, and all three percentages. Fails as `missing_geography_ids`, `invalid_all_states_combo`, `invalid_geography_id_shape`, or `no_data_found`
- `unmatchedIds` identifies queried IDs without coverage rows, separately from IDs excluded by the comparison cap. Reads run in batches of at most 50; ranking happens once across all returned statistics

---

### `fcc_find_underserved` <sub>tool</sub>

- `state` (USPS state or territory code) scopes the search, otherwise it runs nationwide; `geography_type` is `county` (default), `cd`, `place`, or `cbsa`; `urban_rural_filter` defaults to `R`, `min_unserved_pop` to 1, and `limit` to 20 (max 100). Start `offset` at 0 and follow `nextOffset`
- `as_of_date` selects the filing to rank (default June 2021). Keep it fixed when following `nextOffset`. The filing and any comparability notice are included even when the page is empty
- Areas are ranked globally by `noCoverage`, with GEOID tie-breaking, before paging; rows carry `rank`, `id`, `name`, `oneProvider`, `total`, `unservedPct`, and `coveragePct`. `totalFound` counts matches before paging. An unrecognized `state` fails as `unknown_state`; notices distinguish no matching areas from an exhausted page

---

### `fcc_search_providers` <sub>tool</sub>

- `name_search` (case-insensitive partial name), `state`, and `tech_filter` are all optional and must hold on the same filing; `limit` defaults to 50 (max 200). Start `offset` at 0 and follow `nextOffset`; unknown USPS state or territory codes fail as `unknown_state` before querying
- Deduplicated holding companies with `hoconum`, `holdingCompanyName`, and national `statesServed` / `techCodes` that the filters never narrow. No match returns an empty list with a `notice`; a live search over its 30-second budget fails as `live_search_timeout`
- A full-corpus mirror (`FCC_MIRROR_ENABLED=true`) pages the complete matching company set in `hoconum` order and reports `totalCount`. Against the live API, `scanTruncated: true` marks a sample and withholds `totalCount`; continuation covers only the sampled set, which can change between calls

---

### `fcc_get_provider` <sub>tool</sub>

- `hoconum` (digits only) from `fcc_search_providers` or the providers directory resource
- Returns `techCodes` / `techLabels` and `speedTierPopulation`, which counts each person once and omits empty tiers; business-only carriers come back with both lists empty. Fails as `provider_not_found`, or `live_provider_timeout` past the 30-second budget

---

### `fcc_list_filing_periods` <sub>tool</sub>

- Always returns the Form 477 periods; `include_bdc: true` adds BDC as-of dates when credentials are configured
- `periods` newest first, each with `asOfDate` and `source` (`form477` or `bdc`), plus `form477Count`, `bdcCount`, and `hasBdcCredentials`. Use Form 477 entries with `areaCoverageAvailable: true` for the three area tools. BDC entries omit that flag. Missing credentials leave `bdcCount` at 0

---

### `fcc_list_downloads` <sub>tool</sub>

- `as_of_date` (`YYYY-MM-DD`) is required; filter by `data_type` (`availability` default, or `challenge`), `category` (`Summary`, `State`, `Provider`), `technology_type` (`Fixed Broadband`, `Mobile Broadband`, `Mobile Voice`), `state`, and `provider_name`; `limit` defaults to 50 (max 200), paged with `offset`
- Returns file metadata and a `downloadUrl` per file, not file contents; `totalFiles` counts every match and `nextOffset` is omitted on the last page. Fails as `invalid_as_of_date` for an unsupported date
- Available to MCP clients only when both BDC credentials are configured at startup. Otherwise the HTTP landing page retains its disabled card and setup guidance

---

### `fcc-broadband://geography/{type}/{id}/summary` <sub>resource</sub>

- `type` takes the seven `fcc_get_coverage_summary` geography types; `id` is a FIPS GEOID checked for digit count, `0` for `nation`
- Fixed at June 2021, 25/3 Mbps, and satellite-inclusive `acfosw`. Returns `population`, the three percentages, and `segments` as `application/json`. Use `fcc_get_coverage_summary` to select a filing date, threshold, or filter

---

### `fcc-broadband://providers/list/{offset}` <sub>resource</sub>

- `offset` pages the directory 25 entries at a time in `hoconum` order; start at `0` and follow `nextOffset`
- Entries carry `hoconum` and, when resolved, `holdingCompanyName`; each page reports `total` and `count`. To find one company by name, use `fcc_search_providers`

---

### `broadband_equity_analysis` <sub>prompt</sub>

- Arguments: `region` (free text) and `focus` (`underserved`, `rural`, `tribal`, or `all`), both required
- Returns one user message laying out a five-step analysis: baseline coverage, focus area, demographic cross-reference, provider landscape, and historical screening context

## Features

Built on [`@cyanheads/mcp-ts-core`](https://github.com/cyanheads/mcp-ts-core): stdio and Streamable HTTP transports, pluggable auth (`none` / `jwt` / `oauth`), swappable storage (`in-memory`, `filesystem`, `Supabase`, `Cloudflare KV/R2/D1`), structured logging with optional OpenTelemetry tracing.

FCC-specific:

- Three FCC sources, all US government public-domain data: Form 477 on FCC Open Data (Socrata), the BDC Public Data API, and the FCC Geo API
- Form 477 tools and resources work without credentials. Block availability, provider tools, and resources use the final June 2021 filing. BDC data is available as bulk-file manifests. `fcc_list_downloads` is advertised to MCP clients when both `FCC_BDC_USERNAME` and `FCC_BDC_HASH_VALUE` are configured
- The area tools accept every nonempty alphabetical combination of `a` DSL, `c` cable, `f` fiber, `o` other, `s` satellite, and `w` fixed wireless. The default `acfow` excludes satellite; explicit `acfosw` includes it. Deployment tools use numeric technology codes instead
- Area speed keys select download/upload pairs in Mbps: `0.2` → 0.2/0.2, `4` → 4/1, `10` → 10/1, `25` → 25/3 (default), `100` → 100/10, `250` → 250/25, and `1000` → 1000/100. Historical population aggregates cannot establish current BEAD eligibility or address service; the 100/10 tier does not establish 100/20 availability
- The three area tools query pre-aggregated Area Tables. They accept the ten June and December filing dates from `2016-12-31` through `2021-06-30` and resolve geography names in the filing year. Unsupported dates fail as `invalid_arguments`. Results before `2020-12-31` carry a `vintageNotice` about comparing across that boundary
- The optional local Form 477 mirror (`FCC_MIRROR_ENABLED=true`) serves covered June 2021 records from SQLite. Older Area Tables use FCC Open Data directly

Agent-friendly output:

- Filter echo: search, summary, and ranking tools return `appliedFilters`, and every Form 477 result carries `dataVintage`
- Partial results say so: `scanTruncated` and `scanRowCap` flag a result drawn from a capped upstream scan (`fcc_search_providers`, `fcc_find_underserved`), and an empty match returns a `notice` instead of an error
- Typed failures: reasons such as `block_not_found`, `invalid_geography_id_shape`, and `credentials_required`, each with a recovery hint

## Getting started

### Public Hosted Instance

A public instance is available at `https://fcc-broadband.caseyjhand.com/mcp` — no installation required. Point any MCP client at it via Streamable HTTP:

```json
{
  "mcpServers": {
    "fcc-broadband-mcp-server": {
      "type": "streamable-http",
      "url": "https://fcc-broadband.caseyjhand.com/mcp"
    }
  }
}
```

### Self-Hosted / Local

Add the following to your MCP client configuration file.

```json
{
  "mcpServers": {
    "fcc-broadband-mcp-server": {
      "type": "stdio",
      "command": "bunx",
      "args": ["@cyanheads/fcc-broadband-mcp-server@latest"],
      "env": {
        "MCP_TRANSPORT_TYPE": "stdio",
        "MCP_LOG_LEVEL": "info"
      }
    }
  }
}
```

Or with npx (no Bun required):

```json
{
  "mcpServers": {
    "fcc-broadband-mcp-server": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@cyanheads/fcc-broadband-mcp-server@latest"],
      "env": {
        "MCP_TRANSPORT_TYPE": "stdio",
        "MCP_LOG_LEVEL": "info"
      }
    }
  }
}
```

For Streamable HTTP, set the transport and start the server:

```sh
MCP_TRANSPORT_TYPE=http MCP_HTTP_PORT=3010 bun run start:http
# Server listens at http://localhost:3010/mcp
```

### Prerequisites

- [Bun v1.4.4](https://bun.sh/) or higher (or Node.js v24+).
- Optional: FCC BDC credentials for `fcc_list_downloads` and BDC filing periods. Generate a token at [broadbandmap.fcc.gov](https://broadbandmap.fcc.gov) under "Manage API Access".
- Optional: a Socrata app token (`FCC_OPENDATA_APP_TOKEN`) for higher Form 477 rate limits.

### Installation

1. **Clone the repository:**

```sh
git clone https://github.com/cyanheads/fcc-broadband-mcp-server.git
```

2. **Navigate into the directory:**

```sh
cd fcc-broadband-mcp-server
```

3. **Install dependencies:**

```sh
bun install
```

4. **Configure environment:**

```sh
cp .env.example .env
# edit .env and set FCC_BDC_USERNAME, FCC_BDC_HASH_VALUE, and FCC_OPENDATA_APP_TOKEN as needed
```

## Configuration

| Variable | Description | Default |
|:---|:---|:---|
| `FCC_BDC_USERNAME` | FCC account email for the BDC API. Needed by `fcc_list_downloads` and for BDC dates in `fcc_list_filing_periods`. | none |
| `FCC_BDC_HASH_VALUE` | API token hash from broadbandmap.fcc.gov "Manage API Access". Pairs with `FCC_BDC_USERNAME`. | none |
| `FCC_OPENDATA_APP_TOKEN` | Socrata app token; raises FCC Open Data rate limits. | none |
| `FCC_MIRROR_ENABLED` | Serve covered June 2021 Form 477 data from the local SQLite mirror. | `false` |
| `FCC_MIRROR_PATH` | Directory holding the mirror SQLite files. | `data/fcc-mirror` |
| `MCP_TRANSPORT_TYPE` | Transport: `stdio` or `http`. | `stdio` |
| `MCP_HTTP_PORT` | HTTP server port. | `3010` |
| `MCP_SESSION_MODE` | HTTP session mode: `stateless`, `stateful`, or `auto`. | `stateless` |
| `MCP_AUTH_MODE` | Authentication: `none`, `jwt`, or `oauth`. | `none` |
| `MCP_JWT_EXPECTED_AUDIENCE` | Required `aud` claim in JWT mode. JWT mode warns at startup if unset. | Unset |
| `MCP_JWT_EXPECTED_ISSUER` | Required `iss` claim in JWT mode. | Unset |
| `MCP_LOG_LEVEL` | Log level (`debug`, `info`, `warning`, `error`, etc.). | `info` |
| `LOGS_DIR` | Directory for log files (Node.js only). Relative paths resolve from the server's package root. | `<server-package-root>/logs` |
| `STORAGE_PROVIDER_TYPE` | Storage backend: `in-memory`, `filesystem`, `supabase`, `cloudflare-kv/r2/d1`. | `in-memory` |
| `OTEL_ENABLED` | Enable [OpenTelemetry](https://github.com/cyanheads/mcp-ts-core/tree/main/docs/telemetry). | `false` |

See [`.env.example`](./.env.example) for the full list of optional overrides.

BDC credentials can come from the process environment or `.env`; process values take precedence. Empty, whitespace-only, and unsubstituted placeholder values count as absent. Restart after configuring both credentials to enable `fcc_list_downloads`; Form 477 filing periods remain available without them.

## Running the server

### Local development

- **Build and run:**

  ```sh
  # One-time build
  bun run rebuild

  # Run the built server
  bun run start:stdio
  # or
  bun run start:http
  ```

- **Run checks and tests:**

  ```sh
  bun run devcheck   # Lint, format, typecheck, security
  bun run test       # Vitest test suite
  bun run lint:mcp   # Validate MCP definitions against spec
  ```

### Docker

```sh
docker build -t fcc-broadband-mcp-server .
docker run --rm -p 3010:3010 fcc-broadband-mcp-server
```

The Dockerfile defaults to HTTP transport and stateless session mode, logging to `/var/log/fcc-broadband-mcp-server`. OpenTelemetry peer dependencies are installed by default — build with `--build-arg OTEL_ENABLED=false` to omit them. The image also ships the mirror scripts and a writable `data/` directory.

### Local Form 477 mirror

The local SQLite mirror indexes the final Form 477 filing from June 2021. The mirror is off by default. A full ingest pulls about 9 GB of source data and takes hours, so you can bootstrap just the states you query.

```sh
bun run mirror:init -- --states 11,53   # specific states by 2-digit FIPS (11 = DC, 53 = WA)
bun run mirror:init -- --full           # the whole corpus
bun run mirror:verify                   # coverage, row counts, SQLite integrity
```

Then set `FCC_MIRROR_ENABLED=true`. In Docker, run the same scripts with `docker exec <container> bun run mirror:init -- --states 11,53`. Run them from a source checkout or the image: the scripts import through the `@/` path alias, which an npm install does not map.

- June 2021 block and state-scoped area queries use the mirror once the queried state is fully ingested. Provider search, provider summaries, and June 2021 area queries for `cbsa`, `tribal`, and `nation` require full coverage to serve locally.
- Earlier Area Tables and geography names use FCC Open Data. Standalone geography discovery uses the 2021 lookup, and area tools use the requested filing year for name resolution. Coverage statistics remain available when a name lookup fails.
- Existing mirror files gain `frn` and `dbaName` metadata as legacy offerings are read. Confirmed values and source blanks are saved locally. If FCC Open Data is temporarily unavailable, local offerings still return with a notice and the missing metadata can be retried on a later read.
- `mirror:verify` reports the provider dimension as derived, alongside its row count and integrity check. Use the state roster and full-corpus marker to check coverage.
- Mirror name search matches word prefixes (`comc` finds "Comcast") where the live API matches any substring (`mcast`), so a mid-word fragment can return fewer results.
- The ingest is idempotent and resumes an interrupted run from its saved cursor. Set `FCC_OPENDATA_APP_TOKEN` first for a full ingest. Bun uses the built-in `bun:sqlite`; Node.js needs the optional `better-sqlite3` peer dependency.

## Project structure

| Directory | Purpose |
|:---|:---|
| `src/index.ts` | `createApp()` entry point — registers tools, resources, and prompts and inits services. |
| `src/config` | Server-specific environment variable parsing and validation with Zod. |
| `src/mcp-server/tools` | Tool definitions (`*.tool.ts`). Ten tools across FCC Open Data, the BDC API, and the Geo API. |
| `src/mcp-server/resources` | Resource definitions (`*.resource.ts`). Geography summary and provider directory. |
| `src/mcp-server/prompts` | Prompt definitions (`*.prompt.ts`). Broadband equity analysis prompt. |
| `src/services/open-data` | FCC Open Data (Socrata) service for Form 477 deployment, area, and provider tables; `mirror/` holds the local SQLite mirror. |
| `src/services/bdc-api` | BDC Public Data API service — authenticated filing periods and download manifests. |
| `src/services/geo-api` | FCC Geo API service — lat/lon to census block FIPS. |
| `scripts/` | Build, devcheck, and packaging scripts, plus `fcc-mirror-init.ts` / `fcc-mirror-verify.ts`. |
| `skills/` | Published broadband-analysis guide, also served as an MCP skill resource. |
| `tests/` | Unit and integration tests mirroring `src/`. |

## Development guide

See [`CLAUDE.md`](./CLAUDE.md) for development guidelines and architectural rules. The short version:

- Handlers throw, framework catches — no `try/catch` in tool logic
- Use `ctx.log` for request-scoped logging, `ctx.state` for tenant-scoped storage
- Register new tools and resources via the barrels in `src/mcp-server/*/definitions/index.ts`
- Wrap external API calls: validate raw → normalize to domain type → return output schema; never fabricate missing fields
- Socrata returns every field as a string, so parse counts and speeds (`has_0`–`has_3more`, `maxaddown`, `maxadup`) explicitly

## Contributing

Issues are welcome. Run checks and tests before submitting:

```sh
bun run devcheck
bun run test
```

## License

Apache-2.0 — see [LICENSE](LICENSE) for details.
