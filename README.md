<div align="center">
  <h1>@cyanheads/fcc-broadband-mcp-server</h1>
  <p><b>Access FCC broadband availability, coverage analysis, and digital divide data for US geographies and census blocks via MCP. STDIO or Streamable HTTP.</b>
  <div>9 Tools • 2 Resources • 1 Prompt</div>
  </p>
</div>

<div align="center">

[![Version](https://img.shields.io/badge/Version-0.2.3-blue.svg?style=flat-square)](./CHANGELOG.md) [![License](https://img.shields.io/badge/License-Apache%202.0-orange.svg?style=flat-square)](./LICENSE) [![Docker](https://img.shields.io/badge/Docker-ghcr.io-2496ED?style=flat-square&logo=docker&logoColor=white)](https://github.com/users/cyanheads/packages/container/package/fcc-broadband-mcp-server) [![MCP SDK](https://img.shields.io/badge/MCP%20SDK-^2.2.0-green.svg?style=flat-square)](https://modelcontextprotocol.io/) [![npm](https://img.shields.io/npm/v/@cyanheads/fcc-broadband-mcp-server?style=flat-square&logo=npm&logoColor=white)](https://www.npmjs.com/package/@cyanheads/fcc-broadband-mcp-server) [![TypeScript](https://img.shields.io/badge/TypeScript-^7.0.2-3178C6.svg?style=flat-square)](https://www.typescriptlang.org/) [![Bun](https://img.shields.io/badge/Bun-v1.4.2-blueviolet.svg?style=flat-square)](https://bun.sh/)

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

FCC broadband data from Form 477 (June 2015 – June 2021) and the Broadband Data Collection (June 2022 onward). Geocode coordinates to census blocks, look up the ISPs and advertised speeds at a block, and summarize, compare, or rank geographies by unserved population for BEAD and equity research. Runs as a stdio process, a local Streamable HTTP server, or the public hosted endpoint above.

### Tools

| Tool | Description |
|:---|:---|
| `fcc_geocode_block` | Convert a lat/lon coordinate to a 2010-vintage census block FIPS code, with county and state identifiers |
| `fcc_search_availability` | List the providers and advertised speeds at a census block, filtered by technology and speed |
| `fcc_get_coverage_summary` | Population by provider count for one geography, split by urban/rural and tribal/non-tribal |
| `fcc_compare_areas` | Rank coverage across several geographies of the same type, worst first |
| `fcc_find_underserved` | Rank the most underserved areas in a state or nationwide by unserved population |
| `fcc_search_providers` | Search holding companies by name, state, and technology; returns `hoconum` identifiers |
| `fcc_get_provider` | National coverage profile for one holding company: technologies and population per speed tier |
| `fcc_list_filing_periods` | List data vintages: Form 477 filing periods and BDC as-of dates |
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

## Capability reference

### `fcc_geocode_block` <sub>tool</sub>

- `latitude` and `longitude` in decimal degrees, resolved against 2010 census boundaries through the FCC Geo API
- Returns `blockFips` (15 digits, ready for `fcc_search_availability`), `censusVintage`, `countyFips`, `countyName`, `stateFips`, `stateCode`, and `stateName`; coordinates over water or outside US coverage fail as `block_not_found`

---

### `fcc_search_availability` <sub>tool</sub>

- `block_fips` (15 digits, 2010 vintage) is required; `tech_filter` (Form 477 technology codes), `min_speed_down` (Mbps), and `consumer` (`true` consumer, `false` business) narrow the rows
- One row per offering with `hoconum`, `techCode` / `techLabel`, `maxDownloadMbps`, `maxUploadMbps`, `consumer`, and `business`, plus `totalProviders` counting distinct holding companies; an unfiltered block with no providers fails as `block_not_found`, while a filtered query that matches nothing returns an empty list with a `notice`

---

### `fcc_get_coverage_summary` <sub>tool</sub>

- `geography_type` is one of `nation`, `state`, `county`, `cd`, `place`, `cbsa`, `tribal`; `geography_id` is required for every type but `nation`; `urban_rural_filter` (`all` / `R` / `U`) and `tribal_filter` (`all` / `T` / `N`) narrow the population
- Returns `population` by provider count (`noCoverage`, `oneProvider`, `twoProviders`, `threeOrMore`, `total`), `coveragePct`, `unservedPct`, `competitivePct`, and a per-segment `breakdown`; fails as `geography_not_found`, `invalid_geography_combo`, or `invalid_geography_id_shape`

---

### `fcc_compare_areas` <sub>tool</sub>

- 2 to 50 `geography_ids` of one `geography_type` (every type but `nation`), or `compare_all_states: true` for the 50 states plus DC; `sort_by` is `unserved_pct` (default), `unserved_pop`, `coverage_pct`, or `competitive_pct`
- Every sort ranks worst first, so `rank` 1 is the area most in need; rows carry `id`, `name` when resolved, the provider-count populations, and all three percentages. Fails as `missing_geography_ids`, `invalid_all_states_combo`, `invalid_geography_id_shape`, or `no_data_found`

---

### `fcc_find_underserved` <sub>tool</sub>

- `state` (USPS state or territory code) scopes the search, otherwise it runs nationwide; `geography_type` is `county` (default), `cd`, `place`, or `cbsa`; `urban_rural_filter` defaults to `R`, `min_unserved_pop` to 1, and `limit` to 20 (max 100)
- Areas ranked by `noCoverage`, each with `rank`, `id`, `name`, `oneProvider`, `total`, `unservedPct`, and `coveragePct`; `totalFound` counts matches before the limit. An unrecognized `state` fails as `unknown_state`, and filters that match nothing return an empty ranking with a `notice`

---

### `fcc_search_providers` <sub>tool</sub>

- `name_search` (case-insensitive partial name), `state`, and `tech_filter` are all optional and must hold on the same filing; `limit` defaults to 50 (max 200)
- Deduplicated holding companies with `hoconum`, `holdingCompanyName`, and national `statesServed` / `techCodes` that the filters never narrow. No match returns an empty list with a `notice`; a live search over its 30-second budget fails as `live_search_timeout`
- Against the live API, `scanTruncated: true` marks the list as a sample and `totalCount` is omitted; a full-corpus mirror (`FCC_MIRROR_ENABLED=true`) returns every match

---

### `fcc_get_provider` <sub>tool</sub>

- `hoconum` (digits only) from `fcc_search_providers` or the providers directory resource
- Returns `techCodes` / `techLabels` and `speedTierPopulation`, which counts each person once and omits empty tiers; business-only carriers come back with both lists empty. Fails as `provider_not_found`, or `live_provider_timeout` past the 30-second budget

---

### `fcc_list_filing_periods` <sub>tool</sub>

- Always returns the Form 477 periods; `include_bdc: true` adds BDC as-of dates when credentials are configured
- `periods` newest first, each with `asOfDate` and `source` (`form477` or `bdc`), plus `form477Count`, `bdcCount`, and `hasBdcCredentials`; missing credentials leave `bdcCount` at 0 rather than raising an error

---

### `fcc_list_downloads` <sub>tool</sub>

- `as_of_date` (`YYYY-MM-DD`) is required; filter by `data_type` (`availability` default, or `challenge`), `category` (`Summary`, `State`, `Provider`), `technology_type` (`Fixed Broadband`, `Mobile Broadband`, `Mobile Voice`), `state`, and `provider_name`; `limit` defaults to 50 (max 200), paged with `offset`
- Returns file metadata and a `downloadUrl` per file, not file contents; `totalFiles` counts every match and `nextOffset` is omitted on the last page. Fails as `credentials_required` or `invalid_as_of_date`

---

### `fcc-broadband://geography/{type}/{id}/summary` <sub>resource</sub>

- `type` takes the seven `fcc_get_coverage_summary` geography types; `id` is a FIPS GEOID checked for digit count, `0` for `nation`
- Fixed at 25 Mbps and `acfosw`; returns `population`, the three percentages, and `segments` as `application/json`. Use `fcc_get_coverage_summary` for other thresholds or filters

---

### `fcc-broadband://providers/list/{offset}` <sub>resource</sub>

- `offset` pages the directory 25 entries at a time in `hoconum` order; start at `0` and follow `nextOffset`
- Entries carry `hoconum` and, when resolved, `holdingCompanyName`; each page reports `total` and `count`. To find one company by name, use `fcc_search_providers`

---

### `broadband_equity_analysis` <sub>prompt</sub>

- Arguments: `region` (free text) and `focus` (`underserved`, `rural`, `tribal`, or `all`), both required
- Returns one user message laying out a five-step analysis: baseline coverage, focus area, demographic cross-reference, provider landscape, and BEAD context

## Features

Built on [`@cyanheads/mcp-ts-core`](https://github.com/cyanheads/mcp-ts-core): stdio and Streamable HTTP transports, pluggable auth (`none` / `jwt` / `oauth`), swappable storage (`in-memory`, `filesystem`, `Supabase`, `Cloudflare KV/R2/D1`), structured logging with optional OpenTelemetry tracing.

FCC-specific:

- Three FCC sources, all US government public-domain data: Form 477 on FCC Open Data (Socrata), the BDC Public Data API, and the FCC Geo API
- Every Form 477 tool and resource works without credentials and reads the June 2021 filing, the last one; BDC data is exposed only as bulk-file manifests, and `fcc_list_downloads` needs `FCC_BDC_USERNAME` and `FCC_BDC_HASH_VALUE`, failing as `credentials_required` without them
- The area tools share one vocabulary: `tech_filter` letters (`acfosw` for every technology, the default; `a` DSL, `c` cable, `f` fiber, `o` other, `s` satellite, `w` fixed wireless) and `speed_down` tiers (`0.2`, `4`, `10`, `25`, `100`, `250`, `1000` Mbps; default `25`, and `100` is the BEAD threshold)
- Coverage analysis reads the pre-aggregated Area Table (`xvwq-qtaj`), not the block-level deployment table, so state- and county-scale queries stay fast
- Optional local Form 477 mirror (`FCC_MIRROR_ENABLED=true`) serves queries from SQLite, falling back to the live API for anything not ingested

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

- [Bun v1.4.0](https://bun.sh/) or higher (or Node.js v24+).
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
| `FCC_MIRROR_ENABLED` | Serve Form 477 queries from the local SQLite mirror where its coverage allows. | `false` |
| `FCC_MIRROR_PATH` | Directory holding the mirror SQLite files. | `data/fcc-mirror` |
| `MCP_TRANSPORT_TYPE` | Transport: `stdio` or `http`. | `stdio` |
| `MCP_HTTP_PORT` | HTTP server port. | `3010` |
| `MCP_SESSION_MODE` | HTTP session mode: `stateless`, `stateful`, or `auto`. | `stateless` |
| `MCP_AUTH_MODE` | Authentication: `none`, `jwt`, or `oauth`. | `none` |
| `MCP_LOG_LEVEL` | Log level (`debug`, `info`, `warning`, `error`, etc.). | `info` |
| `LOGS_DIR` | Directory for log files (Node.js only). | `<project-root>/logs` |
| `STORAGE_PROVIDER_TYPE` | Storage backend: `in-memory`, `filesystem`, `supabase`, `cloudflare-kv/r2/d1`. | `in-memory` |
| `OTEL_ENABLED` | Enable [OpenTelemetry](https://github.com/cyanheads/mcp-ts-core/tree/main/docs/telemetry). | `false` |

See [`.env.example`](./.env.example) for the full list of optional overrides.

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

Form 477 is frozen at the June 2021 filing, so it can be ingested once into a local SQLite index. The mirror is off by default, and the full corpus is about 9 GB of source data and takes hours to ingest, so the bootstrap can be scoped to the states you query:

```sh
bun run mirror:init -- --states 11,53   # specific states by 2-digit FIPS (11 = DC, 53 = WA)
bun run mirror:init -- --full           # the whole corpus
bun run mirror:verify                   # coverage, row counts, SQLite integrity
```

Then set `FCC_MIRROR_ENABLED=true`. In Docker, run the same scripts with `docker exec <container> bun run mirror:init -- --states 11,53`. Run them from a source checkout or the image: the scripts import through the `@/` path alias, which an npm install does not map.

- Block and geography lookups serve from the mirror once the queried state is fully ingested; anything else falls back to the live API.
- `fcc_search_providers`, `fcc_get_provider`, and geographies with no state in their GEOID (`cbsa`, `tribal`, `nation`) serve from the mirror only after a `--full` ingest.
- Mirror name search matches word prefixes (`comc` finds "Comcast") where the live API matches any substring (`mcast`), so a mid-word fragment can return fewer results.
- The ingest is idempotent and resumes an interrupted run from its saved cursor. Set `FCC_OPENDATA_APP_TOKEN` first for a full ingest. Bun uses the built-in `bun:sqlite`; Node.js needs the optional `better-sqlite3` peer dependency.

## Project structure

| Directory | Purpose |
|:---|:---|
| `src/index.ts` | `createApp()` entry point — registers tools, resources, and prompts and inits services. |
| `src/config` | Server-specific environment variable parsing and validation with Zod. |
| `src/mcp-server/tools` | Tool definitions (`*.tool.ts`). Nine tools across FCC Open Data, the BDC API, and the Geo API. |
| `src/mcp-server/resources` | Resource definitions (`*.resource.ts`). Geography summary and provider directory. |
| `src/mcp-server/prompts` | Prompt definitions (`*.prompt.ts`). Broadband equity analysis prompt. |
| `src/services/open-data` | FCC Open Data (Socrata) service for Form 477 deployment, area, and provider tables; `mirror/` holds the local SQLite mirror. |
| `src/services/bdc-api` | BDC Public Data API service — authenticated filing periods and download manifests. |
| `src/services/geo-api` | FCC Geo API service — lat/lon to census block FIPS. |
| `scripts/` | Build, devcheck, and packaging scripts, plus `fcc-mirror-init.ts` / `fcc-mirror-verify.ts`. |
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
