// フレグランス手帖 — 日付・数値の純粋ヘルパー(DOM 非依存・テスト可能)。

/** ISO(yyyy-mm-dd)へ整形。 */
export function toISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * ISO 文字列から Date(ローカル正午基準・タイムゾーン境界のズレを避ける)。
 *
 * 桁が揃っているだけでは日付として扱わない。Date は 2026-02-30 や 2026-13-01 を
 * 黙って翌月・翌年へ繰り上げるため、書式だけを見て通すと「暦に無い日」が実在する
 * 別の日として計算に入り込む(使用日として 2026-02-30 が入ったボトルは、
 * 3月2日に使ったことになって使い切り予測もローテーションもずれる)。
 * 組み立てた Date が元の年月日に戻らなければ、その文字列は日付ではない。
 */
export function parseISODate(iso: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const date = new Date(y, mo - 1, d, 12, 0, 0, 0);
  if (
    date.getFullYear() !== y ||
    date.getMonth() !== mo - 1 ||
    date.getDate() !== d
  ) {
    return null;
  }
  return date;
}

/**
 * 「yyyy-mm-dd ちょうどで、暦に実在する日」か。
 *
 * 使用日(wearLog)や購入日はこの形だけを想定して読み書きされる。前後に余計な文字が
 * 付いた値は日付としては解釈できても文字列としての比較(最後に使った日 = wearLog の
 * 最大値)が狂うため、前方一致では通さない。
 */
export function isISODate(v: unknown): v is string {
  return (
    typeof v === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(v) &&
    parseISODate(v) !== null
  );
}

/**
 * 「日付から始まる時刻印」か(yyyy-mm-dd でも yyyy-mm-ddThh:mm:ss.sssZ でもよい)。
 *
 * createdAt / updatedAt はこのアプリ自身が両方の形で書いている(画面からの保存は
 * ローカル日付、取り込み経路の既定値は toISOString)。日付部分が実在することだけを
 * 確かめ、時刻の有無は問わない。
 */
export function isISOTimestamp(v: unknown): v is string {
  return typeof v === "string" && parseISODate(v) !== null;
}

/** a から b までの日数(切り捨て・負もあり得る)。 */
export function daysBetween(aISO: string, bISO: string): number | null {
  const a = parseISODate(aISO);
  const b = parseISODate(bISO);
  if (!a || !b) return null;
  return Math.round((b.getTime() - a.getTime()) / 86_400_000);
}

/** today に days を足した ISO 日付。 */
export function addDays(todayISO: string, days: number): string | null {
  const t = parseISODate(todayISO);
  if (!t) return null;
  t.setDate(t.getDate() + Math.round(days));
  return toISODate(t);
}

/** 残量%を人が読む相対表現に。 */
export function remainingLabel(pct: number): string {
  const p = clampPct(pct);
  if (p <= 0) return "空";
  if (p < 12) return "残りわずか";
  if (p > 92) return "満量に近い";
  return `${Math.round(p)}%`;
}

/** 0–100 に丸める。 */
export function clampPct(pct: number): number {
  if (!Number.isFinite(pct)) return 0;
  return Math.max(0, Math.min(100, pct));
}

/** 日数を「あとN日 / 約Nか月」の粗い表現に。 */
export function humanizeDays(days: number | null): string {
  if (days === null || !Number.isFinite(days)) return "—";
  if (days <= 0) return "まもなく";
  if (days < 45) return `あと約${days}日`;
  const months = Math.round(days / 30);
  if (months < 24) return `約${months}か月`;
  return `約${Math.round(months / 12)}年`;
}

/** 円表記。 */
export function yen(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "—";
  return `¥${Math.round(n).toLocaleString("ja-JP")}`;
}
