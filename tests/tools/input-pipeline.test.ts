/**
 * @fileoverview Pipeline-seam coverage of the argument path a `tools/call`
 * takes on either side of the `input` schema: the ordered pre-validation stages
 * that run before the parse, and the envelope a rejection comes back in.
 *
 * `strict-inputs.test.ts` asserts the same surface one level down, against the
 * Zod schema alone. That level cannot see a key the pre-validation step drops
 * or rewrites before the parse ever runs, nor the code and text a caller
 * receives — so a stage silently turning off, or a rejection losing its reason,
 * would leave that suite green. Every case here goes through
 * `runToolContract`, which calls the same `parseToolArguments` the production
 * handler factory does.
 * @module tests/tools/input-pipeline.test
 */

import { JsonRpcErrorCode, McpError } from '@cyanheads/mcp-ts-core/errors';
import { runToolContract } from '@cyanheads/mcp-ts-core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { compareAreasTool } from '@/mcp-server/tools/definitions/compare-areas.tool.js';
import { getProviderTool } from '@/mcp-server/tools/definitions/get-provider.tool.js';

const mockGetAreaStatsBatch = vi.fn();
const mockGetGeographyNames = vi.fn();
const mockGetProviderSummary = vi.fn();

vi.mock('@/services/open-data/open-data-service.js', () => ({
  getOpenDataService: () => ({
    getAreaStatsBatch: mockGetAreaStatsBatch,
    getGeographyNames: mockGetGeographyNames,
    getProviderSummary: mockGetProviderSummary,
  }),
}));

const MOCK_STATS = [
  {
    id: '53',
    type: 'state',
    tech: 'acfosw',
    speed: '25',
    noCoverage: 100_000,
    oneProvider: 200_000,
    twoProviders: 300_000,
    threeOrMore: 400_000,
    total: 1_000_000,
  },
  {
    id: '06',
    type: 'state',
    tech: 'acfosw',
    speed: '25',
    noCoverage: 50_000,
    oneProvider: 150_000,
    twoProviders: 250_000,
    threeOrMore: 550_000,
    total: 1_000_000,
  },
];

/** The comparison's `geography_ids`, as the caller's canonical spelling. */
const IDS = ['53', '06'];

type ToolResult = {
  isError?: boolean;
  content?: Array<{ type: string; text?: string }>;
  structuredContent?: Record<string, unknown>;
};

