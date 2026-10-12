/**
 * The five HEY reads the plugin offers, framework-neutral. Each maps to one SDK read (research
 * resolves a contract or ticker first) and renders HEY's answer as text that keeps its semantics:
 * unknown stays unknown, market data is context, every answer carries its link, its as-of time and
 * the attribution line. The GAME worker and the ACP seller both call these.
 */
import type {
  HeyAgentChange,
  HeyAgentResponseOf,
  HeyClient,
  HeySearchSuggestion,
  HeySearchSuggestions,
} from '@hey-research-lab/sdk';

import { CAIP2, CHAIN_ID, CHAIN_NAME, UnsupportedChainError } from './chain.js';
import { isAddress, normalizeAddress } from './evm.js';
import { fromError, invalid, unsupportedChain, type HeyResult } from './result.js';
import { SITE_URL, agentText, clean, isoTime, plural, sourceLine, usd } from './text.js';

export const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,79}$/;
const PROJECT_TARGET = /^\/project\/([a-z0-9][a-z0-9-]{0,119})$/;
const NOT_ADVICE = 'Research evidence, not investment advice and not a safety verdict.';

export type ReadContext = { hey: HeyClient; now?: () => Date };

/**
 * A chain id as a framework passes it (a string, usually) or as JSON carries it. Absent means
 * Robinhood Chain; `4663` and `eip155:4663` are accepted; anything else is `unsupported_chain`.
 */
export function checkChain(value: unknown): HeyResult | null {
  if (value === undefined || value === null || value === '') return null;
  if (value === CHAIN_ID || value === String(CHAIN_ID) || value === CAIP2) return null;
  return unsupportedChain(value);
}

function intArg(
  name: string,
  value: string | number | undefined,
  min: number,
  max: number,
  fallback: number,
): number | HeyResult {
  if (value === undefined || value === '') return fallback;
  const n = typeof value === 'number' ? value : Number(String(value).trim());
  if (!Number.isInteger(n) || n < min || n > max) {
    return invalid('invalid_argument', `${name} must be a whole number from ${min} to ${max}.`);
  }
  return n;
}

function slugOf(target: string): string | undefined {
  return PROJECT_TARGET.exec(target)?.[1];
}

async function guarded(read: () => Promise<HeyResult>): Promise<HeyResult> {
  try {
    return await read();
  } catch (error) {
    if (error instanceof UnsupportedChainError) return unsupportedChain(error.chainId);
    return fromError(error);
  }
}

// ---------------------------------------------------------------------------
// 1. Research a project, ticker or contract
// ---------------------------------------------------------------------------

type ResearchAnswer = HeyAgentResponseOf<'research_project'>;

function changeLine(change: HeyAgentChange): string {
  const when = change.occurredAt
    ? `${isoTime(change.occurredAt)} (${change.precision})`
    : `date not given by its source; HEY detected it ${isoTime(change.detectedAt)}`;
  const counts = change.countsAsBuilding ? 'counts as building' : 'context, not building';
  const verification = change.verification ? `, ${change.verification}` : '';
  const evidence = change.evidence[0]?.id ?? change.id;
  return `${agentText(change.summary, 200)} — ${change.type}, ${when}, ${counts}${verification}, ${change.status}; evidence ${evidence}`;
}

function stillBuildingLine(b: NonNullable<ResearchAnswer['data']>['builderState']): string {
  switch (b.stillBuildingState) {
    case 'HELD':
      return 'held (verified building through a market drawdown HEY tracked; not a price view)';
    case 'NOT_HELD':
      return 'not held (measured)';
    case 'NOT_MEASURED':
      return `not measured${b.stillBuildingWithheld ? ` — ${b.stillBuildingWithheld}` : ''}`;
    default:
      return b.stillBuilding ? 'held' : 'not held or not measured (HEY did not say which)';
  }
}

