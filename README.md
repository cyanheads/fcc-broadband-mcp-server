<div align="center">
  <h1>@cyanheads/fcc-broadband-mcp-server</h1>
  <p><b>Access FCC broadband availability, coverage analysis, and digital divide data for US geographies and census blocks via MCP. STDIO or Streamable HTTP.</b>
  <div>9 Tools • 2 Resources • 1 Prompt</div>
  </p>
</div>

<div align="center">

[![Version](https://img.shields.io/badge/Version-0.2.2-blue.svg?style=flat-square)](./CHANGELOG.md) [![License](https://img.shields.io/badge/License-Apache%202.0-orange.svg?style=flat-square)](./LICENSE) [![Docker](https://img.shields.io/badge/Docker-ghcr.io-2496ED?style=flat-square&logo=docker&logoColor=white)](https://github.com/users/cyanheads/packages/container/package/fcc-broadband-mcp-server) [![MCP SDK](https://img.shields.io/badge/MCP%20SDK-^2.0.0-green.svg?style=flat-square)](https://modelcontextprotocol.io/) [![npm](https://img.shields.io/npm/v/@cyanheads/fcc-broadband-mcp-server?style=flat-square&logo=npm&logoColor=white)](https://www.npmjs.com/package/@cyanheads/fcc-broadband-mcp-server) [![TypeScript](https://img.shields.io/badge/TypeScript-^7.0.2-3178C6.svg?style=flat-square)](https://www.typescriptlang.org/) [![Bun](https://img.shields.io/badge/Bun-v1.4.0-blueviolet.svg?style=flat-square)](https://bun.sh/)

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

FCC broadband availability, coverage analysis, and digital divide data across Form 477 (2015–2021) and BDC (2022–present) filings. Geocode coordinates to census blocks, look up ISP availability and speeds, and rank geographies by unserved population for BEAD program and equity research. Runs as a stdio process, a local Streamable HTTP server, or the public hosted endpoint above.

### Tools

| Tool | Description |
|:---|:---|
| `fcc_geocode_block` | Converts a lat/lon coordinate to a 2010-vintage census block FIPS code, plus county and state identifiers. Required prerequisite for `fcc_search_availability`. |
| `fcc_search_availability` | Queries broadband providers and advertised speeds at a census block, filtered by technology and speed. |
| `fcc_get_coverage_summary` | Broadband coverage summary for a geography — population by provider count, split by urban/rural and tribal/non-tribal. |
| `fcc_compare_areas` | Ranks broadband coverage across multiple geographies of the same type, worst-first. |
| `fcc_find_underserved` | Finds the most broadband-underserved areas within a state or nationwide, ranked by unserved population. |
| `fcc_search_providers` | Searches ISPs by holding company name, state, and technology; returns `hoconum` identifiers for follow-up calls. |
| `fcc_get_provider` | National coverage profile for a holding company — technologies deployed and population covered per speed tier. |
| `fcc_list_filing_periods` | Lists available data vintages: Form 477 filing periods and BDC as-of dates. |
| `fcc_list_downloads` | Lists downloadable BDC bulk data files for a specific as-of date. Requires BDC credentials. |

### Resources

| Resource | Description |
|:---|:---|
| `fcc-broadband://geography/{type}/{id}/summary` | Broadband coverage summary for a geography: provider counts by speed tier, urban/rural split, tribal breakdown. |
| `fcc-broadband://providers/list/{offset}` | One page of the Form 477 holding-company directory, 25 entries per page. |

All resource data is also reachable via tools — the directory pages the provider summary table and resolves each name with a single-`hoconum` lookup; to find one company by name rather than paging, use `fcc_search_providers`.

### Prompts

| Prompt | Description |
|:---|:---|
| `broadband_equity_analysis` | Structures a digital divide analysis comparing broadband access across demographic groups, chaining Census and BLS data. |

## Capability reference

### `fcc_geocode_block` <sub>tool</sub>

- Calls the FCC Geo API — no auth required, no rate limit documented
- Returns a 15-digit block FIPS code, its census vintage, 5-digit county FIPS, county name, state FIPS, 2-letter state code, and state name
- Resolves against 2010 census boundaries — the vintage the Form 477 deployment dataset is keyed by, so `blockFips` feeds `fcc_search_availability` directly
- Required first step before `fcc_search_availability` — the broadband deployment dataset is indexed by census block, not address
- Typed error: `block_not_found` when no census block matches the coordinates (over water or outside US coverage)

---

### `fcc_search_availability` <sub>tool</sub>

- Requires a 15-digit census block FIPS on 2010 boundaries; use `fcc_geocode_block` to convert coordinates first
- Filter by any Form 477 technology code (0, 10–12, 20, 30, 40–43, 50, 60, 70, 90), minimum advertised download speed in Mbps, and consumer-only/business-only service
- Returns per-provider records with `hoconum`, `techCode`/`techLabel`, `maxDownloadMbps`, `maxUploadMbps`, `consumer`, `business`
- Coverage is Form 477 data through June 2021 — ISP-reported availability at census block granularity, which can overstate coverage for some addresses
- Typed error: `block_not_found` when the block has no reported providers and no filters were applied

---

### `fcc_get_coverage_summary` <sub>tool</sub>

- Supports seven geography types: `nation`, `state`, `county`, `cd` (congressional district), `place` (census-designated place), `cbsa` (metro area), `tribal`
- Technology filter: any wired/fixed wireless (`acfosw`), fiber only (`f`), cable (`c`), DSL (`a`), satellite (`s`), fixed wireless (`w`), or combinations
- Speed thresholds: 0.2, 4, 10, 25 (FCC legacy broadband definition), 100 (BEAD standard), 250, 1000 Mbps
- Returns population breakdowns — zero providers (unserved), one (no competition), two, three-plus — plus coverage/unserved/competitive percentages, with a per-segment urban/rural × tribal/non-tribal split
- Typed errors: `geography_not_found`, `invalid_geography_combo` (`geography_id` required for non-nation types, must be omitted for nation), `invalid_geography_id_shape` (digit count must match the type: state=2, county=5, cd=4, cbsa=5, place=7)

---

### `fcc_compare_areas` <sub>tool</sub>

- Compare up to 50 geographies of the same type, or all 50 states + DC via `compare_all_states: true`
- Sort by unserved population share, raw unserved headcount (useful for BEAD funding allocation), coverage rate, or competitive share
- Every sort ranks worst-first — rank 1 is the area most in need, whichever metric is chosen
- Returns a ranked table with per-geography population and coverage metrics; each row includes the resolved geography name alongside its GEOID when available
- Typed errors: `no_data_found`, `invalid_all_states_combo`, `missing_geography_ids` (fewer than 2 provided), `invalid_geography_id_shape`

---

### `fcc_find_underserved` <sub>tool</sub>

- Scope to a specific state or territory (2-letter USPS code), or run nationwide (returns top areas only)
- Geography granularity: county, congressional district, census place, or CBSA; defaults to rural areas only, where underservice is most concentrated
- `min_unserved_pop` defaults to 1, so fully covered areas stay out of the ranking; set to 0 to rank every area or higher to drop small gaps
- Results ranked by unserved population, highest first, up to `limit` (default 20, max 100); each row includes the resolved geography name alongside its GEOID when available
- Typed errors: `unknown_state` (not a real USPS state or territory abbreviation); filters matching no area return an empty ranking with a notice, not an error

---

### `fcc_search_providers` <sub>tool</sub>

- Case-insensitive partial name match on holding company name; filter by 2-letter state abbreviation or Form 477 technology code
- Returns deduplicated holding companies with `hoconum`, plus each company's complete national `statesServed` and `techCodes` — resolved per company, not narrowed by the state/tech filters
- Geographic filtering is state-level; sub-state granularity requires cross-referencing block data via `fcc_search_availability`
- Up to 200 results per call
- When the live scan hits its row ceiling (`scanTruncated`), the returned providers are a sample and the true match count is unavailable — narrow the filters or enable the local Form 477 mirror (`FCC_MIRROR_ENABLED=true`) for a complete search
- Typed errors: `live_search_timeout` (30-second budget, non-retryable); a search matching nothing returns an empty result with a notice, not an error

---

### `fcc_get_provider` <sub>tool</sub>

- Input: `hoconum` (digits only) from `fcc_search_providers`
- Returns national `techCodes`/`techLabels` and population covered per download speed tier; tiers with zero coverage are omitted
- Population per tier counts each person once, regardless of how many technologies reach them
- Business-only carriers with no reported residential coverage return empty `techCodes`/`speedTierPopulation` — use `fcc_search_availability` for their block-level deployments
- Typed errors: `provider_not_found`, `live_provider_timeout` (30-second budget, non-retryable — enable the local Form 477 mirror to serve profiles locally)

---

### `fcc_list_filing_periods` <sub>tool</sub>

- Form 477 periods (Jun 2015–Jun 2021) are hardcoded — always available, no credentials needed
- `include_bdc` defaults to false; set true to also fetch BDC as-of dates (Jun 2022 onward) from the authenticated API — requires `FCC_BDC_USERNAME` and `FCC_BDC_HASH_VALUE`
- Call before `fcc_list_downloads` to determine valid `as_of_date` values

---

### `fcc_list_downloads` <sub>tool</sub>

- Requires BDC API credentials (`FCC_BDC_USERNAME`, `FCC_BDC_HASH_VALUE`)
- Filter by data type (availability or challenge), file category, technology type, state, or provider name
- Returns file manifests, not file contents — file metadata (provider, state, technology, record count) plus download URLs; BDC CSVs are large zipped files not suitable for inline API response
- Paged with `limit` (default 50, max 200) and `offset` — `totalFiles` counts every file matching the filters, and each response reports its offset, file count, and a `nextOffset`, omitted on the last page
- Typed error `invalid_as_of_date`: rejected without credentials when not a calendar date or before the first BDC period (2022-06-30); rejected with credentials when the date isn't among the published set
- Typed error `credentials_required` when BDC credentials are absent

---

### `fcc-broadband://geography/{type}/{id}/summary` <sub>resource</sub>

- Addressable by geography type (`nation`, `state`, `county`, `cd`, `place`, `cbsa`, `tribal`) and FIPS GEOID; GEOID digit count is validated per type
- Fixed to a 25 Mbps threshold and `acfosw` (any wired/fixed wireless) technology filter — use `fcc_get_coverage_summary` for other thresholds or filters
- Returns population by provider tier, coverage/unserved/competitive percentages, and a per-segment urban/rural × tribal/non-tribal breakdown

---

### `fcc-broadband://providers/list/{offset}` <sub>resource</sub>

- Pages the Form 477 holding-company directory 25 entries at a time, ordered by `hoconum` ascending; start at offset `0` and follow each response's `nextOffset`
- Each entry resolves `hoconum` to a company name when the FCC deployment table carries a matching row; unresolved entries omit `holdingCompanyName`
- To find one company by name rather than browsing, use `fcc_search_providers` instead

---

### `broadband_equity_analysis` <sub>prompt</sub>

- Arguments: `region` (free text) required; `focus` (`underserved`, `rural`, `tribal`, `all`) required
- Returns one user message structuring a five-step analysis — baseline coverage, focus-specific deep dive, demographic cross-reference (Census/BLS/CDC), provider landscape, and BEAD eligibility

## Features

Built on [`@cyanheads/mcp-ts-core`](https://github.com/cyanheads/mcp-ts-core): stdio and Streamable HTTP transports, pluggable auth (`none` / `jwt` / `oauth`), swappable storage (`in-memory`, `filesystem`, `Supabase`, `Cloudflare KV/R2/D1`), structured logging with optional OpenTelemetry tracing.

FCC-specific:

- Wraps three FCC data sources: Form 477 public data via Socrata (no auth, 2015–2021), BDC Public Data API (authenticated, Jun 2022 onward), and FCC Geo API (no auth)
- Auth-optional design — BDC tools return a structured `credentials_required` error with setup instructions when credentials are absent; all Form 477 and geocoding tools always work without credentials
- Area Table aggregation for equity analysis — uses the pre-aggregated geography table (`xvwq-qtaj`) instead of querying the 50M-row deployment table, enabling fast coverage analysis at county and state scale
- Optional local Form 477 mirror (`FCC_MIRROR_ENABLED=true`) serves block/geography lookups from an embedded SQLite index once bootstrapped, with live-API fallback for anything not yet ingested
- All data is US federal government public domain (17 USC §105) — safe to distribute and cache

Agent-friendly output:

- Structured error contracts on every tool — typed error codes (`block_not_found`, `credentials_required`, `geography_not_found`, `invalid_as_of_date`) with actionable next-step hints so agents can recover without parsing text
- Per-segment breakdowns in coverage tools — urban/rural and tribal/non-tribal split in `fcc_get_coverage_summary` outputs so agents can target equity analysis without additional queries
- Two-era data coverage bridged transparently — Form 477 (2015–2021) and BDC (2022–present) exposed through a unified tool surface, with data ceiling documented in tool descriptions so agents can surface limitations accurately

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

- [Bun v1.4.0](https://bun.sh/) or higher (or Node.js v24+).
- Optional: FCC BDC credentials for `fcc_list_downloads` and BDC filing periods. Generate a token at [broadbandmap.fcc.gov](https://broadbandmap.fcc.gov) under "Manage API Access" — no OAuth, manual token generation only.
- Optional: Socrata app token (`FCC_OPENDATA_APP_TOKEN`) for higher rate limits on Form 477 queries.

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
# edit .env and set required vars
```

## Configuration

All configuration is validated at startup via Zod schemas in `src/config/`. Key environment variables:

| Variable | Description | Default |
|:---|:---|:---|
| `MCP_TRANSPORT_TYPE` | Transport: `stdio` or `http` | `stdio` |
| `MCP_HTTP_PORT` | HTTP server port | `3010` |
| `MCP_HTTP_ENDPOINT_PATH` | HTTP endpoint path | `/mcp` |
| `MCP_PUBLIC_URL` | Public origin override for TLS-terminating reverse-proxy deployments | none |
| `MCP_AUTH_MODE` | Authentication: `none`, `jwt`, or `oauth` | `none` |
| `MCP_LOG_LEVEL` | Log level (`debug`, `info`, `warning`, `error`, etc.) | `info` |
| `LOGS_DIR` | Directory for log files (Node.js only) | `<project-root>/logs` |
| `STORAGE_PROVIDER_TYPE` | Storage backend: `in-memory`, `filesystem`, `supabase`, `cloudflare-kv/r2/d1` | `in-memory` |
| `FCC_BDC_USERNAME` | FCC account email for BDC API. Without this, `fcc_list_downloads` and BDC-era `fcc_list_filing_periods` return a `credentials_required` error. | none |
| `FCC_BDC_HASH_VALUE` | API token hash from broadbandmap.fcc.gov "Manage API Access". Paired with `FCC_BDC_USERNAME`. | none |
| `FCC_OPENDATA_APP_TOKEN` | Socrata app token. Increases rate limits on Form 477 queries; not required for functionality. | none |
| `FCC_MIRROR_ENABLED` | Serve Form 477 queries from a local SQLite mirror when its coverage allows (see [Local Form 477 mirror](#local-form-477-mirror-opt-in)). | `false` |
| `FCC_MIRROR_PATH` | Directory holding the Form 477 mirror SQLite files. | `data/fcc-mirror` |
| `OTEL_ENABLED` | Enable [OpenTelemetry instrumentation](https://github.com/cyanheads/mcp-ts-core/tree/main/docs/telemetry) | `false` |

See [`.env.example`](./.env.example) for the full list of optional overrides.

## Local Form 477 mirror (opt-in)

The Form 477 corpus is frozen — June 2021 was the last filing period — so it can be mirrored locally once and served without touching the live Socrata API. The mirror is off by default; when disabled (or not yet bootstrapped), every tool behaves exactly as before.

The corpus is large: ~78M block-level deployment rows and ~24M area-summary rows, roughly 9 GB of source data. A full ingest is an hours-scale one-time job, so the bootstrap is state-scoped — you can mirror just the states you query:

```sh
# Ingest specific states by 2-digit FIPS (e.g. 11 = DC, 53 = WA)
bun run mirror:init -- --states 11,53

# Or ingest the whole corpus (~9 GB download, hours)
bun run mirror:init -- --full

# Inspect coverage, row counts, and SQLite integrity
bun run mirror:verify
```

Then set `FCC_MIRROR_ENABLED=true`. Serving rules:

- Block/geography lookups (`fcc_search_availability`, `fcc_get_coverage_summary`, `fcc_compare_areas`, `fcc_find_underserved`) serve from the mirror when the queried state is fully ingested; anything else falls back to the live API silently.
- Cross-state aggregations (`fcc_search_providers`, `fcc_get_provider`) and geographies whose GEOID embeds no state (cbsa, tribal, nation) serve from the mirror only after a `--full` ingest.

One behavioral difference: provider name search (`fcc_search_providers`) uses word-prefix matching on the mirror (FTS5 — `comc` matches "Comcast") instead of the live API's arbitrary-substring match (`mcast` matches "Comcast" live but not on the mirror). Mid-word fragments may return fewer results from the mirror.

The ingest is idempotent and resumable: already-covered states are skipped, and an interrupted run resumes from its persisted cursor. Set `FCC_OPENDATA_APP_TOKEN` before a full ingest to raise Socrata's rate limits. Under Bun the mirror uses the built-in `bun:sqlite`; under Node.js install the optional `better-sqlite3` peer dependency.

In Docker, the image ships the lifecycle scripts and a writable `data/` directory:

```sh
docker exec <container> bun run mirror:init -- --states 11,53
```

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
docker run --rm -e MCP_TRANSPORT_TYPE=http -p 3010:3010 fcc-broadband-mcp-server
```

The Dockerfile defaults to HTTP transport and stateless session mode, logging to `/var/log/fcc-broadband-mcp-server`. OpenTelemetry peer dependencies are installed by default — build with `--build-arg OTEL_ENABLED=false` to omit them.

## Project structure

| Directory | Purpose |
|:---|:---|
| `src/index.ts` | `createApp()` entry point — registers tools, resources, and prompts and inits services. |
| `src/config` | Server-specific environment variable parsing and validation with Zod. |
| `src/mcp-server/tools` | Tool definitions (`*.tool.ts`). Nine tools across FCC Open Data, BDC API, and Geo API. |
| `src/mcp-server/resources` | Resource definitions (`*.resource.ts`). Geography summary and provider list resources. |
| `src/mcp-server/prompts` | Prompt definitions (`*.prompt.ts`). Broadband equity analysis prompt. |
| `src/services/open-data` | FCC Open Data Socrata service — Form 477 deployment and area table queries. |
| `src/services/bdc-api` | BDC Public Data API service — authenticated filing period and download manifest endpoints. |
| `src/services/geo-api` | FCC Geo API service — lat/lon to census block FIPS conversion. |
| `tests/` | Unit and integration tests mirroring `src/`. |

## Development guide

See [`CLAUDE.md`](./CLAUDE.md) for development guidelines and architectural rules. The short version:

- Handlers throw, framework catches — no `try/catch` in tool logic
- Use `ctx.log` for request-scoped logging, `ctx.state` for tenant-scoped storage
- Register new tools and resources via the barrels in `src/mcp-server/*/definitions/index.ts`
- Wrap external API calls: validate raw → normalize to domain type → return output schema; never fabricate missing fields
- Socrata returns all numeric fields as strings — parse `has_0`, `has_1`, `has_2`, `has_3more`, `maxaddown`, `maxadup` as integers

## Contributing

Issues are welcome. Run checks and tests before submitting:

```sh
bun run devcheck
bun run test
```

## License

Apache-2.0 — see [LICENSE](LICENSE) for details.
