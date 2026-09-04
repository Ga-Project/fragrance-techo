"use client";

// フレグランス手帖 — 「今日の1本」スポットライト。一灯だけ灯るバイアル。

import type { CSSProperties } from "react";
import type { Fragrance, Season } from "../lib/types";
import { familyOf } from "../lib/families";
import { lastWorn, seasonOf } from "../lib/suggest";
import { daysBetween } from "../lib/format";
import { Icon, Pyramid, Vial } from "./visuals";

const SEASON_JP: Record<Season, string> = {
  spring: "春",
  summer: "夏",
  autumn: "秋",
  winter: "冬",
};

function reasonFor(f: Fragrance, todayISO: string): string {
  const season = seasonOf(todayISO);
  const bits: string[] = [];
  if (f.seasons.includes(season)) bits.push(`${SEASON_JP[season]}にふさわしい`);
  const worn = lastWorn(f);
  if (worn === null) bits.push("まだ袖を通していない");
  else {
    const since = daysBetween(worn, todayISO) ?? 0;
    if (since >= 14) bits.push(`${since}日ぶりの巡り`);
    else if (since >= 1) bits.push("しばらく休ませていた");
  }
  if (bits.length === 0) return "今日の気分に。";
  return bits.join("・") + "。";
}

export function TodaysPick({
  f,
  todayISO,
  onWear,
  onOpen,
  wearing = false,
}: {
  f: Fragrance;
  todayISO: string;
  onWear: (id: string) => void;
  onOpen: (id: string) => void;
  /** このボトルの「つけた」を書き込み中(確定するまで押せない)。 */
  wearing?: boolean;
}) {
  const fam = familyOf(f.family);
  return (
    <section
      className="spotlight"
      aria-label="今日の1本"
      style={{ ["--fhue" as string]: fam.hue } as CSSProperties}
    >
      <div className="spot-stage">
        <Vial
          pct={f.remainingPct}
          hue={fam.hue}
          size={120}
          glow
          title={f.name}
        />
      </div>
      <div className="spot-body">
        <p className="spot-eyebrow">
          <Icon.sparkle size={15} /> 今日の1本
        </p>
        <h2 className="spot-name">{f.name || "無名のボトル"}</h2>
        <p className="spot-brand">
          {f.brand || "ブランド未設定"} ・ {fam.label}
        </p>
        <p className="spot-reason">{reasonFor(f, todayISO)}</p>
        <div className="spot-pyramid">
          <Pyramid pyramid={f.pyramid} family={f.family} compact />
        </div>
        <div className="spot-actions">
          <button
            type="button"
            className="btn btn--wear"
            onClick={() => onWear(f.id)}
            disabled={f.remainingPct <= 0 || wearing}
          >
            <Icon.drop size={16} /> {wearing ? "記録中…" : "これをつけた"}
          </button>
          <button
            type="button"
            className="btn btn--ghost"
            onClick={() => onOpen(f.id)}
          >
            詳しく見る
          </button>
        </div>
      </div>
    </section>
  );
}