function renderResearch(answer: ResearchAnswer, notes: string[]): HeyResult {
  const data = answer.data;
  const pageUrl =
    answer.links.page ?? data?.identity.url ?? answer.subject?.project?.url ?? undefined;
  const lines: string[] = [];
  if (!data) {
    lines.push(agentText(answer.answer));
    lines.push(`As of: ${isoTime(answer.asOf)}`);
    lines.push(sourceLine(pageUrl));
    return {
      ok: true,
      outcome: 'answer',
      text: lines.join('\n'),
      asOf: answer.asOf,
      citation: answer.citation,
      ...(pageUrl ? { projectUrl: pageUrl } : {}),
    };
  }
  const id = data.identity;
  const b = data.builderState;
  const symbol = id.symbol ? ` (ticker ${agentText(id.symbol, 40)})` : '';
  lines.push(`HEY research: ${agentText(id.name, 120)}${symbol} on ${CHAIN_NAME}`);
  lines.push(`Project: ${id.url}`);
  for (const note of notes) lines.push(`Note: ${note}`);
  lines.push(`Answer: ${agentText(answer.answer, 600)} [${answer.answerStatus}]`);
  lines.push(
    `Research level: ${id.researchLevel}; narrative: ${id.narrative ? agentText(id.narrative.name, 60) : 'not assigned'}; first recorded by HEY ${isoTime(id.firstRecordedByHeyAt)}.`,
  );

  lines.push('Builder state (building, never price):');
  const measured =
    b.activityMeasured === true
      ? 'measured'
      : b.activityMeasured === false
        ? 'HEY could not measure building; the status is not a finding'
        : 'whether it was measured is unknown';
  lines.push(`- Activity status: ${b.activityStatus} (${measured})`);
  lines.push(
    `- Last meaningful ship: ${b.lastMeaningfulShipAt ? isoTime(b.lastMeaningfulShipAt) : 'unknown — HEY holds no dated meaningful ship (not "never")'}`,
  );
  lines.push(
    `- Meaningful events in 30 days: ${b.meaningfulEvents30d === null ? 'not measured' : b.meaningfulEvents30d}`,
  );
  lines.push(
    `- Build Momentum: ${b.buildMomentum === null ? `not measured${b.buildMomentumReason ? ` — ${b.buildMomentumReason}` : ''}` : b.buildMomentum}${b.scoringVersion ? ` (${b.scoringVersion})` : ''}`,
  );
  lines.push(`- Still Building: ${stillBuildingLine(b)}`);
  lines.push(`- Why: ${b.explainUrl}`);

  if (data.latestMeaningfulChange) {
    lines.push(`Latest meaningful change: ${changeLine(data.latestMeaningfulChange)}`);
  } else {
    const why = {
      not_in_recent_changes:
        'not among the newest changes listed (HEY holds meaningful building; this is not "none")',
      none_recorded: 'HEY has recorded none',
      changes_unavailable: 'unknown — the change ledger could not be read',
    }[data.latestMeaningfulChangeReason ?? 'changes_unavailable'];
    lines.push(`Latest meaningful change: ${why}`);
  }
  const recent = data.recentChanges;
  if (recent.available && recent.items.length > 0) {
    lines.push(`Recent changes (newest ${recent.items.length} listed; all: ${recent.url}):`);
    for (const change of recent.items.slice(0, 5)) lines.push(`- ${changeLine(change)}`);
  } else if (!recent.available) {
    lines.push(`Recent changes: unknown${recent.reason ? ` — ${recent.reason}` : ''}`);
  }

  const token = data.contractIdentity.token;
  lines.push(
    token
      ? `Token contract: ${token.address} (chain ${token.chainId}); verification ${token.verification ?? 'unknown'}${token.verificationReason ? ` (${token.verificationReason})` : ''}. A token is not the project.`
      : 'Token contract: none recorded by HEY for this project.',
  );
  lines.push(
    `Owner verified to HEY: ${data.contractIdentity.ownerVerified ? 'yes' : 'no (not proven to HEY; not a finding against the project)'}`,
  );

  const m = data.marketContext;
  if (!m) {
    lines.push('Market context: not read.');
  } else {
    const valuation = m.valuation
      ? `${usd(m.valuation.usd)} ${m.valuation.kind === 'fdv' ? 'FDV' : m.valuation.kind === 'marketCap' ? 'market cap' : 'valuation (kind unspecified)'} (${m.valuation.source}${m.valuation.observedAt ? `, observed ${isoTime(m.valuation.observedAt)}` : ', time not given'})`
      : m.valuationWithheld
        ? `withheld — ${m.valuationWithheld}`
        : 'not read';
    const liquidity =
      m.liquidityUsd === null
        ? 'not read'
        : `${usd(m.liquidityUsd)}${m.liquidityKind === 'launch_inventory' ? " (a launch pool's own supply, not market depth)" : ''}`;
    const volume = m.volume24hUsd === null ? 'not read' : usd(m.volume24hUsd);
    lines.push(
      `Market context (context only, never a builder signal): valuation ${valuation}; liquidity ${liquidity}; 24h volume ${volume}; market status ${m.tokenMarketStatus ?? 'unknown'}.`,
    );
  }

  if (answer.unknowns.length > 0) {
    lines.push(`What HEY does not know (${answer.unknowns.length}):`);
    for (const u of answer.unknowns.slice(0, 8)) {
      lines.push(
        `- ${u.category} ${u.dimension}: ${agentText(u.statement, 200)} ${agentText(u.doNotConclude, 200)}`,
      );
    }
  } else {
    lines.push('What HEY does not know: no gap listed in this answer.');
  }
  const evidence = answer.evidence.slice(0, 6).map((e) => e.id);
  if (evidence.length > 0) {
    lines.push(
      `Evidence ids: ${evidence.join(', ')} (each resolves at ${SITE_URL}/api/evidence/<id>)`,
    );
  }
  for (const d of answer.disclosures ?? []) lines.push(`Disclosure: ${agentText(d.statement)}`);
  lines.push(`HEY: ${agentText(answer.boundaries.disclaimer, 600)}`);
  lines.push(NOT_ADVICE);
  lines.push(`As of: ${isoTime(answer.asOf)}`);
  lines.push(sourceLine(id.url));
  return {
    ok: true,
    outcome: 'answer',
    text: lines.join('\n'),
    projectUrl: id.url,
    asOf: answer.asOf,
    citation: answer.citation,
  };
}

