/**
 * @fileoverview MCPB pruning preserves executable SDK skills modules.
 * @module tests/mcpb-agent-docs
 */
import { describe, expect, it } from 'vitest';
import { AGENT_DOC_ENTRY as cleaner } from '../scripts/clean-mcpb.js';
import { AGENT_DOC_ENTRY as linter } from '../scripts/lint-packaging.js';

describe('MCPB dependency agent documentation', () => {
  for (const [name, pattern] of [
    ['cleaner', cleaner],
    ['linter', linter],
  ] as const) {
    it(`${name} preserves SDK runtime skills`, () => {
      expect(
        pattern.test('node_modules/@modelcontextprotocol/server/dist/ext/skills/index.js'),
      ).toBe(false);
      expect(
        pattern.test('node_modules/@modelcontextprotocol/server/dist/ext/skills/SKILL.md'),
      ).toBe(false);
    });
    it(`${name} strips package-root agent documentation`, () => {
      for (const path of [
        'node_modules/@cyanheads/mcp-ts-core/framework-skills/add-tool/SKILL.md',
        'node_modules/example/skills/example/SKILL.md',
        'node_modules/example/node_modules/@scope/dep/.agents/instructions.md',
        'node_modules/example/SKILL.md',
      ])
        expect(pattern.test(path)).toBe(true);
    });
  }
});
