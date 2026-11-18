import { createMcpHandler } from 'mcp-handler';
import { z } from 'zod/v4';
import { createProposal } from '@/lib/proposals/engine';
import {
  breadPriceProposalSchema,
  dealProposalSchema,
  homeMadeProposalSchema,
  ingredientPriceProposalSchema,
  recipeProposalSchema,
  sizePriceProposalSchema,
  type ProposalInput,
} from '@/lib/proposals/types';
import {
  ToolInputError,
  getIngredientPrices,
  getLoafCosts,
  getRecipes,
  getSales,
  listBreads,
} from './reads';

/**
 * The bakery MCP server: five read tools and six propose tools, bound to one
 * bakery. A propose tool stores a pending proposal and changes nothing; only the
 * owner's approval on the chat's card applies it (see the decision route), and
 * there is deliberately no tool that approves or rejects.
 *
 * The handler is built per request around the bakery the bearer key resolved
 * to, so no tool ever takes a bakery id from Claude.
 */

type ToolResult = { content: { type: 'text'; text: string }[]; isError?: boolean };

const ok = (value: unknown): ToolResult => ({ content: [{ type: 'text', text: JSON.stringify(value) }] });
const fail = (message: string): ToolResult => ({ content: [{ type: 'text', text: message }], isError: true });

const IDS = 'Ids come from list_breads, get_recipes or get_ingredient_prices.';
const MONEY = 'Money is a decimal string such as "32" or "32.50", in shekels.';
const PROPOSES =
  'This only proposes: nothing changes until the owner approves it on the card in the chat. ' +
  'Propose only what the user asked for or agreed to, and one change per proposal.';

/** Runs one tool call with the [mcp] timing line; an expected input error goes back to Claude as its text. */
async function run(groupId: number, tool: string, work: () => Promise<ToolResult>): Promise<ToolResult> {
  const started = Date.now();
  let outcome = 'ok';
  try {
    const result = await work();
    if (result.isError) outcome = 'err';
    return result;
  } catch (e) {
    outcome = 'err';
    if (e instanceof ToolInputError) return fail(e.message);
    // Drizzle's message embeds the query parameters (prices, recipe numbers):
    // log only the underlying cause.
    const cause = e instanceof Error && e.cause instanceof Error ? e.cause : e;
    console.error(`[mcp] ${tool} failed group=${groupId}: ${cause instanceof Error ? cause.message : String(cause)}`);
    return fail('Internal error. Nothing was changed. Try again later.');
  } finally {
    console.log(`[mcp] group=${groupId} tool=${tool} ms=${Date.now() - started} ${outcome}`);
  }
}

