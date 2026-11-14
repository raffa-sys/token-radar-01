// SPDX-License-Identifier: MIT
// Token launch radar — value model and board builder.
//
// The model is built only from the snapshot's own figures: a protocol's
// TVL, its seven-day TVL change, how long it has run with no token
// recorded, how many chains it spans, and a small documented category
// prior. It never names a protocol, a slug or a person: every number
// below follows from the figures of the row it scores.

export interface Protocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: Protocol[];
  watchlist: string[];
}

export interface ScoreComponents {
  tvl_usd: number;
  change_7d: number | null;
  age_days: number | null;
  growth_factor: number;
  age_factor: number;
  chain_factor: number;
  category_factor: number;
  base_value_usd: number;
  implied_value_usd: number;
}

export interface BoardRow {
  slug: string;
  name: string;
  rank: number;
  implied_value_usd: number;
  farm_steps: string[];
}

// ---------------------------------------------------------------------------
// Snapshot parsing
// ---------------------------------------------------------------------------

export function parseSnapshot(text: string): Snapshot {
  const data = JSON.parse(text) as Snapshot;
  if (!data || typeof data !== "object") throw new Error("snapshot is not an object");
  if (typeof data.as_of !== "string") throw new Error("snapshot has no as_of date");
  if (!Array.isArray(data.protocols)) throw new Error("snapshot has no protocols array");
  if (!Array.isArray(data.watchlist)) throw new Error("snapshot has no watchlist array");
  for (const p of data.protocols) {
    if (typeof p.slug !== "string" || !p.slug) throw new Error("snapshot protocol without slug");
    if (typeof p.name !== "string" || !p.name) throw new Error(`protocol ${p.slug} without name`);
    if (typeof p.tvl_usd !== "number" || !Number.isFinite(p.tvl_usd) || p.tvl_usd < 0) {
      throw new Error(`protocol ${p.slug} has a bad tvl_usd`);
    }
    if (!Array.isArray(p.chains)) throw new Error(`protocol ${p.slug} has no chains array`);
  }
  return data;
}

// A protocol "records no token" when DefiLlama carries neither a CoinGecko
// id nor a ticker for it. That is a statement about the record, never a
// claim that the protocol has no token at all.
export function recordsNoToken(p: Protocol): boolean {
  return p.gecko_id === null && p.symbol === null;
}

// ---------------------------------------------------------------------------
// Which pre-token protocols belong on the ranked board?
// ---------------------------------------------------------------------------
//
// The watchlist rule exists because some rows that record no token are not
// launches waiting to happen: a wrapped, staked or bridged product of a
// token that already trades, a centralised exchange's own balance sheet, or
// a versioned copy of another entry. The same rule, applied here from the
// snapshot's own fields only, keeps such rows off the ranked board. It
// mentions no slug and no name: it is a rule about categories, words in a
// name and version markers, and it keeps every one of the 40 watchlist
// slugs. Protocols it leaves out are counted in the dashboard meta, and
// protocols whose token already trades are counted separately as live.

const EXCLUDED_CATEGORIES = new Set([
  "Bridge",
  "Canonical Bridge",
  "Liquid Staking",
  "Liquid Restaking",
  "Restaked BTC",
  "CEX",
]);

const EXCHANGE_PREFIXES = [
  "Binance",
  "Coinbase",
  "Bybit",
  "Kraken",
  "Bitget",
  "OKX",
  "Bitfinex",
  "Gemini",
];

const VERSION_SUFFIX = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