async function askResearch(ctx: ReadContext, slug: string): Promise<ResearchAnswer> {
  const first = await ctx.hey.agent.answer('research_project', { project: slug });
  if (first.status === 'moved' && first.error?.movedTo) {
    const moved = first.error.movedTo.split('/').filter(Boolean).pop() ?? '';
    if (SLUG_RE.test(moved) && moved !== slug) {
      return ctx.hey.agent.answer('research_project', { project: moved });
    }
  }
  return first;
}

function fromAgentRefusal(answer: {
  status: string;
  error?: { code: string; message: { text: string } };
}) {
  const code = answer.error?.code ?? answer.status;
  const message = answer.error
    ? clean(answer.error.message.text, 300)
    : `HEY answered ${answer.status}.`;
  return {
    ok: false,
    outcome: 'error' as const,
    text: `HEY could not answer: ${code} — ${message}\n${sourceLine()}`,
    error: { code, message, retryable: answer.status === 'unavailable' },
  };
}

function suggestionLine(s: HeySearchSuggestion): string {
  const symbol = s.symbol ? ` (ticker ${clean(s.symbol, 40)})` : '';
  const name = clean(s.name, 120);
  if (s.type === 'project') {
    const slug = slugOf(s.target);
    const status =
      'status' in s && typeof (s as { status?: unknown }).status === 'string'
        ? ` · ${clean((s as { status: string }).status, 80)}`
        : '';
    const contract = s.contract ? ` · contract ${s.contract.toLowerCase()}` : '';
    return `- Project: ${name}${symbol}${contract}${status} · slug ${slug ?? 'unknown'} · ${SITE_URL}${s.target}`;
  }
  if (s.type === 'launch') {
    const notice = s.brandNotice ? ` · ${clean(s.brandNotice.title, 80)}` : '';
    return `- Launch record (not a published project; HEY has not researched it): ${name}${symbol} · contract ${s.contract.toLowerCase()} · launched via ${clean(s.launchedVia, 40)}${notice}`;
  }
  return `- ${clean(s.label, 120)}: ${name}${symbol} · contract ${s.contract.toLowerCase()} (never a project)`;
}

