// フレグランス手帖 — ボトルの既定値・正規化(破損/外部データに強く)。

import type { Fragrance, FamilyId, Pyramid, Scene, Season } from "./types";
import { clampPct, isISODate } from "./format.ts";

export const FAMILY_IDS: FamilyId[] = [
  "citrus",
  "green",
  "aromatic",
  "floral",
  "fruity",
  "gourmand",
  "woody",
  "oriental",
];
export const SEASON_IDS: Season[] = ["spring", "summer", "autumn", "winter"];
export const SCENE_IDS: Scene[] = [
  "daily",
  "office",
  "date",
  "formal",
  "relax",
];

export function newId(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  return `f_${Math.abs(Date.now()).toString(36)}_${Math.floor(
    (globalThis.performance?.now?.() ?? 0) * 1000,
  ).toString(36)}`;
}

function str(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : fallback;
}

function num(v: unknown, fallback = 0): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function pickEnumArray<T extends string>(v: unknown, allowed: T[]): T[] {
  if (!Array.isArray(v)) return [];
  const set = new Set(allowed);
  const out: T[] = [];
  for (const item of v) {
    if (
      typeof item === "string" &&
      set.has(item as T) &&
      !out.includes(item as T)
    ) {
      out.push(item as T);
    }
  }
  return out;
}

function pyramidOf(v: unknown): Pyramid {
  const o = (v ?? {}) as Record<string, unknown>;
  return { top: str(o.top), heart: str(o.heart), base: str(o.base) };
}

function familyOfRaw(v: unknown): FamilyId {
  return typeof v === "string" && (FAMILY_IDS as string[]).includes(v)
    ? (v as FamilyId)
    : "floral";
}

function strArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === "string");
}

/**
 * 使用日の履歴。日付として読めない要素は落とす。
 *
 * wearLog は「件数 = 使用回数」「最大値 = 最後に使った日」「最初と最後の間隔 = 消費速度」
 * として使われる。日付でない要素が残ると、回数には数えられるのに日付としては解釈できず、
 * 使い切り予測もローテーション提案も狂う(しかも文字列の最大値としては日付より
 * 大きく出ることがあり、「最後に使った日」が乗っ取られる)。
 * 取り込み経路は parseBackup が受け付けずに止めるが、こちらは端末に既に入っている
 * 壊れた保存データからの復帰経路なので、読めない要素を落として先へ進める。
 */
function wearLogOf(v: unknown): string[] {
  return strArray(v).filter(isISODate).sort();
}

/** ボトル容量の既定値(ml)。 */
const DEFAULT_VOLUME_ML = 50;

/**
 * 容量(ml)。0 を許すと残量 ml が常に 0 になり、残量%が残っていても使い切り予測が
 * 止まる。容量の入力は送信ボタンではなく onClick 保存なので、input の min=1 は
 * 効かない(空欄や 0 がそのまま届く)。ここを最後の砦にする。
 *   空欄・0 以下・数値でない → 既定値
 *   0 より大きい            → 最低 1ml
 */
function volumeOf(v: unknown): number {
  const n = num(v, DEFAULT_VOLUME_ML);
  if (!(n > 0)) return DEFAULT_VOLUME_ML;
  return Math.max(1, n);
}

/** 任意の生データを健全な Fragrance へ正規化する。 */
export function normalizeFragrance(raw: unknown, now: string): Fragrance {
  const o = (raw ?? {}) as Record<string, unknown>;
  const volumeMl = volumeOf(o.volumeMl);
  return {
    id: str(o.id) || newId(),
    name: str(o.name),
    brand: str(o.brand),
    family: familyOfRaw(o.family),
    volumeMl,
    remainingPct: clampPct(num(o.remainingPct, 100)),
    sprayPerUse: Math.max(1, Math.round(num(o.sprayPerUse, 3))),
    usesPerWeek: Math.max(0, num(o.usesPerWeek, 3)),
    seasons: pickEnumArray<Season>(o.seasons, SEASON_IDS),
    scenes: pickEnumArray<Scene>(o.scenes, SCENE_IDS),
    pyramid: pyramidOf(o.pyramid),
    notes: str(o.notes),
    purchaseDate: str(o.purchaseDate),
    price: Math.max(0, num(o.price, 0)),
    photoIds: strArray(o.photoIds),
    wearLog: wearLogOf(o.wearLog),
    createdAt: str(o.createdAt) || now,
    updatedAt: str(o.updatedAt) || now,
  };
}

