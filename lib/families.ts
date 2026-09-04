// フレグランス手帖 — 香調(オルファクティブ・ファミリー)の分類とスペクトル配色。
// この配色は「香りの輪(スペクトル帯)」を成すこのアプリの視覚言語。

import type { FamilyId, Season, Scene } from "./types";

export type Family = {
  id: FamilyId;
  label: string;
  /** スペクトル帯・チップ・液面の縁に使う香調色。 */
  hue: string;
  /** 一言の性格。 */
  blurb: string;
};

/** 香りの輪の順に並べた8香調。並び順がスペクトル帯の並びになる。 */
export const FAMILIES: Family[] = [
  {
    id: "citrus",
    label: "シトラス",
    hue: "#d69a1f",
    blurb: "弾ける柑橘・軽やか",
  },
  {
    id: "green",
    label: "グリーン",
    hue: "#7f9f4c",
    blurb: "青葉・草の瑞々しさ",
  },
  {
    id: "aromatic",
    label: "アロマティック",
    hue: "#3f9d80",
    blurb: "ハーブ・清涼",
  },
  { id: "floral", label: "フローラル", hue: "#cf7fa8", blurb: "花束の華やぎ" },
  { id: "fruity", label: "フルーティ", hue: "#cf6a58", blurb: "果実の甘酸" },
  {
    id: "gourmand",
    label: "グルマン",
    hue: "#b0784a",
    blurb: "バニラ・甘い余韻",
  },
  { id: "woody", label: "ウッディ", hue: "#8a6a47", blurb: "白檀・温もりの木" },
  {
    id: "oriental",
    label: "オリエンタル",
    hue: "#8a6cc0",
    blurb: "琥珀・官能",
  },
];

const FAMILY_BY_ID = new Map(FAMILIES.map((f) => [f.id, f]));

export function familyOf(id: FamilyId): Family {
  const f = FAMILY_BY_ID.get(id);
  // 型上は全 id が存在するが、破損データに備えて先頭へフォールバック。
  return f ?? FAMILIES[0]!;
}

export const SEASONS: { id: Season; label: string }[] = [
  { id: "spring", label: "春" },
  { id: "summer", label: "夏" },
  { id: "autumn", label: "秋" },
  { id: "winter", label: "冬" },
];

export const SCENES: { id: Scene; label: string }[] = [
  { id: "daily", label: "デイリー" },
  { id: "office", label: "オフィス" },
  { id: "date", label: "デート" },
  { id: "formal", label: "フォーマル" },
  { id: "relax", label: "リラックス" },
];

const SEASON_LABEL = new Map(SEASONS.map((s) => [s.id, s.label]));
const SCENE_LABEL = new Map(SCENES.map((s) => [s.id, s.label]));

export function seasonLabel(id: Season): string {
  return SEASON_LABEL.get(id) ?? id;
}

export function sceneLabel(id: Scene): string {
  return SCENE_LABEL.get(id) ?? id;
}