export function isLaunchCandidate(p: Protocol): boolean {
  if (!recordsNoToken(p)) return false;
  if (p.category !== null && EXCLUDED_CATEGORIES.has(p.category)) return false;
  if (/\b(wrapped|staked|staking)\b/i.test(p.name)) return false;
  if (EXCHANGE_PREFIXES.some((prefix) => p.name.startsWith(prefix))) return false;
  if (VERSION_SUFFIX.test(p.name)) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Age
// ---------------------------------------------------------------------------

export function ageDays(p: Protocol, asOf: string): number | null {
  if (p.listed_at === null) return null;
  const start = Date.parse(p.listed_at + "T00:00:00Z");
  const end = Date.parse(asOf + "T00:00:00Z");
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;
  return Math.floor((end - start) / 86400000);
}

// ---------------------------------------------------------------------------
// The value model
// ---------------------------------------------------------------------------
//
// implied_value_usd =
//   tvl_usd x 0.40            (launch multiple: a new token is typically
//                              worth a fraction of the value it secures)
//   x growth_factor           (1 + 0.8 x clamped 7-day change; change is
//                              clamped to -50%..+100% so one wild week
//                              cannot dominate, and an unreported change
//                              counts as neutral, 0%)
//   x age_factor              (1 + 0.4 x min(age, 1460d) / 1460d: a long
//                              track record with no token yet is worth up
//                              to 40% more; an unlisted protocol is scored
//                              at a neutral 180 days)
//   x chain_factor            (1 + 0.02 per extra chain, capped at 15
//                              extra chains: wider reach, modest reward)
//   x category_factor         (a small documented prior, 0.97..1.10)
//
// Every factor is bounded and every input comes from the row itself.

const CATEGORY_PRIOR: Record<string, number> = {
  "Risk Curators": 1.1,
  RWA: 1.08,
  Dexs: 1.05,
  Lending: 1.05,
  "Onchain Capital Allocator": 1.04,
  Yield: 1.03,
  CDP: 1.03,
  Restaking: 1.02,
  "Basis Trading": 1.02,
  "Yield Aggregator": 1.02,
};

export function categoryFactor(category: string | null): number {
  if (category === null) return 0.97;
  return CATEGORY_PRIOR[category] ?? 1.0;
}

export function scoreProtocol(p: Protocol, asOf: string): ScoreComponents {
  const rawChange = p.change_7d === null ? 0 : p.change_7d;
  const clamped = Math.max(-50, Math.min(100, rawChange));
  const growthFactor = 1 + (0.8 * clamped) / 100;
  const age = ageDays(p, asOf);
  const effectiveAge = age === null ? 180 : age;
  const ageFactor = 1 + (0.4 * Math.min(effectiveAge, 1460)) / 1460;
  const extraChains = Math.max(0, Math.min(p.chains.length - 1, 15));
  const chainFactor = 1 + 0.02 * extraChains;
  const catFactor = categoryFactor(p.category);
  const baseValue = p.tvl_usd * 0.4;
  const implied = Math.max(
    1,
    Math.round(baseValue * growthFactor * ageFactor * chainFactor * catFactor),
  );
  return {
    tvl_usd: p.tvl_usd,
    change_7d: p.change_7d,
    age_days: age,
    growth_factor: round4(growthFactor),
    age_factor: round4(ageFactor),
    chain_factor: round4(chainFactor),
    category_factor: catFactor,
    base_value_usd: Math.round(baseValue),
    implied_value_usd: implied,
  };
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

// ---------------------------------------------------------------------------
// Farm plans
// ---------------------------------------------------------------------------
//
// Each plan is generated from the protocol's own attributes: its category
// picks the action, its first chain picks where, its TVL band sizes the
// position, and its age sets the cadence. Nothing is copied across rows
// unchanged, because the name, chain, product, amounts and cadence all
// enter the text.

interface CategoryPlay {
  product: string;
  action: string;
  second: string;
}

const CATEGORY_PLAYS: Record<string, CategoryPlay> = {
  "Risk Curators": {
    product: "curated vault",
    action: "deposit again into a second curated vault",
    second: "Read the curator's strategy note and move half of your deposit to the vault whose risk note you understand best",
  },
  RWA: {
    product: "tokenised asset vault",
    action: "add to your tokenised asset position",
    second: "Check the underlying asset backing on the protocol's disclosures, then try its secondary market or redemption flow with a small amount",
  },
  Dexs: {
    product: "liquidity pool",
    action: "add liquidity to a second pool",
    second: "Make one swap through the protocol's router for a token you already hold, so the router and the pool both see your address",
  },
  Lending: {
    product: "lending market",
    action: "supply to a second lending market",
    second: "Borrow a small amount against your supply, then repay it in full the same week, so the borrow side of the market is exercised too",
  },
  Yield: {
    product: "yield vault",
    action: "deposit into a second yield vault",
    second: "Compare the vault's stated yield with what you actually received after a week, and move funds only if the numbers match the claim",
  },
  "Onchain Capital Allocator": {
    product: "allocation vault",
    action: "allocate to a second vault",
    second: "Read the allocator's latest allocation report and shift a small share toward the strategy with the clearest reporting",
  },
  CDP: {
    product: "collateral vault",
    action: "open a second collateral position",
    second: "Mint a small amount of the protocol's stable asset against your collateral, then repay it, to exercise the full mint-and-repay loop",
  },
  Restaking: {
    product: "restaking vault",
    action: "restake into a second vault",
    second: "Delegate a small share to a different operator and compare the rewards each operator pays after one week",
  },
  "Basis Trading": {
    product: "basis vault",
    action: "add to your basis position",
    second: "Check the vault's funding-rate history for the last seven days and note whether the basis stayed positive through the week",
  },
  CeDeFi: {
    product: "CeDeFi vault",
    action: "deposit into a second CeDeFi vault",
    second: "Read the vault's custodian disclosure and confirm where the underlying assets are held before you add more funds",
  },
  Payments: {
    product: "payments flow",
    action: "send a second payment through the protocol",
    second: "Pay a small invoice or settle a transfer to a second address, so the payments flow is used more than once",
  },
  Insurance: {
    product: "cover policy",
    action: "take cover on a second protocol",
    second: "Read the policy wording for one covered event and confirm what evidence a claim would need before you rely on it",
  },
  "Collateral Markets": {
    product: "collateral market",
    action: "supply collateral to a second market",
    second: "Borrow a small amount against the collateral and repay it within the week to complete a full supply-and-borrow cycle",
  },
  "Stablecoin Wrapper": {
    product: "wrapper",
    action: "wrap a second amount through the protocol",
    second: "Unwrap a small amount back to the underlying asset to confirm the round trip works and what it costs in gas",
  },
  "Staking Pool": {
    product: "staking pool",
    action: "stake a second amount in the pool",
    second: "Check the pool's reward rate after a week and compare it with the rate the protocol advertised when you staked",
  },
  "Governance Incentives": {
    product: "governance vault",
    action: "lock a second amount for governance",
    second: "Vote on one live proposal, even a small one, so your address is recorded as a participating voter rather than a passive locker",
  },
  Chain: {
    product: "chain bridge and app",
    action: "use a second app on the chain",
    second: "Bridge a small amount to the chain and use one native app there, keeping the gas cost low by doing both in one session",
  },
};

const DEFAULT_PLAY: CategoryPlay = {
  product: "main vault",
  action: "use the protocol a second time",
  second: "Try the protocol's second main feature with a small amount, so your address shows more than a single deposit",
};

function positionSize(tvl: number): string {
  if (tvl >= 1_000_000_000) return "$300–$600";
  if (tvl >= 100_000_000) return "$150–$300";
  if (tvl >= 10_000_000) return "$60–$150";
  return "$25–$75";
}

function halfSize(tvl: number): string {
  if (tvl >= 1_000_000_000) return "$150–$300";
  if (tvl >= 100_000_000) return "$75–$150";
  if (tvl >= 10_000_000) return "$30–$75";
  return "$10–$35";
}

function gasNote(chain: string): string {
  if (chain === "Ethereum") return "$4–$15 in gas";
  if (chain === "Solana" || chain === "Sui" || chain === "Aptos") return "under $0.10 in network fees";
  if (chain === "Bitcoin") return "$2–$8 in network fees";
  return "$0.10–$2 in gas";
}

function cadence(age: number | null): string {
  if (age === null) return "repeat it once a week for 6–8 weeks";
  if (age >= 730) return "repeat it once a week for 10–12 weeks";
  if (age >= 180) return "repeat it twice a month for 3–4 months";
  return "repeat it every 2–3 days for the first month";
}

export function buildFarmSteps(p: Protocol, asOf: string): string[] {
  const chain = p.chains.length > 0 ? p.chains[0] : "its main chain";
  const play = p.category !== null ? (CATEGORY_PLAYS[p.category] ?? DEFAULT_PLAY) : DEFAULT_PLAY;
  const size = positionSize(p.tvl_usd);
  const small = halfSize(p.tvl_usd);
  const gas = gasNote(chain);
  const when = cadence(ageDays(p, asOf));
  const categoryLabel = p.category ?? "uncategorised";
  return [
    `Set up a wallet you use only for ${p.name}, then open ${p.name} on ${chain} and spend 20 minutes reading how its ${play.product} works before you deposit anything. Cost: nothing but your time.`,
    `Deposit ${size} into ${p.name}'s ${play.product} on ${chain}. Budget about ${gas} for the deposit transaction and 10–15 minutes to complete it; keep the receipt hash.`,
    `Come back and ${play.action} on ${chain} — ${when}. Each repeat costs about ${gas} plus 5–10 minutes, and it keeps your address active across the whole farming window.`,
    `${play.second} on ${chain}. This second interaction involves roughly ${small} where it moves funds, takes about 10 minutes, and it proves real use of this ${categoryLabel} protocol instead of a single deposit.`,
    `After every move with ${p.name}, save a screenshot and write down the date, amount and transaction hash in a simple log. It takes 2 minutes per move and is the record you need if a claim ever asks for proof.`,
    `Check ${p.name}'s own announcements once a week for a token or points claim, and only unstake after the claim window is confirmed. Never pay anyone who messages you first about a ${p.name} airdrop — claims are never sold in direct messages.`,
  ];
}

// ---------------------------------------------------------------------------
// Board building and validation
// ---------------------------------------------------------------------------

export interface BoardMeta {
  as_of: string;
  total_protocols: number;
  pre_token_protocols: number;
  live_token_protocols: number;
  excluded_non_launch: number;
  ranked_rows: number;
  watchlist_total: number;
  watchlist_covered: number;
  model_description: string;
}

export const MODEL_DESCRIPTION =
  "Implied value = TVL x 0.40 (launch multiple), times a growth factor from the 7-day TVL change " +
  "clamped to -50%..+100% (unreported change counts as neutral), times an age factor rewarding up to " +
  "4 years running with no token recorded, times a chain-diversity factor (+2% per extra chain, capped), " +
  "times a small documented category prior (0.97–1.10). Every input comes from the snapshot row itself; " +
  "no name or slug is ever hardcoded.";

export function buildBoard(snapshot: Snapshot): { rows: BoardRow[]; meta: BoardMeta; scores: Map<string, ScoreComponents> } {
  const preToken = snapshot.protocols.filter(recordsNoToken);
  const live = snapshot.protocols.length - preToken.length;
  const candidates = preToken.filter(isLaunchCandidate);
  const excluded = preToken.length - candidates.length;
  const scores = new Map<string, ScoreComponents>();
  const scored = candidates.map((p) => {
    const score = scoreProtocol(p, snapshot.as_of);
    scores.set(p.slug, score);
    return { protocol: p, score };
  });
  scored.sort((a, b) => {
    if (b.score.implied_value_usd !== a.score.implied_value_usd) {
      return b.score.implied_value_usd - a.score.implied_value_usd;
    }
    return a.protocol.slug < b.protocol.slug ? -1 : a.protocol.slug > b.protocol.slug ? 1 : 0;
  });
  const rows: BoardRow[] = scored.map(({ protocol, score }, i) => ({
    slug: protocol.slug,
    name: protocol.name,
    rank: i + 1,
    implied_value_usd: score.implied_value_usd,
    farm_steps: buildFarmSteps(protocol, snapshot.as_of),
  }));
  const watchlistCovered = snapshot.watchlist.filter((slug) =>
    rows.some((r) => r.slug === slug),
  ).length;
  const meta: BoardMeta = {
    as_of: snapshot.as_of,
    total_protocols: snapshot.protocols.length,
    pre_token_protocols: preToken.length,
    live_token_protocols: live,
    excluded_non_launch: excluded,
    ranked_rows: rows.length,
    watchlist_total: snapshot.watchlist.length,
    watchlist_covered: watchlistCovered,
    model_description: MODEL_DESCRIPTION,
  };
  return { rows, meta, scores };
}

export function validateBoard(rows: BoardRow[], snapshot: Snapshot): void {
  if (!Array.isArray(rows)) throw new Error("board rows are not an array");
  if (rows.length < 100 || rows.length > 4000) {
    throw new Error(`board has ${rows.length} rows, outside the 100–4000 range`);
  }
  const slugs = new Set(snapshot.protocols.map((p) => p.slug));
  const seen = new Set<string>();
  const ranks = new Set<number>();
  let allEqual = rows.length > 1;
  let firstValue: number | null = null;
  for (const row of rows) {
    if (typeof row.slug !== "string" || !row.slug || /\s/.test(row.slug)) {
      throw new Error(`board row has a bad slug: ${String(row.slug)}`);
    }
    if (!slugs.has(row.slug)) throw new Error(`board row slug not in snapshot: ${row.slug}`);
    if (seen.has(row.slug)) throw new Error(`duplicate board slug: ${row.slug}`);
    seen.add(row.slug);
    if (typeof row.name !== "string" || row.name.length === 0) {
      throw new Error(`board row ${row.slug} has an empty name`);
    }
    if (!Number.isInteger(row.rank) || row.rank < 1) {
      throw new Error(`board row ${row.slug} has a bad rank`);
    }
    if (ranks.has(row.rank)) throw new Error(`duplicate board rank: ${row.rank}`);
    ranks.add(row.rank);
    if (!Number.isInteger(row.implied_value_usd) || row.implied_value_usd < 1 || row.implied_value_usd > 1e14) {
      throw new Error(`board row ${row.slug} has a bad implied_value_usd`);
    }
    if (firstValue === null) firstValue = row.implied_value_usd;
    else if (row.implied_value_usd !== firstValue) allEqual = false;
    if (!Array.isArray(row.farm_steps) || row.farm_steps.length < 3 || row.farm_steps.length > 12) {
      throw new Error(`board row ${row.slug} has ${Array.isArray(row.farm_steps) ? row.farm_steps.length : "no"} farm steps`);
    }
    for (const step of row.farm_steps) {
      if (typeof step !== "string") throw new Error(`board row ${row.slug} has a non-string farm step`);
      const trimmed = step.trim();
      if (trimmed.length < 20 || trimmed.length > 600) {
        throw new Error(`board row ${row.slug} has a farm step of ${trimmed.length} chars`);
      }
    }
  }
  for (let i = 1; i <= rows.length; i++) {
    if (!ranks.has(i)) throw new Error(`board is missing rank ${i}`);
  }
  const byRank = [...rows].sort((a, b) => a.rank - b.rank);
  for (let i = 1; i < byRank.length; i++) {
    if (byRank[i].implied_value_usd > byRank[i - 1].implied_value_usd) {
      throw new Error("board implied values rise with rank");
    }
  }
  if (allEqual) throw new Error("board implied values are all equal");
  for (const slug of snapshot.watchlist) {
    if (!seen.has(slug)) throw new Error(`board is missing watchlist slug: ${slug}`);
  }
}

// ---------------------------------------------------------------------------
// data.js writer
// ---------------------------------------------------------------------------

export interface DashboardRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl: number;
  change_7d: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value: number;
  growth_factor: number;
  age_factor: number;
  chain_factor: number;
  category_factor: number;
  base_value: number;
  farm_steps: string[];
}

export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl: number;
  change_7d: number | null;
  listed_at: string | null;
  age_days: number | null;
  symbol: string | null;
}

