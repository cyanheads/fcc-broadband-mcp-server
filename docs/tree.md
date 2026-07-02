# fcc-broadband-mcp-server - Directory Structure

Generated on: 2026-07-02 13:35:50

```text
fcc-broadband-mcp-server/
├── .agents/
├── .claude/
├── .claude-plugin/
│   └── plugin.json
├── .codex-plugin/
│   ├── mcp.json
│   └── plugin.json
├── .github/
│   ├── ISSUE_TEMPLATE/
│   │   ├── bug_report.yml
│   │   ├── config.yml
│   │   └── feature_request.yml
│   └── FUNDING.yml
├── .vscode/
│   ├── extensions.json
│   └── settings.json
├── changelog/
│   ├── 0.1.x/
│   └── template.md
├── docs/
│   ├── design.md
│   └── idea.md
├── scripts/
│   ├── build-changelog.ts
│   ├── build.ts
│   ├── check-dependency-specifiers.ts
│   ├── check-docs-sync.ts
│   ├── check-framework-antipatterns.ts
│   ├── check-skill-versions.ts
│   ├── check-skills-sync.ts
│   ├── clean-mcpb.ts
│   ├── clean.ts
│   ├── devcheck.ts
│   ├── fcc-mirror-init.ts
│   ├── fcc-mirror-verify.ts
│   ├── lint-mcp.ts
│   ├── lint-packaging.ts
│   ├── list-skills.ts
│   ├── release-github.ts
│   └── tree.ts
├── skills/
│   ├── add-app-tool/
│   │   └── SKILL.md
│   ├── add-prompt/
│   │   └── SKILL.md
│   ├── add-resource/
│   │   └── SKILL.md
│   ├── add-service/
│   │   └── SKILL.md
│   ├── add-test/
│   │   └── SKILL.md
│   ├── add-tool/
│   │   └── SKILL.md
│   ├── api-auth/
│   │   └── SKILL.md
│   ├── api-canvas/
│   │   └── SKILL.md
│   ├── api-config/
│   │   └── SKILL.md
│   ├── api-context/
│   │   └── SKILL.md
│   ├── api-errors/
│   │   └── SKILL.md
│   ├── api-linter/
│   │   └── SKILL.md
│   ├── api-mirror/
│   │   └── SKILL.md
│   ├── api-services/
│   │   ├── references/
│   │   │   ├── graph.md
│   │   │   ├── llm.md
│   │   │   └── speech.md
│   │   └── SKILL.md
│   ├── api-telemetry/
│   │   └── SKILL.md
│   ├── api-testing/
│   │   └── SKILL.md
│   ├── api-utils/
│   │   ├── references/
│   │   │   ├── formatting.md
│   │   │   ├── parsing.md
│   │   │   └── security.md
│   │   └── SKILL.md
│   ├── api-workers/
│   │   └── SKILL.md
│   ├── code-simplifier/
│   │   └── SKILL.md
│   ├── design-mcp-server/
│   │   └── SKILL.md
│   ├── field-test/
│   │   └── SKILL.md
│   ├── git-wrapup/
│   │   └── SKILL.md
│   ├── maintenance/
│   │   └── SKILL.md
│   ├── orchestrations/
│   │   ├── workflows/
│   │   │   ├── field-test-fix.md
│   │   │   ├── fix-wrapup-release.md
│   │   │   ├── greenfield-build.md
│   │   │   └── maintenance-release.md
│   │   └── SKILL.md
│   ├── polish-docs-meta/
│   │   ├── references/
│   │   │   ├── agent-protocol.md
│   │   │   ├── package-meta.md
│   │   │   ├── readme.md
│   │   │   └── server-json.md
│   │   └── SKILL.md
│   ├── release-and-publish/
│   │   └── SKILL.md
│   ├── report-issue-framework/
│   │   └── SKILL.md
│   ├── report-issue-local/
│   │   └── SKILL.md
│   ├── security-pass/
│   │   └── SKILL.md
│   ├── setup/
│   │   └── SKILL.md
│   ├── techniques/
│   │   ├── references/
│   │   │   └── outline-on-overflow.md
│   │   └── SKILL.md
│   └── tool-defs-analysis/
│       └── SKILL.md
├── src/
│   ├── config/
│   │   └── server-config.ts
│   ├── mcp-server/
│   │   ├── prompts/
│   │   │   └── definitions/
│   │   │       ├── broadband-equity-analysis.prompt.ts
│   │   │       └── index.ts
│   │   ├── resources/
│   │   │   └── definitions/
│   │   │       ├── geography-summary.resource.ts
│   │   │       ├── index.ts
│   │   │       └── providers-list.resource.ts
│   │   └── tools/
│   │       └── definitions/
│   │           ├── compare-areas.tool.ts
│   │           ├── find-underserved.tool.ts
│   │           ├── geocode-block.tool.ts
│   │           ├── get-coverage-summary.tool.ts
│   │           ├── get-provider.tool.ts
│   │           ├── index.ts
│   │           ├── list-downloads.tool.ts
│   │           ├── list-filing-periods.tool.ts
│   │           ├── search-availability.tool.ts
│   │           └── search-providers.tool.ts
│   ├── services/
│   │   ├── bdc-api/
│   │   │   ├── bdc-api-service.ts
│   │   │   └── types.ts
│   │   ├── geo-api/
│   │   │   ├── geo-api-service.ts
│   │   │   └── types.ts
│   │   └── open-data/
│   │       ├── mirror/
│   │       │   ├── csv.ts
│   │       │   ├── form477-mirror.ts
│   │       │   ├── ingest.ts
│   │       │   ├── state-fips.ts
│   │       │   └── stores.ts
│   │       ├── open-data-service.ts
│   │       └── types.ts
│   └── index.ts
├── tests/
│   ├── prompts/
│   ├── resources/
│   │   ├── geography-summary.resource.test.ts
│   │   └── providers-list.resource.test.ts
│   ├── services/
│   │   └── open-data/
│   │       ├── form477-mirror.test.ts
│   │       └── mirror-helpers.test.ts
│   └── tools/
│       ├── compare-areas.tool.test.ts
│       ├── find-underserved.tool.test.ts
│       ├── geocode-block.tool.test.ts
│       ├── get-coverage-summary.tool.test.ts
│       ├── get-provider.tool.test.ts
│       ├── list-downloads.tool.test.ts
│       ├── list-filing-periods.tool.test.ts
│       ├── search-availability.tool.test.ts
│       └── search-providers.tool.test.ts
├── .dockerignore
├── .env.example
├── .gitignore
├── .mcpbignore
├── AGENTS.md
├── biome.json
├── bun.lock
├── bunfig.toml
├── CHANGELOG.md
├── CITATION.cff
├── CLAUDE.md
├── devcheck.config.json
├── Dockerfile
├── manifest.json
├── package.json
├── README.md
├── server.json
├── tsconfig.build.json
├── tsconfig.json
└── vitest.config.ts
```

_Note: This tree excludes files and directories matched by .gitignore and default patterns._
