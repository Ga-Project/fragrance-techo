// フレグランス手帖 — バックアップ(JSON)の書き出し/取り込み。純粋・テスト可能。
// 写真(Blob)は JSON に含めない。ボトルのメタ情報のみを可搬にする。

import type { BackupPayload, Fragrance } from "./types";
import {
  FAMILY_IDS,
  SCENE_IDS,
  SEASON_IDS,
  normalizeFragrance,
} from "./model.ts";
import { isISODate, isISOTimestamp } from "./format.ts";

/**
 * このアプリが読み書きできるバックアップの版。
 * 取り込みは同じ端末の記録を「元に戻せない形で」置き換えるため、版が一致するものだけを
 * 受け付ける。将来版のファイルは項目が増減している可能性があり、正規化で既定値へ
 * 丸めたまま取り込むと、書き出した時点の記録より劣化した内容で上書きしてしまう。
 */
export const BACKUP_VERSION = 1;

/** コレクションを JSON 文字列へ。写真は除外(photoIds は空にする)。 */
export function serializeBackup(list: Fragrance[], now: string): string {
  const payload: BackupPayload = {
    app: "fragrance-techo",
    version: BACKUP_VERSION,
    exportedAt: now,
    fragrances: list.map((f) => ({ ...f, photoIds: [] })),
  };
  return JSON.stringify(payload, null, 2);
}

export type ParseResult =
  | { ok: true; fragrances: Fragrance[] }
  | { ok: false; error: string };

const isString = (v: unknown): v is string => typeof v === "string";
const isFilled = (v: unknown): boolean => isString(v) && v.length > 0;
const isNumber = (v: unknown): boolean =>
  typeof v === "number" && Number.isFinite(v);
/**
 * 日付の項目は「文字列であること」では足りない。
 *
 * wearLog は使用日(yyyy-mm-dd)の並びで、件数がそのまま使用回数、最大値が
 * 「最後に使った日」、最初と最後の間隔が消費速度になる。日付として読めない要素が
 * 混じると、その1件は回数には数えられるのに日付としては解釈できず、
 * 「最後に使った日」も使い切り予測もローテーション提案も狂う。取り込みは同じ id の
 * 記録を元に戻せない形で置き換えるため、置き換える前にここで止める。
 * 購入日は未入力(空文字)を許すが、入っているなら実在する日付でなければならない。
 * createdAt / updatedAt は日付だけの形と時刻付きの形の両方をこのアプリ自身が書く。
 */
const isISODateArray = (v: unknown): boolean =>
  Array.isArray(v) && v.every(isISODate);
const isOptionalISODate = (v: unknown): boolean =>
  isString(v) && (v.length === 0 || isISODate(v));
/**
 * 版1は「写真を含まないメタ情報だけ」の形式で、書き出しは photoIds を必ず空にする。
 *
 * 写真の実体(IndexedDB の Blob)はこのファイルに入らない。したがって空でない photoIds は
 * 「実体の無い参照」でしかなく、取り込みでそれを採ると、そのボトルの写真は画面から
 * 見えないまま(参照先が存在しない)になり、置き換わる前の参照が指していた実体は
 * 誰からも辿れない孤児になる。空だけを受け付け、写真は取り込みで一切動かさない。
 */
const isEmptyArray = (v: unknown): boolean =>
  Array.isArray(v) && v.length === 0;
const isEnumArray =
  (allowed: readonly string[]) =>
  (v: unknown): boolean =>
    Array.isArray(v) && v.every((x) => isString(x) && allowed.includes(x));
const isPyramid = (v: unknown): boolean => {
  if (!v || typeof v !== "object" || Array.isArray(v)) return false;
  const o = v as Record<string, unknown>;
  return isString(o.top) && isString(o.heart) && isString(o.base);
};

/**
 * 版1のボトル1件が満たすべき項目と型。
 *
 * 正規化(normalizeFragrance)は欠けた項目を既定値で埋める。壊れた保存データから
 * 画面を復帰させるにはそれが正しいが、取り込みに同じ寛容さを持ち込むと
 * `{"id":"既存のid"}` だけの記録でも「成功」として通り、同じ id の手元のボトルを
 * 名前も残量も使用履歴も空の既定値で置き換えてしまう(取り込みは元に戻せない)。
 * 版が一致していても、その版の形をしていない記録は受け付けない。
 * 見るのは項目の有無と型、そして「日付の項目が日付として読めるか」まで。
 * 丸めれば済む値の範囲(残量の 0–100 など)は正規化に任せる。日付だけは丸めようが
 * なく、読めないまま取り込むと計算の前提が崩れるため、ここで止める。
 */