/** The concatenated text blocks of a result — the `content[]` surface. */
function text(result: ToolResult): string {
  return (result.content ?? [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text ?? '')
    .join('');
}

/** The `structuredContent.error` envelope of a failed result. */
function errorEnvelope(result: ToolResult): {
  code?: number;
  message?: string;
  data?: { reason?: string; recovery?: { hint?: string }; retryable?: boolean };
} {
  return (result.structuredContent?.error ?? {}) as ReturnType<typeof errorEnvelope>;
}

/** The compared GEOIDs a successful result ranked, in rank order. */
function rankedIds(result: ToolResult): string[] {
  const areas = (result.structuredContent?.areas ?? []) as Array<{ id: string }>;
  return areas.map((a) => a.id);
}

describe('tool argument pipeline', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAreaStatsBatch.mockResolvedValue(MOCK_STATS);
    mockGetGeographyNames.mockResolvedValue(new Map<string, string>());
  });

  describe('pre-validation stages', () => {
    /*
     * The three stages exist because a strict root rejects an unrecognized key
     * by name, which is right for a misspelling the caller can fix and wrong
     * when the arguments the model wrote were correct and something between the
     * model and the schema was not. A stage that stopped running would surface
     * here as a rejection where the assertion expects a ranked result.
     */

    it('drops a client-added _meta key instead of rejecting the call', async () => {
      const result = (await runToolContract(compareAreasTool, {
        geography_type: 'state',
        geography_ids: IDS,
        _meta: { progressToken: 'abc' },
      } as never)) as ToolResult;

      expect(result.isError).toBeFalsy();
      expect(rankedIds(result)).toEqual(IDS);
    });

    it('rewrites a camelCase spelling of a declared key to the canonical one', async () => {
      const result = (await runToolContract(compareAreasTool, {
        geographyType: 'state',
        geographyIds: IDS,
      } as never)) as ToolResult;

      expect(result.isError).toBeFalsy();
      expect(rankedIds(result)).toEqual(IDS);
      expect(mockGetAreaStatsBatch).toHaveBeenCalledWith(
        expect.objectContaining({ geographyType: 'state', geographyIds: IDS }),
        expect.anything(),
      );
    });

    it('repairs a JSON-stringified array after the parse fails', async () => {
      const result = (await runToolContract(compareAreasTool, {
        geography_type: 'state',
        geography_ids: JSON.stringify(IDS),
      } as never)) as ToolResult;

      expect(result.isError).toBeFalsy();
      expect(rankedIds(result)).toEqual(IDS);
    });

    it('still rejects a key that is neither client bookkeeping nor an alias', async () => {
      const result = (await runToolContract(compareAreasTool, {
        geography_type: 'state',
        geography_ids: IDS,
        not_a_real_key: 'x',
      } as never)) as ToolResult;

      expect(result.isError).toBe(true);
      expect(errorEnvelope(result).code).toBe(JsonRpcErrorCode.InvalidParams);
      expect(mockGetAreaStatsBatch).not.toHaveBeenCalled();
    });
  });

  describe('argument rejection envelope', () => {
    /** One rejection, reused across the assertions that read it. */
    async function reject(): Promise<ToolResult> {
      return (await runToolContract(compareAreasTool, {
        geography_type: 'state',
        geography_ids: IDS,
        not_a_real_key: 'x',
      } as never)) as ToolResult;
    }

    it('classifies InvalidParams rather than ValidationError', async () => {
      // -32602 is what a client receives; -32007 never reaches the wire here.
      expect(errorEnvelope(await reject()).code).toBe(JsonRpcErrorCode.InvalidParams);
      expect(errorEnvelope(await reject()).code).not.toBe(JsonRpcErrorCode.ValidationError);
    });

    it('names the offending key and carries the invalid_arguments reason', async () => {
      const result = await reject();
      expect(errorEnvelope(result).message).toContain('not_a_real_key');
      expect(errorEnvelope(result).data?.reason).toBe('invalid_arguments');
    });

    it('synthesizes a recovery hint listing the keys the tool accepts', async () => {
      const hint = errorEnvelope(await reject()).data?.recovery?.hint ?? '';
      expect(hint).toContain('not_a_real_key');
      expect(hint).toContain('geography_type');
      expect(hint).toContain('geography_ids');
    });

    it('mirrors the hint and the reason into content[] text', async () => {
      const rendered = text(await reject());
      expect(rendered).toContain('not_a_real_key');
      expect(rendered).toContain('Recovery: ');
      expect(rendered).toContain('(reason invalid_arguments)');
    });

    it('rejects a wrong-typed declared value the same way', async () => {
      const result = (await runToolContract(compareAreasTool, {
        geography_type: 'state',
        geography_ids: [53, 6],
      } as never)) as ToolResult;

      expect(errorEnvelope(result).code).toBe(JsonRpcErrorCode.InvalidParams);
      expect(errorEnvelope(result).data?.reason).toBe('invalid_arguments');
      expect(mockGetAreaStatsBatch).not.toHaveBeenCalled();
    });

    it('renders a missing required field as missing', async () => {
      const result = (await runToolContract(compareAreasTool, {
        geography_ids: IDS,
      } as never)) as ToolResult;

      expect(errorEnvelope(result).code).toBe(JsonRpcErrorCode.InvalidParams);
      expect(text(result)).toContain('geography_type');
    });
  });

  describe('handler error rendering', () => {
    it('closes a handler-thrown contract error with its reason', async () => {
      const result = (await runToolContract(compareAreasTool, {
        geography_type: 'county',
        compare_all_states: true,
      } as never)) as ToolResult;

      // A handler-thrown contract error keeps its declared code — only the
      // argument-rejection path moved to InvalidParams.
      expect(errorEnvelope(result).code).toBe(JsonRpcErrorCode.ValidationError);
      expect(errorEnvelope(result).data?.reason).toBe('invalid_all_states_combo');
      expect(text(result)).toContain('(reason invalid_all_states_combo)');
    });

    it('closes a non-retryable service error with the retryable term', async () => {
      /*
       * The shape `OpenDataService.getProviderSummary` builds for a live
       * lookup that breached its deadline; the service's own suite pins the
       * construction, this pins what a caller is shown.
       */
      mockGetProviderSummary.mockRejectedValue(
        new McpError(JsonRpcErrorCode.Timeout, 'FCC Open Data provider lookup timed out.', {
          reason: 'live_provider_timeout',
          retryable: false,
          recovery: { hint: 'Try again later, or enable the local Form 477 mirror.' },
        }),
      );

      const result = (await runToolContract(getProviderTool, {
        hoconum: '130317',
      } as never)) as ToolResult;

      expect(errorEnvelope(result).code).toBe(JsonRpcErrorCode.Timeout);
      expect(text(result)).toContain('(reason live_provider_timeout · not retryable)');
    });
  });
});
