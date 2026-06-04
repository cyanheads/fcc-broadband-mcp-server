# Changelog

All notable changes to this project. Each entry links to its full per-version file in [changelog/](changelog/).

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