const REQUIRED_FIELDS: [keyof Fragrance, (v: unknown) => boolean][] = [
  ["id", isFilled],
  ["name", isString],
  ["brand", isString],
  ["family", (v) => isString(v) && FAMILY_IDS.includes(v as never)],
  ["volumeMl", isNumber],
  ["remainingPct", isNumber],
  ["sprayPerUse", isNumber],
  ["usesPerWeek", isNumber],
  ["seasons", isEnumArray(SEASON_IDS)],
  ["scenes", isEnumArray(SCENE_IDS)],
  ["pyramid", isPyramid],
  ["notes", isString],
  ["purchaseDate", isOptionalISODate],
  ["price", isNumber],
  ["photoIds", isEmptyArray],
  ["wearLog", isISODateArray],
  ["createdAt", isISOTimestamp],
  ["updatedAt", isISOTimestamp],
];

/** 版1の形をしていない記録なら、最初に見つけた不備の項目名を返す(健全なら null)。 */
export function invalidFieldOf(raw: unknown): string | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return "形式";
  const o = raw as Record<string, unknown>;
  for (const [key, ok] of REQUIRED_FIELDS) {
    if (!ok(o[key])) return key;
  }
  return null;
}

/** JSON テキストを検証して Fragrance[] に。壊れていれば理由付きで失敗を返す。 */
export function parseBackup(text: string, now: string): ParseResult {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, error: "JSON として読み取れませんでした" };
  }
  const o = data as Record<string, unknown>;
  if (!o || typeof o !== "object") {
    return { ok: false, error: "バックアップの形式ではありません" };
  }
  if (o.app !== "fragrance-techo") {
    return { ok: false, error: "このアプリのバックアップではありません" };
  }
  // 版の検証は fragrances の形を見る前に行う。将来版で項目名が変わっていても
  // 「app と fragrances さえあれば通る」状態だと、既定値へ丸めた劣化データで
  // 手元の記録を置き換えてしまう(取り込みは元に戻せない)。
  if (typeof o.version !== "number" || !Number.isInteger(o.version)) {
    return { ok: false, error: "バックアップの版が読み取れません" };
  }
  if (o.version > BACKUP_VERSION) {
    return {
      ok: false,
      error: `新しい版のバックアップです(版 ${o.version})。アプリを最新にしてからお試しください`,
    };
  }
  if (o.version !== BACKUP_VERSION) {
    return {
      ok: false,
      error: `対応していない版のバックアップです(版 ${o.version})`,
    };
  }
  if (!Array.isArray(o.fragrances)) {
    return { ok: false, error: "ボトルのデータが見つかりません" };
  }
  // 1件でも版1の形をしていなければ、全体を取り下げる。通った分だけ取り込むと、
  // 「何件が置き換わって何件が残ったか」を利用者が把握できないまま、元に戻せない
  // 置き換えが一部だけ走ることになる。
  //
  // 1件ずつの検証では id の重複を見つけられない。id はこのアプリ全体で
  // 「ボトル1本を一意に指すもの」で、取り込みも保存も画面の描画も id で突き合わせる。
  // 同じ id の記録が2件あるファイルを通すと、取り込みは後の1件で先の1件を黙って
  // 上書きしながら「2件を取り込みました」と告げ、利用者は消えた側の存在に気付けない
  // (取り込みは元に戻せない)。件数と結果が食い違う取り込みは走らせない。
  const fragrances: Fragrance[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < o.fragrances.length; i++) {
    const bad = invalidFieldOf(o.fragrances[i]);
    if (bad !== null) {
      return {
        ok: false,
        error: `${i + 1} 件目のボトルの内容が壊れています(${bad})。記録を置き換える前に中止しました`,
      };
    }
    // invalidFieldOf を通っているので id は空でない文字列。
    const id = (o.fragrances[i] as { id: string }).id;
    if (seen.has(id)) {
      return {
        ok: false,
        error: `${i + 1} 件目のボトルが、前のボトルと同じ id を持っています。記録を置き換える前に中止しました`,
      };
    }
    seen.add(id);
    fragrances.push(normalizeFragrance(o.fragrances[i], now));
  }
  return { ok: true, fragrances };
}
