# Changelog

All notable changes to this project. Each entry links to its full per-version file in [changelog/](changelog/).

## [0.1.13](changelog/0.1.x/0.1.13.md) — 2026-08-13

@cyanheads/mcp-ts-core ^0.10.10 → ^0.11.5 adoption, Form 477 mirror stores now enforce per-store query ceilings (#19), and the repo gains a LICENSE plus community/security docs.

## [0.1.12](changelog/0.1.x/0.1.12.md) — 2026-07-02

fcc_search_providers no longer retries its deterministic live GROUP BY timeout 4x — deadline aborts are classified as McpError(Timeout), the grouped query fails once with a non-retryable live_search_timeout and a recovery hint, and name searches drop the 10x grouped-row headroom.

## [0.1.11](changelog/0.1.x/0.1.11.md) — 2026-07-02

Opt-in local SQLite mirror of the frozen Form 477 corpus: state-scoped ingest via mirror:init/mirror:verify, coverage-gated serving with silent live-API fallback, FTS5 provider search, and FCC_MIRROR_ENABLED/FCC_MIRROR_PATH config.

## [0.1.10](changelog/0.1.x/0.1.10.md) — 2026-07-02 · 🛡️ Security

Fail-fast GEOID shape validation on fcc_get_coverage_summary and fcc_compare_areas, batched GEOID→name resolution in fcc_find_underserved and fcc_compare_areas output, mcp-ts-core ^0.10.10, and a lock refresh clearing 8 transitive advisories (hono, js-yaml).

## [0.1.9](changelog/0.1.x/0.1.9.md) — 2026-06-20

mcp-ts-core ^0.10.6 → ^0.10.9: ctx.content media collector, sharper Canvas SQL error classification, fresh-scaffold devcheck guards, plus two new devcheck steps (dependency specifiers, plugin-manifest checks) synced into the toolchain.

## [0.1.8](changelog/0.1.x/0.1.8.md) — 2026-06-12

mcp-ts-core ^0.9.21 → ^0.10.6; in-code identity name/title; truncation enrichment on find_underserved and search_providers; MCPB bundle agent-doc strip; optional BDC/Open Data credential env vars.

## [0.1.7](changelog/0.1.x/0.1.7.md) — 2026-06-04

Error contracts: migrate service-layer notFound throws to handler ctx.fail() with recovery hints (#9, #10); fix wrong error reason for missing geography_ids (#7).

## [0.1.6](changelog/0.1.x/0.1.6.md) — 2026-06-02

mcp-ts-core ^0.9.16 → ^0.9.21 — per-request log context fix, secret-stripped error messages, fail-fast retry logic.

## [0.1.5](changelog/0.1.x/0.1.5.md) — 2026-05-30

Enrichment adoption — search/coverage tools surface query echoes, result totals, and empty-result guidance in a typed enrichment block reaching both structuredContent and content[] channels.

## [0.1.4](changelog/0.1.x/0.1.4.md) — 2026-05-28

mcp-ts-core ^0.9.9 → ^0.9.13: 413 body cap, HTTP session-init gate, quieter 401/403/400/404 logging, GET /mcp keywords; error-code reclassifications (InvalidParams → ValidationError)

## [0.1.3](changelog/0.1.x/0.1.3.md) — 2026-05-26

Package metadata aligned to ecosystem standard: author, funding, scripts, install badges, FUNDING.yml

## [0.1.2](changelog/0.1.x/0.1.2.md) — 2026-05-25

Add mcpName and publish-mcp script for MCP Registry compatibility

## [0.1.1](changelog/0.1.x/0.1.1.md) — 2026-05-25

Field-test fixes — state filter, provider search, geography lookup, providers-list resource

## [0.1.0](changelog/0.1.x/0.1.0.md) — 2026-05-25

Initial release — 9 tools for FCC broadband availability, coverage analysis, digital divide, and BDC download manifests
