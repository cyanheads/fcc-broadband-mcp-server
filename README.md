<div align="center">
  <h1>@cyanheads/fcc-broadband-mcp-server</h1>
  <p><b>Access FCC broadband availability, coverage analysis, and digital divide data for US geographies and census blocks via MCP. STDIO or Streamable HTTP.</b>
  <div>9 Tools • 2 Resources • 1 Prompt</div>
  </p>
</div>

<div align="center">

[![Version](https://img.shields.io/badge/Version-0.2.2-blue.svg?style=flat-square)](./CHANGELOG.md) [![License](https://img.shields.io/badge/License-Apache%202.0-orange.svg?style=flat-square)](./LICENSE) [![Docker](https://img.shields.io/badge/Docker-ghcr.io-2496ED?style=flat-square&logo=docker&logoColor=white)](https://github.com/users/cyanheads/packages/container/package/fcc-broadband-mcp-server) [![MCP SDK](https://img.shields.io/badge/MCP%20SDK-^2.0.0-green.svg?style=flat-square)](https://modelcontextprotocol.io/) [![npm](https://img.shields.io/npm/v/@cyanheads/fcc-broadband-mcp-server?style=flat-square&logo=npm&logoColor=white)](https://www.npmjs.com/package/@cyanheads/fcc-broadband-mcp-server) [![TypeScript](https://img.shields.io/badge/TypeScript-^7.0.2-3178C6.svg?style=flat-square)](https://www.typescriptlang.org/) [![Bun](https://img.shields.io/badge/Bun-v1.3.0-blueviolet.svg?style=flat-square)](https://bun.sh/)

</div>

<div align="center">

[![Install in Claude Desktop](https://img.shields.io/badge/Install_in-Claude_Desktop-D97757?style=for-the-badge&logo=anthropic&logoColor=white)](https://github.com/cyanheads/fcc-broadband-mcp-server/releases/latest/download/fcc-broadband-mcp-server.mcpb) [![Install in Cursor](https://cursor.com/deeplink/mcp-install-dark.svg)](https://cursor.com/en/install-mcp?name=fcc-broadband-mcp-server&config=eyJjb21tYW5kIjoibnB4IiwiYXJncyI6WyIteSIsIkBjeWFuaGVhZHMvZmNjLWJyb2FkYmFuZC1tY3Atc2VydmVyIl19) [![Install in VS Code](https://img.shields.io/badge/VS_Code-Install_Server-0098FF?style=for-the-badge&logo=visualstudiocode&logoColor=white)](https://vscode.dev/redirect?url=vscode:mcp/install?%7B%22name%22%3A%22fcc-broadband-mcp-server%22%2C%22command%22%3A%22npx%22%2C%22args%22%3A%5B%22-y%22%2C%22%40cyanheads%2Ffcc-broadband-mcp-server%22%5D%7D)

[![Framework](https://img.shields.io/badge/Built%20on-@cyanheads/mcp--ts--core-67E8F9?style=flat-square)](https://www.npmjs.com/package/@cyanheads/mcp-ts-core)

</div>

<div align="center">

**Public Hosted Server:** [https://fcc-broadband.caseyjhand.com/mcp](https://fcc-broadband.caseyjhand.com/mcp)

</div>

---

## Tools

9 tools for working with FCC broadband data — block-level availability, geography-level coverage analysis, provider search, and BDC bulk download manifests:

| Tool | Description |
|:---|:---|
| `fcc_geocode_block` | Converts a latitude/longitude coordinate to a 2010-vintage census block FIPS code (15-digit), county FIPS, county name, state FIPS, state code, and state name. Required prerequisite for `fcc_search_availability`. |
| `fcc_search_availability` | Queries broadband providers and advertised speeds at a census block, filtered by technology type and speed threshold. The starting point for any address-level broadband lookup. |
| `fcc_get_coverage_summary` | Returns a broadband coverage summary for a geography — population with zero, one, two, or three-plus providers at a given speed threshold, split by urban/rural and tribal/non-tribal. |
| `fcc_compare_areas` | Compares broadband coverage metrics across multiple geographies of the same type and returns a ranked table sorted by unserved or underserved population. |
| `fcc_find_underserved` | Finds geographic areas with limited or no broadband coverage at a given speed threshold, ranked by underserved population. The core tool for BEAD program analysis and broadband equity research. |
| `fcc_search_providers` | Searches for ISPs by holding company name, filtered by state and technology type. Returns a deduplicated list with `hoconum` identifiers for follow-up calls, each carrying that company's complete national states and technologies, and reports when the live path returned a sample of the matching companies rather than every one. |
| `fcc_get_provider` | Returns a national-level coverage profile for a specific holding company — technologies deployed and the population covered at each download speed tier. |
| `fcc_list_filing_periods` | Returns available data vintages: Form 477 filing periods (Jun 2015–Jun 2021) and BDC as-of dates (Jun 2022 onward, requires credentials). |
| `fcc_list_downloads` | Lists downloadable BDC data files for a specific as-of date — availability by state and provider, mobile coverage, and challenge data. Requires BDC API credentials. |

### `fcc_geocode_block`

Convert geographic coordinates to a census block FIPS code for broadband availability lookups.

- Calls the FCC Geo API — no auth required, no rate limit documented
- Returns 15-digit block FIPS, its census vintage, 5-digit county FIPS, county name, state FIPS, 2-letter state code, and state name
- Resolves against 2010 census boundaries — the vintage the Form 477 deployment dataset is keyed by, so the block feeds `fcc_search_availability` directly
- Required first step before `fcc_search_availability` — the broadband deployment dataset is indexed by census block, not address

---

### `fcc_search_availability`

Query which ISPs serve a specific census block and what speeds they advertise.

- Requires a 15-digit census block FIPS on 2010 boundaries; use `fcc_geocode_block` to convert coordinates first
- Filter by any Form 477 technology code — 0 (all other), 10/11/12 (asymmetric xDSL, ADSL2, VDSL), 20 (symmetric xDSL), 30 (other copper wireline), 40–43 (cable modem, unqualified through DOCSIS 3.1), 50 (fiber to the end user), 60 (satellite), 70 (terrestrial fixed wireless), 90 (electric power line)
- Filter by minimum advertised download speed in Mbps
- Filter to consumer-only or business-only service
- Returns per-provider records with `hoconum`, `techcode`, `maxaddown`, `maxadup`, `consumer`, `business`
- Coverage is Form 477 data through June 2021 — reflects ISP-reported availability at census block granularity (not address-level)

---

### `fcc_get_coverage_summary`

Analyze broadband access across any US geography at a given speed threshold.

- Supports seven geography types: `nation`, `state`, `county`, `cd` (congressional district), `place` (census-designated place), `cbsa` (metro area), `tribal`
- Technology filter: any wired/fixed wireless (`acfosw`), fiber only (`f`), cable (`c`), DSL (`a`), satellite (`s`), fixed wireless (`w`), or combinations
- Speed thresholds: 0.2, 4, 10, 25 (FCC legacy broadband definition), 100 (BEAD standard), 250, 1000 Mbps
- Returns population breakdowns: zero providers (unserved), one (no competition), two, three-plus; coverage %, unserved %, competitive %
- Per-segment breakdown by urban/rural and tribal/non-tribal for equity analysis

---

### `fcc_compare_areas`

Rank geographies by broadband access metrics to identify where underservice is worst.

- Compare up to 50 geographies of the same type, or all 50 states + DC via `compare_all_states: true`
- Sort by unserved population share, raw unserved headcount (useful for BEAD funding allocation), coverage rate, or competitive share
- Every sort ranks worst-first — rank 1 is the area most in need, whichever metric you pick
- Returns a ranked table with per-geography population and coverage metrics
- Each row includes the resolved geography name alongside its GEOID when available

---

### `fcc_find_underserved`

Find the most broadband-underserved areas within a state or nationwide.

- Scope to a specific state or territory, or run nationwide (returns top areas only)
- Geography granularity: county, congressional district, census place, or CBSA
- Default filter: rural areas only — where underservice is most concentrated
- `min_unserved_pop` defaults to 1, so fully covered areas stay out of the ranking; set it to 0 to rank every area, or higher to drop small gaps
- Results ranked by unserved population, highest first
- Each row includes the resolved geography name alongside its GEOID when available

---

### `fcc_search_providers`

Look up ISPs by name or state to get `hoconum` identifiers for follow-up queries.

- Case-insensitive partial name match — e.g., `"Comcast"`, `"T-Mobile"`, `"Frontier"`
- Filter by 2-letter state abbreviation or technology code
- Returns deduplicated holding companies with `hoconum`, states served, and technology codes
- Geographic filtering is state-level; sub-state granularity requires cross-referencing block data via `fcc_search_availability`
- Up to 200 results per call

---

### `fcc_list_filing_periods`

Discover valid data vintages before querying download manifests.

- Form 477 periods (Jun 2015–Jun 2021) are hardcoded — always available, no credentials needed
- BDC as-of dates (Jun 2022 onward) are fetched live from the authenticated API — requires `FCC_BDC_USERNAME` and `FCC_BDC_HASH_VALUE`
- Call before `fcc_list_downloads` to determine valid `as_of_date` values

---

### `fcc_list_downloads`

List BDC bulk data files available for download for a specific filing period.

- Requires BDC API credentials (`FCC_BDC_USERNAME`, `FCC_BDC_HASH_VALUE`)
- Filter by data type (availability or challenge), file category, technology type, state, or provider name
- Returns file metadata — provider, state, technology, record count — plus download URLs
- Returns file manifests, not file contents; BDC CSVs are large zipped files not suitable for inline API response
- Paged with `limit` (default 50, max 200) and `offset` — `totalFiles` counts every file matching the filters, and each response reports its offset, its file count, and a `nextOffset` to pass back, omitted on the last page
- An `as_of_date` that is not a calendar date, or that falls before the first BDC period (2022-06-30), is rejected without credentials; a well-formed date BDC does not publish is rejected once credentials allow the published set to be read

## Resources and prompts

| Type | Name | Description |
|:---|:---|:---|
| Resource | `fcc-broadband://geography/{type}/{id}/summary` | Broadband coverage summary for a specific geography: provider counts by speed tier, urban/rural split, tribal breakdown. Addressable by type and GEOID. |
| Resource | `fcc-broadband://providers/list/{offset}` | One page of the Form 477 holding-company directory: 25 `hoconum` identifiers with company names, the directory total, and the offset of the next page. Start at `fcc-broadband://providers/list/0`. |
| Prompt | `broadband_equity_analysis` | Structures a digital divide analysis comparing broadband access across demographic groups — guides chaining with Census and BLS data. Accepts `region` and `focus` (`underserved`, `rural`, `tribal`, `all`). |

All resource data is also reachable via tools. The directory pages the provider summary table and resolves each name with a single-`hoconum` lookup — to find one company by name rather than paging, use `fcc_search_providers`.

## Features

Built on [`@cyanheads/mcp-ts-core`](https://www.npmjs.com/package/@cyanheads/mcp-ts-core):

- Declarative tool, resource, and prompt definitions — single file per primitive, framework handles registration and validation
- Unified error handling — handlers throw, framework catches, classifies, and formats
- Pluggable auth: `none`, `jwt`, `oauth`
- Swappable storage backends: `in-memory`, `filesystem`, `Supabase`, `Cloudflare KV/R2/D1`
- Structured logging with optional OpenTelemetry tracing
- STDIO and Streamable HTTP transports

FCC broadband-specific:

- Wraps three FCC data sources: Form 477 public data via Socrata (no auth, 2015–2021), BDC Public Data API (authenticated, Jun 2022 onward), and FCC Geo API (no auth)
- Auth-optional design — BDC tools return a structured `credentials_required` error with setup instructions when credentials are absent; all Form 477 and geocoding tools always work without credentials
- Area Table aggregation for equity analysis — uses the pre-aggregated geography table (`xvwq-qtaj`) instead of querying the 50M-row deployment table, enabling fast coverage analysis at county and state scale
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

- [Bun v1.3.0](https://bun.sh/) or higher (or Node.js v24+).
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

Issues and pull requests are welcome. Run checks and tests before submitting:

```sh
bun run devcheck
bun run test
```

## License

Apache-2.0 — see [LICENSE](LICENSE) for details.