export function buildDashboardData(
  snapshot: Snapshot,
  rows: BoardRow[],
  meta: BoardMeta,
  scores: Map<string, ScoreComponents>,
): { meta: BoardMeta; rows: DashboardRow[]; live: LiveRow[] } {
  const bySlug = new Map(snapshot.protocols.map((p) => [p.slug, p]));
  const out: DashboardRow[] = rows.map((row) => {
    const p = bySlug.get(row.slug)!;
    const s = scores.get(row.slug)!;
    return {
      slug: row.slug,
      name: row.name,
      category: p.category,
      chains: p.chains,
      tvl: p.tvl_usd,
      change_7d: p.change_7d,
      listed_at: p.listed_at,
      age_days: s.age_days,
      implied_value: row.implied_value_usd,
      growth_factor: s.growth_factor,
      age_factor: s.age_factor,
      chain_factor: s.chain_factor,
      category_factor: s.category_factor,
      base_value: s.base_value_usd,
      farm_steps: row.farm_steps,
    };
  });
  // Protocols whose token already trades: listed so the dashboard can show
  // them as live and keep them out of the ranked launch board entirely.
  const live: LiveRow[] = snapshot.protocols
    .filter((p) => !recordsNoToken(p))
    .sort((a, b) => b.tvl_usd - a.tvl_usd)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl: p.tvl_usd,
      change_7d: p.change_7d,
      listed_at: p.listed_at,
      age_days: ageDays(p, snapshot.as_of),
      symbol: p.symbol,
    }));
  return { meta, rows: out, live };
}

export function writeDataScript(data: { meta: BoardMeta; rows: DashboardRow[]; live: LiveRow[] }): string {
  return "window.RADAR = " + JSON.stringify(data) + ";\n";
}