function renderSuggestions(result: HeySearchSuggestions, lead: string): string[] {
  const lines = [lead];
  if (result.suggestions.length === 0) {
    lines.push(`HEY's search index returned no match for "${clean(result.q, 64)}".`);
  } else {
    for (const s of result.suggestions) lines.push(suggestionLine(s));
    if (result.moreLaunchRecords) {
      lines.push(
        `HEY may hold more launch records: ${SITE_URL}/search?q=${encodeURIComponent(result.q)}`,
      );
    }
  }
  return lines;
}

async function researchBySearch(
  ctx: ReadContext,
  term: string,
  notes: string[],
): Promise<HeyResult> {
  if (term.length < 2 || term.length > 64) {
    return invalid('invalid_argument', 'A name or ticker must be 2 to 64 characters.');
  }
  const found = await ctx.hey.search.suggest(term);
  const lc = term.toLowerCase();
  const projects = found.suggestions.filter(
    (s): s is Extract<HeySearchSuggestion, { type: 'project' }> => s.type === 'project',
  );
  const exact = projects.filter(
    (p) => p.name.toLowerCase() === lc || p.symbol?.toLowerCase() === lc || slugOf(p.target) === lc,
  );
  const pick = exact.length === 1 ? exact[0] : undefined;
  const pickedSlug = pick ? slugOf(pick.target) : undefined;
  if (pick && pickedSlug) {
    const sameTicker = found.suggestions.filter(
      (s) => s !== pick && s.symbol && s.symbol.toLowerCase() === lc,
    ).length;
    const resolved = [
      ...notes,
      `"${clean(term, 64)}" resolved through HEY's search to the published project ${pickedSlug}${pick.contract ? ` (contract ${pick.contract.toLowerCase()})` : ''}.`,
    ];
    if (sameTicker > 0) {
      resolved.push(
        `${plural(sameTicker, 'other record')} in HEY's index share this ticker on other contracts; a ticker is not identity, so check the contract.`,
      );
    }
    const answer = await askResearch(ctx, pickedSlug);
    if (answer.status === 'ok') return renderResearch(answer, resolved);
    if (answer.status !== 'not_found') return fromAgentRefusal(answer);
  }
  const outcome = projects.length > 0 || found.suggestions.length > 0 ? 'ambiguous' : 'not_found';
  const lead =
    outcome === 'ambiguous'
      ? `HEY holds no single published project that "${clean(term, 64)}" names exactly. Candidates from HEY's search (research one by its slug or contract):`
      : `HEY holds no published project matching "${clean(term, 64)}" on ${CHAIN_NAME}.`;
  return {
    ok: true,
    outcome,
    text: [
      ...notes.map((n) => `Note: ${n}`),
      ...renderSuggestions(found, lead),
      "A reading of HEY's index, not a finding about any project.",
      sourceLine(`${SITE_URL}/search?q=${encodeURIComponent(term)}`),
    ].join('\n'),
  };
}

/**
 * Research one project by HEY slug, `$TICKER`, name or 0x contract address on Robinhood Chain.
 * A contract resolves through `token.lookup`; a slug goes straight to the agent contract's
 * `research_project`; a ticker or name goes through HEY's search and is researched only when one
 * published project matches it exactly.
 */