export function mcpHandlerForGroup(groupId: number): (req: Request) => Promise<Response> {
  return createMcpHandler(
    (server) => {
      const read = (
        name: string,
        title: string,
        description: string,
        inputSchema: z.ZodObject,
        work: (args: never) => Promise<unknown>
      ) =>
        server.registerTool(
          name,
          { title, description, inputSchema, annotations: { readOnlyHint: true } },
          ((args: never) => run(groupId, name, async () => ok(await work(args)))) as never
        );

      const propose = (
        name: string,
        title: string,
        description: string,
        inputSchema: z.ZodObject,
        toInput: (args: never) => ProposalInput
      ) =>
        server.registerTool(
          name,
          { title, description: `${description} ${PROPOSES}`, inputSchema, annotations: { readOnlyHint: false, destructiveHint: false } },
          ((args: never) =>
            run(groupId, name, async () => {
              const res = await createProposal(groupId, toInput(args));
              if (!res.ok) return fail(res.error);
              const p = res.proposal;
              return ok({ proposalId: p.id, status: 'pending', summary: p.summaryHe, expiresAt: p.expiresAt });
            })) as never
        );

      read(
        'list_breads',
        'List breads',
        'Every bread of the bakery, inactive ones included (marked active:false), with its sizes (id, weight, the size\'s own price, ' +
          'this bread\'s own price override if any, and the price that applies), its quantity deals (dealScope "size" is the size-wide deal ' +
          'for a size this bread offers, "bread" is a deal for this bread alone and wins over the size-wide one at the same quantity), ' +
          'and its additions. Also the additions surcharge. Ids are used by the propose tools. ' + MONEY,
        z.object({}),
        () => listBreads(groupId)
      );
      read(
        'get_recipes',
        'Get recipes',
        'Recipes of the breads that have one: ingredients with name, kind (flour, water, salt, starter, other), pctOfFinished ' +
          '(grams per 100 g of finished loaf, bake loss included, so a recipe sums to a little over 100) and bakersPct (percent of the flour), ' +
          'the total hydration and when the recipe last changed. Hydration counts the flour and liquid inside home-made ingredients ' +
          '(starters, tangzhong) by their own hydration; hydrationLeavesOut names starters with no settings, which it cannot count. ' +
          'Pass breadTypeId for one bread.',
        z.object({ breadTypeId: z.number().int().positive().optional() }),
        (args: { breadTypeId?: number }) => getRecipes(groupId, args.breadTypeId)
      );
      read(
        'get_ingredient_prices',
        'Get ingredient prices',
        'Price per kg of each priced ingredient (name and kind); homeMade, the ingredients the bakery makes itself (every starter, and any ' +
          'other ingredient marked so, such as tangzhong) with their flour, liquid, hydration (liquid per 100 g flour), waste factor and derived ' +
          'price per kg (setUp false: no flour chosen yet, so unpriced); and the ingredients used in recipes that have no price yet. ' +
          'Starters and marked ingredients are priced from their flour, liquid, hydration and waste, not typed. ' + MONEY,
        z.object({}),
        () => getIngredientPrices(groupId)
      );
      read(
        'get_loaf_costs',
        'Get loaf costs',
        'Per bread and size with a weight: ingredient cost of one loaf, cost per kg, the selling price that applies and the margin. ' +
          'When complete is false some ingredients have no price: cost is then only the priced part, margin is null, and unpriced lists what is missing. ' +
          'Never treat an incomplete cost as the real one.',
        z.object({}),
        () => getLoafCosts(groupId)
      );
      read(
        'get_sales',
        'Get sales',
        'Units sold per bread and size per month, and per month the orders, units and amount billed, for orders delivered in a year ' +
          '(Israel calendar). year defaults to the current one.',
        z.object({ year: z.number().int().optional() }),
        (args: { year?: number }) => getSales(groupId, args.year)
      );

      propose(
        'propose_recipe',
        'Propose a recipe change',
        'Replace one bread\'s whole ingredient list. Send every ingredient the recipe should have afterwards: rows missing from the list are removed. ' +
          'Give each row exactly one of pctOfFinished (grams per 100 g of finished loaf) or grams (then referenceFinishedGrams is the finished loaf weight those grams are for). ' +
          'Names are free text; keep the existing spelling of an ingredient so its price still applies. ' + IDS,
        recipeProposalSchema,
        (args: z.infer<typeof recipeProposalSchema>) => ({ kind: 'recipe', ...args })
      );
      propose(
        'propose_size_price',
        'Propose a size price',
        'Change the price of a size, which applies to every bread of that size that has no price of its own. ' + IDS + ' ' + MONEY,
        sizePriceProposalSchema,
        (args: z.infer<typeof sizePriceProposalSchema>) => ({ kind: 'size_price', ...args })
      );
      propose(
        'propose_bread_price',
        'Propose a bread price',
        'Set one bread\'s own price for a size it already offers, or pass price null to remove it so the size\'s price applies again. ' +
          'It never adds a size to a bread. ' + IDS + ' ' + MONEY,
        breadPriceProposalSchema,
        (args: z.infer<typeof breadPriceProposalSchema>) => ({ kind: 'bread_price', ...args })
      );
      propose(
        'propose_deal',
        'Propose a quantity deal',
        'Set, change or remove (price null) a quantity deal: minQty units of a size for the given total price. ' +
          'breadTypeId null is the size-wide deal, a bread id makes it that bread\'s own deal. ' + IDS + ' ' + MONEY,
        dealProposalSchema,
        (args: z.infer<typeof dealProposalSchema>) => ({ kind: 'deal', ...args })
      );
      propose(
        'propose_ingredient_price',
        'Propose an ingredient price',
        'Set the price per kg of one ingredient, by its name and kind exactly as get_ingredient_prices shows them. ' +
          'Only that ingredient changes. Home-made ingredients cannot be set here (use propose_home_made_ingredient). ' + MONEY,
        ingredientPriceProposalSchema,
        (args: z.infer<typeof ingredientPriceProposalSchema>) => ({ kind: 'ingredient_price', ...args })
      );
      propose(
        'propose_home_made_ingredient',
        'Propose home-made ingredient settings',
        'Set how one home-made ingredient is made: one flour, one liquid, hydration (liquid per 100 g of flour) and a waste factor (1 or more), ' +
          'by its name and kind (starter or other) as get_ingredient_prices shows them. Its price per kg is then derived from them. ' +
          'For an "other" ingredient (such as tangzhong) this also makes it home-made and removes its typed price. ' +
          'Usual hydration: regular starter 100, stiff starter 50-60, tangzhong 500 (1:5). ' +
          'Names are free text; keep the existing spelling of an ingredient so recipes and prices still match it.',
        homeMadeProposalSchema,
        (args: z.infer<typeof homeMadeProposalSchema>) => ({ kind: 'home_made', ...args })
      );
    },
    { serverInfo: { name: 'bakery', version: '1.0.0' } }
  );
}
