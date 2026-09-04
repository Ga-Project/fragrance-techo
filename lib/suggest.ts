// フレグランス手帖 — 提案・予測・重複ガードの純粋ロジック(DOM 非依存・テスト可能)。

import type { DuplicateWarning, Fragrance, Season } from "./types";
import { familyOf } from "./families.ts";
import { addDays, clampPct, daysBetween } from "./format.ts";

/** 1プッシュあたりの噴霧量(ml)。使い切り予測の基準値。 */
export const ML_PER_SPRAY = 0.1;

/** ISO 日付から季節を判定(北半球・日本の体感)。 */
export function seasonOf(todayISO: string): Season {
  const m = Number(todayISO.slice(5, 7));
  if (m >= 3 && m <= 5) return "spring";
  if (m >= 6 && m <= 8) return "summer";
  if (m >= 9 && m <= 11) return "autumn";
  return "winter";
}

/** 最後に使った日(wearLog の最大)。無ければ null。 */
export function lastWorn(f: Fragrance): string | null {
  if (f.wearLog.length === 0) return null;
  return f.wearLog.reduce((a, b) => (a > b ? a : b));
}

/** 1日あたりの消費量(ml)。実績(wearLog)があれば実測、無ければ目安から。 */
export function consumptionMlPerDay(f: Fragrance, todayISO: string): number {
  const perUseMl = Math.max(0, f.sprayPerUse) * ML_PER_SPRAY;
  if (f.wearLog.length >= 2) {
    const sorted = [...f.wearLog].sort();
    const first = sorted[0]!;
    const last = sorted[sorted.length - 1]!;
    // 観測期間は「最後に使った日」ではなく「今日」まで伸ばす。最後の使用で打ち切ると、
    // 使わなくなった期間が一切カウントされず、たとえば半年前に2日連続で使っただけの
    // ボトルが「1日2回ペース」のまま固定され、使い切り予測が極端に早い日付になる。
    const spanToLast = daysBetween(first, last) ?? 0;
    const spanToToday = daysBetween(first, todayISO) ?? 0;
    const span = Math.max(spanToLast, spanToToday);
    if (span >= 1) {
      return (f.wearLog.length * perUseMl) / span;
    }
  }
  if (f.wearLog.length === 1) {
    // 実績1回のみ: 使い始めからの経過で薄く推定(下振れ防止に最小7日)。
    const since = daysBetween(f.wearLog[0]!, todayISO);
    const span = Math.max(7, since ?? 7);
    return perUseMl / span;
  }
  const perWeek = Math.max(0, f.usesPerWeek);
  return (perWeek * perUseMl) / 7;
}

/** 残量(ml)。 */
export function remainingMl(f: Fragrance): number {
  return (Math.max(0, f.volumeMl) * clampPct(f.remainingPct)) / 100;
}

/** 空になるまでの日数。予測不能(消費ゼロ)や既に空は null。 */
export function daysUntilEmpty(f: Fragrance, todayISO: string): number | null {
  const ml = remainingMl(f);
  if (ml <= 0) return null;
  const rate = consumptionMlPerDay(f, todayISO);
  if (rate <= 0) return null;
  return Math.round(ml / rate);
}

/** 使い切り予測日(ISO)。予測不能は null。 */
export function predictEmptyDate(
  f: Fragrance,
  todayISO: string,
): string | null {
  const days = daysUntilEmpty(f, todayISO);
  if (days === null) return null;
  return addDays(todayISO, days);
}

/** 文字列を安定ハッシュ(日替わりタイブレーク用・決定論的)。 */
export function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export type PickContext = { todayISO: string; season: Season };