export function researchProject(
  ctx: ReadContext,
  rawQuery: string | undefined,
): Promise<HeyResult> {
  return guarded(async () => {
    const query = clean(rawQuery ?? '', 200);
    if (!query) {
      return invalid(
        'invalid_argument',
        'query is required: a HEY project slug, $TICKER, name or 0x contract address on Robinhood Chain.',
      );
    }
    if (/^0x/i.test(query)) {
      const candidate = `0x${query.slice(2)}`;
      if (!isAddress(candidate)) {
        return invalid(
          'invalid_address',
          `"${query.slice(0, 80)}" is not a 0x address of 40 hex characters.`,
        );
      }
      const address = normalizeAddress(candidate);
      const lookup = await ctx.hey.token.lookup(CHAIN_ID, address);
      if (lookup.status === 'published' && lookup.project) {
        const notes = [`Contract ${address} is the token HEY records for ${lookup.project.slug}.`];
        if (!lookup.project.activityAppliesToToken) {
          notes.push(
            "The project's own site names a different contract (MISMATCH): read the activity as the project's, never as this token's.",
          );
        }
        const answer = await askResearch(ctx, lookup.project.slug);
        if (answer.status === 'ok') return renderResearch(answer, notes);
        return fromAgentRefusal(answer);
      }
      const lines = [`HEY has no published project for contract ${address} on ${CHAIN_NAME}.`];
      if (lookup.issuer) lines.push(clean(lookup.issuer.sentence, 300));
      lines.push(`HEY Scan can read the address itself: ${lookup.scanUrl}`);
      lines.push("A reading of HEY's index, not a finding about the contract.");
      lines.push(sourceLine(lookup.scanUrl));
      return { ok: true, outcome: 'not_found', text: lines.join('\n') };
    }
    const ticker = query.startsWith('$');
    const term = ticker ? query.slice(1).trim() : query;
    if (!ticker && SLUG_RE.test(term)) {
      const answer = await askResearch(ctx, term);
      if (answer.status === 'ok') return renderResearch(answer, []);
      if (answer.status !== 'not_found') return fromAgentRefusal(answer);
      return researchBySearch(ctx, term, [agentText(answer.answer, 200)]);
    }
    return researchBySearch(ctx, term, []);
  });
}

// ---------------------------------------------------------------------------
// 2. Find projects
// ---------------------------------------------------------------------------

/** Search HEY's index by name, ticker or contract: published projects, launch records and issuer tokens, each labelled. */
export function findProjects(ctx: ReadContext, rawQuery: string | undefined): Promise<HeyResult> {
  return guarded(async () => {
    const query = clean(rawQuery ?? '', 64)
      .replace(/^\$/, '')
      .trim();
    if (query.length < 2) {
      return invalid(
        'invalid_argument',
        'query must be 2 to 64 characters: a name, ticker or 0x contract.',
      );
    }
    const found = await ctx.hey.search.suggest(query);
    const lines = renderSuggestions(
      found,
      `HEY's search on ${CHAIN_NAME} for "${clean(found.q, 64)}" (${plural(found.suggestions.length, 'row')}, at most eight):`,
    );
    lines.push(
      'Research a project with its slug or contract. A ticker is not identity, and a launch record is not a project.',
    );
    lines.push(`Read at: ${isoTime((ctx.now?.() ?? new Date()).toISOString())}`);
    lines.push(sourceLine(`${SITE_URL}/search?q=${encodeURIComponent(query)}`));
    return {
      ok: true,
      outcome: found.suggestions.length > 0 ? 'answer' : 'not_found',
      text: lines.join('\n'),
    };
  });
}

// ---------------------------------------------------------------------------
// 3. What changed
// ---------------------------------------------------------------------------

export type ChangesArgs = {
  project?: string | undefined;
  days?: string | number | undefined;
  limit?: string | number | undefined;
  buildingOnly?: string | boolean | undefined;
};

function flag(value: string | boolean | undefined): boolean {
  if (typeof value === 'boolean') return value;
  return ['true', 'yes', '1', 'only'].includes(
    String(value ?? '')
      .trim()
      .toLowerCase(),
  );
}

