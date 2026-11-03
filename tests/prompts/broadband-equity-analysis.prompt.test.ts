/**
 * @fileoverview Broadband equity prompt arguments and analysis instructions.
 * @module tests/prompts/broadband-equity-analysis.prompt.test
 */

import { describe, expect, it } from 'vitest';
import { broadbandEquityAnalysisPrompt as prompt } from '@/mcp-server/prompts/definitions/broadband-equity-analysis.prompt.js';

describe('broadband_equity_analysis', () => {
  it('uses historical population screening without inferring eligibility or address service', async () => {
    const messages = await prompt.generate(prompt.args!.parse({ region: 'MS', focus: 'all' }));
    const content = messages[0]!.content;
    if (content.type !== 'text') throw new Error('Expected text prompt');
    expect(content.text).toContain('acfow');
    expect(content.text).toContain('100/10');
    expect(content.text).toContain('all fixed wireless');
    expect(content.text).toContain('cannot establish current BEAD eligibility or address service');
    expect(content.text).not.toContain('Identify BEAD-eligible locations');
  });
  it.each([
    ['underserved', 'Focus on areas with zero broadband providers'],
    ['rural', 'Focus on rural vs. urban broadband disparities'],
    ['tribal', 'Focus on tribal land connectivity'],
    ['all', 'Conduct a comprehensive analysis covering:'],
  ])(
    'generates the %s analysis with regional context and data limitations',
    async (focus, instruction) => {
      const args = prompt.args!.parse({ region: 'King County WA', focus });
      const messages = await prompt.generate(args);
      expect(messages).toHaveLength(1);
      expect(messages[0]).toMatchObject({ role: 'user', content: { type: 'text' } });
      const content = messages[0]?.content;
      expect(content?.type).toBe('text');
      if (content?.type !== 'text') throw new Error('Expected text prompt');
      expect(content.text).toContain('**King County WA**');
      expect(content.text).toContain(instruction);
      expect(content.text).toContain('fcc_get_coverage_summary');
      expect(content.text).toContain('fcc_search_providers');
      expect(content.text).toContain('fcc_compare_areas');
      expect(content.text).toContain('as of June 2021');
      expect(content.text).toContain('not queryable row-by-row via this server');
      expect(content.text).toContain('### Step 5');
    },
  );

  it.each([
    undefined,
    {},
    { region: 'DC' },
    { focus: 'all' },
    { region: 'DC', focus: 'unsupported' },
    { region: 11, focus: 'all' },
  ])('rejects missing or invalid required arguments: %j', (args) => {
    expect(prompt.args!.safeParse(args).success).toBe(false);
  });

  it('preserves an empty region because the current schema accepts all strings', async () => {
    const args = prompt.args!.parse({ region: '', focus: 'all' });
    const messages = await prompt.generate(args);
    expect(messages[0]).toMatchObject({ content: { text: expect.stringContaining('for: ****') } });
  });
});