/**
 * 編集フォームの内容を、保存時点の実体へ項目ごとに反映する(3-way マージ)。
 *
 * 編集シートは開いた瞬間のボトルを写し取って持ち続ける。保存時にそのボトルを
 * 丸ごと差し替えると、開いている間に別タブが同じボトルへ加えた変更
 * (「つけた」による使用履歴の追加と残量の減少など)が、フォームが触ってすらいない
 * 項目まで含めて古い写しへ巻き戻る。コレクション全体の読み直しでは防げない
 * (消えるのは別のボトルではなく、同じボトルの中身)。
 *
 * 判定は項目ごとに「フォームで変わったか」だけで行う。
 *   base   : 編集を開いた時点のボトル
 *   local  : フォームが返した内容
 *   remote : 保存する瞬間に保存先にあるボトル
 *   local が base と同じ項目 = フォームは触っていない → remote を残す
 *   local が base と違う項目 = 利用者が入力した            → local を採る
 * 使用履歴(wearLog)や createdAt はフォームに入力欄が無いので必ず remote 側が残る。
 * 両方が同じ項目を変えていた場合は、目の前で入力した local を優先する
 * (残量スライダーを動かした上での保存は「いまこの値にする」という明示の指定)。
 * ただし写真の参照(photoIds)だけは「優先」では済まない。下記 mergePhotoIds を参照。
 */
export function mergeFragranceEdit(
  base: Fragrance,
  local: Fragrance,
  remote: Fragrance,
): Fragrance {
  const out: Record<string, unknown> = { ...remote };
  for (const key of Object.keys(local) as (keyof Fragrance)[]) {
    if (key === "photoIds") continue; // 下で加除をマージする
    // 配列・pyramid も含めて中身で比較する(生成元が同じ正規化なのでキー順は揃う)。
    if (JSON.stringify(local[key]) !== JSON.stringify(base[key])) {
      out[key] = local[key];
    }
  }
  out.photoIds = mergePhotoIds(base.photoIds, local.photoIds, remote.photoIds);
  return out as Fragrance;
}

/**
 * 写真の参照を「値の置き換え」ではなく「加除の適用」でマージする。
 *
 * photoIds は他の項目と違い、IndexedDB に置いた実体(Blob)への参照であり、
 * 双方のタブが同時に増やせる項目でもある(編集シートを開いたまま、別タブで同じボトルに
 * 写真を足す)。ここを local で丸ごと置き換えると、後から保存した側のフォームが
 * 知らない写真 id がメタ情報から消える。消えた id はどちらのフォームの回収対象
 * (pendingDeletes / sessionAdded)にも入っていないため、実体だけが IndexedDB に残り、
 * 誰からも辿れず誰にも消せない孤児になる(容量だけを食い続ける)。
 *
 * そこで local の変更を「base からの加除」として解釈し、remote へ適用する。
 *   外した(base にあって local に無い) → remote からも外す(実体はフォームが消す)
 *   足した(local にあって base に無い) → remote の後ろへ足す
 *   触っていない                        → remote の内容をそのまま残す
 * 別タブが外した写真(remote に無い)は base にも local にも残っているが、加除のどちらでも
 * ないため復活しない(実体は外した側が既に消している)。
 */
function mergePhotoIds(
  base: string[],
  local: string[],
  remote: string[],
): string[] {
  const removed = new Set(base.filter((id) => !local.includes(id)));
  const kept = remote.filter((id) => !removed.has(id));
  const added = local.filter((id) => !base.includes(id) && !kept.includes(id));
  return [...kept, ...added];
}

/** 新規入力の下書き(フォーム初期値)。 */
export function emptyDraft(now: string): Fragrance {
  return {
    id: newId(),
    name: "",
    brand: "",
    family: "floral",
    volumeMl: DEFAULT_VOLUME_ML,
    remainingPct: 100,
    sprayPerUse: 3,
    usesPerWeek: 3,
    seasons: [],
    scenes: [],
    pyramid: { top: "", heart: "", base: "" },
    notes: "",
    purchaseDate: "",
    price: 0,
    photoIds: [],
    wearLog: [],
    createdAt: now,
    updatedAt: now,
  };
}