/** The canonical change ledger through the agent contract's `what_changed`: the true total, by type, newest first. */
export function recentChanges(ctx: ReadContext, args: ChangesArgs): Promise<HeyResult> {
  return guarded(async () => {
    const project = args.project ? clean(args.project, 80).toLowerCase() : undefined;
    if (project !== undefined && !SLUG_RE.test(project)) {
      return invalid(
        'invalid_argument',
        'project must be a HEY project slug (find it with hey_find_projects).',
      );
    }
    const days = intArg('days', args.days, 1, 30, 7);
    if (typeof days !== 'number') return days;
    const limit = intArg('limit', args.limit, 1, 50, 10);
    if (typeof limit !== 'number') return limit;
    const answer = await ctx.hey.agent.answer('what_changed', {
      ...(project ? { project } : {}),
      days,
      limit,
      ...(flag(args.buildingOnly) ? { building: 'only' as const } : {}),
    });
    if (answer.status === 'not_found') {
      return {
        ok: true,
        outcome: 'not_found',
        text: `${agentText(answer.answer)}\n${sourceLine()}`,
      };
    }
    if (answer.status !== 'ok' || !answer.data) return fromAgentRefusal(answer);
    const d = answer.data;
    const scope = project ? `${project}` : `${CHAIN_NAME} projects`;
    const link = project ? `${SITE_URL}/project/${project}` : d.more;
    const lines = [
      `What changed for ${scope}: last ${plural(d.window.days, 'day')} (${isoTime(d.window.from)} to ${isoTime(d.window.to)}, by when it happened, else when HEY detected it).`,
      `Answer: ${agentText(answer.answer, 600)}`,
      `Total in the window: ${d.total}${d.countsAsBuilding !== undefined ? `; ${d.countsAsBuilding} count as building` : ''}; showing ${d.shown}.`,
    ];
    if (d.byType.length > 0) {
      lines.push(
        `By type: ${d.byType
          .slice(0, 8)
          .map((t) => `${t.type} ${t.count}`)
          .join(', ')}${d.byType.length > 8 ? ', …' : ''}`,
      );
    }
    for (const item of d.items) lines.push(`- ${item.project.slug}: ${changeLine(item)}`);
    if (d.ledger.transitionsFrom) {
      lines.push(
        `HEY's ledger records status moves only since ${isoTime(d.ledger.transitionsFrom)}; earlier ones are absent, not zero.`,
      );
    }
    lines.push(`More: ${d.more}`);
    lines.push('A record of what happened, never a cause and never a price signal.');
    lines.push(`As of: ${isoTime(answer.asOf)}`);
    lines.push(sourceLine(link));
    return {
      ok: true,
      outcome: 'answer',
      text: lines.join('\n'),
      asOf: answer.asOf,
      citation: answer.citation,
      ...(project ? { projectUrl: link } : {}),
    };
  });
}

// ---------------------------------------------------------------------------
// 4. A project's ships and timeline
// ---------------------------------------------------------------------------