/** 「今日の1本」スコア。空は選ばない。高いほど推し。 */
export function scoreForToday(f: Fragrance, ctx: PickContext): number {
  if (clampPct(f.remainingPct) <= 0) return Number.NEGATIVE_INFINITY;
  let score = 0;
  // 季節適合。季節指定なし = オールシーズンとして薄く加点。
  if (f.seasons.length === 0) score += 1;
  else if (f.seasons.includes(ctx.season)) score += 3;
  else score -= 1;
  // ローテーション: 使っていないほど推す。
  const worn = lastWorn(f);
  if (worn === null) {
    score += 2.5;
  } else {
    const since = daysBetween(worn, ctx.todayISO) ?? 0;
    score += Math.min(Math.max(since, 0), 40) / 10;
  }
  return score;
}

/** 今日の1本(決定論的・同日同コレクションなら不変)。該当なしは null。 */
export function todaysPick(
  list: Fragrance[],
  todayISO: string,
): Fragrance | null {
  const season = seasonOf(todayISO);
  const ctx: PickContext = { todayISO, season };
  let best: Fragrance | null = null;
  let bestScore = Number.NEGATIVE_INFINITY;
  let bestTie = -1;
  for (const f of list) {
    const s = scoreForToday(f, ctx);
    if (s === Number.NEGATIVE_INFINITY) continue;
    const tie = hashString(`${todayISO}:${f.id}`);
    if (s > bestScore || (s === bestScore && tie > bestTie)) {
      best = f;
      bestScore = s;
      bestTie = tie;
    }
  }
  return best;
}

function normalizeName(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKC")
    .replace(/[\s・,.'"“”‘’\-–—_/|()]+/g, " ")
    .trim();
}

function tokenSet(s: string): Set<string> {
  return new Set(normalizeName(s).split(" ").filter(Boolean));
}

/** 2つの名前のトークン Jaccard 類似度(0–1)。 */
export function nameSimilarity(a: string, b: string): number {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (na.length === 0 || nb.length === 0) return 0;
  if (na === nb) return 1;
  const sa = tokenSet(a);
  const sb = tokenSet(b);
  if (sa.size === 0 || sb.size === 0) return 0;
  let inter = 0;
  for (const t of sa) if (sb.has(t)) inter++;
  const union = sa.size + sb.size - inter;
  return union === 0 ? 0 : inter / union;
}

function sameBrand(a: string, b: string): boolean {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  return na.length > 0 && na === nb;
}

export type DuplicateCandidate = {
  name: string;
  brand: string;
  family: Fragrance["family"];
  /** 編集中に自分自身を除外するための id。 */
  excludeId?: string;
};

/**
 * 重複購入ガード。所持品の中から、登録/検討中の香りと近いものを警告する。
 * score>=0.5 のみ返し、降順で並べる。
 */
export function duplicateWarnings(
  candidate: DuplicateCandidate,
  list: Fragrance[],
): DuplicateWarning[] {
  const out: DuplicateWarning[] = [];
  for (const f of list) {
    if (candidate.excludeId && f.id === candidate.excludeId) continue;
    const nameSim = nameSimilarity(candidate.name, f.name);
    const brandSame = sameBrand(candidate.brand, f.brand);
    const familySame = candidate.family === f.family;

    let score = 0;
    let reason = "";
    if (nameSim >= 0.6) {
      score = 0.85 + 0.15 * nameSim;
      reason = "名前がとても似ています";
    } else if (familySame && brandSame) {
      score = 0.9;
      reason = `同じブランド・同じ香調(${familyOf(f.family).label})`;
    } else if (brandSame && nameSim >= 0.3) {
      score = 0.8;
      reason = "同じブランドで名前も近い";
    } else if (familySame && nameSim >= 0.3) {
      score = 0.7;
      reason = `香調(${familyOf(f.family).label})と名前が近い`;
    } else if (familySame) {
      score = 0.5;
      reason = `同じ香調(${familyOf(f.family).label})を既に所持`;
    }

    if (score >= 0.5) {
      out.push({ id: f.id, name: f.name, brand: f.brand, reason, score });
    }
  }
  return out.sort((a, b) => b.score - a.score);
}