/** One project's timeline, newest first: ships with their verification and whether they count as building. */
export function projectTimeline(
  ctx: ReadContext,
  rawProject: string | undefined,
  rawLimit?: string | number,
): Promise<HeyResult> {
  return guarded(async () => {
    const slug = clean(rawProject ?? '', 80).toLowerCase();
    if (!SLUG_RE.test(slug)) {
      return invalid(
        'invalid_argument',
        'project must be a HEY project slug (find it with hey_find_projects).',
      );
    }
    const limit = intArg('limit', rawLimit, 1, 50, 10);
    if (typeof limit !== 'number') return limit;
    let timeline;
    try {
      timeline = await ctx.hey.projects.timeline(slug, { limit });
    } catch (error) {
      const result = fromError(error);
      if (result.error?.code !== 'not_found') return result;
      return {
        ok: true,
        outcome: 'not_found',
        text: `HEY holds no published project with the slug "${slug}". Find the slug with hey_find_projects.\n${sourceLine()}`,
      };
    }
    const t = timeline.totals;
    const lines = [
      `Timeline of ${clean(timeline.project.name, 120)} on ${CHAIN_NAME} (${timeline.lens}), newest first.`,
      `Project: ${timeline.project.url}`,
      `Totals: ${t.ships} ships, ${t.contractSource} contract-source records, ${t.locks} locks, ${t.resumed} resumed, ${t.verification} verification records (${timeline.total} entries).`,
    ];
    if (timeline.items.length === 0) lines.push("No entry on this page of HEY's timeline.");
    for (const e of timeline.items) {
      const parts = [
        `${isoTime(e.at)} (${e.precision})`,
        `${e.kind}: ${clean(e.title, 160)}`,
        e.verification ? `verification ${e.verification}` : 'verification not stated',
        e.countsAsBuilding ? 'counts as building' : 'context, not building',
      ];
      if (e.codeSubstance) parts.push(`code read: ${e.codeSubstance.verdict}`);
      if (e.source) parts.push(`source ${clean(e.source, 160)}`);
      lines.push(`- ${parts.join(' · ')} · evidence ${e.id}`);
    }
    if (timeline.truncated) lines.push(`Older entries exist: ${timeline.project.url}`);
    lines.push('A self-reported entry stays distinct from a verified one.');
    lines.push(`HEY: ${clean(timeline.disclaimer, 600)}`);
    lines.push(`Read at: ${isoTime((ctx.now?.() ?? new Date()).toISOString())}`);
    lines.push(sourceLine(timeline.project.url));
    return {
      ok: true,
      outcome: 'answer',
      text: lines.join('\n'),
      projectUrl: timeline.project.url,
    };
  });
}

// ---------------------------------------------------------------------------
// 5. Chain overview
// ---------------------------------------------------------------------------

/** Robinhood Chain day by day: HEY's building counts first, the chain's activity next, DEX figures as market context. */
export function chainOverview(ctx: ReadContext, rawDays?: string | number): Promise<HeyResult> {
  return guarded(async () => {
    const days = intArg('days', rawDays, 1, 30, 7);
    if (typeof days !== 'number') return days;
    const chain = await ctx.hey.chain({ days });
    const n = (v: number | undefined) =>
      v === undefined ? 'not measured' : v.toLocaleString('en-US');
    const lines = [
      `${CHAIN_NAME} (${chain.chainId}) day by day from HEY, ${plural(chain.days.length, 'day')}${chain.lastFullDay ? `; last full day ${chain.lastFullDay}` : ''}${chain.today ? `; ${chain.today} is in progress` : ''}.`,
    ];
    for (const d of chain.days) {
      const volume =
        d.dexVolumeUsd !== undefined
          ? usd(Math.round(d.dexVolumeUsd))
          : d.dexVolumeWithheld
            ? `withheld — ${d.dexVolumeWithheld}`
            : 'not measured';
      const launches =
        d.launches === undefined
          ? 'not measured'
          : `${n(d.launches)}${d.launchesBackfill ? " (a backfill day, not that day's launches)" : ''}`;
      lines.push(
        `- ${d.day}: building — ships ${n(d.ships)}, builders shipping ${n(d.buildersShipping)}, projects published ${n(d.projectsPublished)}, Verified Builders recorded ${n(d.buildersVerified)}; chain — transactions ${n(d.transactions)}, launches ${launches}; DEX (market context) — trades ${n(d.dexTrades)}, volume ${volume}.`,
      );
    }
    lines.push(`Volume: ${clean(chain.volumeNote, 400)}`);
    lines.push(`Launches: ${clean(chain.launchesNote, 500)}`);
    lines.push(`HEY: ${clean(chain.disclaimer, 600)}`);
    lines.push(`Read at: ${isoTime((ctx.now?.() ?? new Date()).toISOString())}`);
    lines.push(sourceLine(`${SITE_URL}/api/chain?days=${days}`));
    return { ok: true, outcome: 'answer', text: lines.join('\n') };
  });
}
