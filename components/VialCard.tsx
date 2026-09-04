"use client";

// フレグランス手帖 — コレクション一覧のカード。液面バイアルが主役。

import type { CSSProperties } from "react";
import type { Fragrance } from "../lib/types";
import { familyOf, seasonLabel } from "../lib/families";
import { daysUntilEmpty, predictEmptyDate } from "../lib/suggest";
import { humanizeDays, remainingLabel } from "../lib/format";
import { Icon, Vial } from "./visuals";
import { PhotoThumb } from "./photos";

export function VialCard({
  f,
  todayISO,
  onOpen,
  onWear,
  onEdit,
  wearing = false,
}: {
  f: Fragrance;
  todayISO: string;
  onOpen: (id: string) => void;
  onWear: (id: string) => void;
  onEdit: (id: string) => void;
  /** このボトルの「つけた」を書き込み中(確定するまで押せない)。 */
  wearing?: boolean;
}) {
  const fam = familyOf(f.family);
  const empty = f.remainingPct <= 0;
  const days = daysUntilEmpty(f, todayISO);
  const emptyDate = predictEmptyDate(f, todayISO);
  const photo = f.photoIds[0] ?? null;

  return (
    <article
      className={`card${empty ? " card--empty" : ""}`}
      style={{ ["--fhue" as string]: fam.hue } as CSSProperties}
    >
      <button
        type="button"
        className="card-open"
        onClick={() => onOpen(f.id)}
        aria-label={`${f.name || "無名のボトル"} の詳細を開く`}
      >
        <div className="card-vial">
          {/* 液面バイアルは常に主役。写真はある時だけ小さく添える。 */}
          <Vial pct={f.remainingPct} hue={fam.hue} size={78} />
          {photo && <PhotoThumb id={photo} alt="" className="card-photo" />}
          <span className="card-level" aria-hidden="true">
            <span
              className="card-level-fill"
              style={{
                height: `${Math.max(0, Math.min(100, f.remainingPct))}%`,
              }}
            />
          </span>
        </div>
        <div className="card-body">
          <div className="card-brand">{f.brand || "ブランド未設定"}</div>
          <h3 className="card-name">{f.name || "無名のボトル"}</h3>
          <div className="card-fam">
            <span className="fam-dot" aria-hidden="true" />
            {fam.label}
          </div>
          <dl className="card-stats">
            <div>
              <dt>残量</dt>
              <dd>{remainingLabel(f.remainingPct)}</dd>
            </div>
            <div>
              <dt>使い切り</dt>
              <dd>{empty ? "空になりました" : humanizeDays(days)}</dd>
            </div>
          </dl>
          {(f.seasons.length > 0 || emptyDate) && (
            <div className="card-tags">
              {f.seasons.map((s) => (
                <span className="tag tag--season" key={s}>
                  {seasonLabel(s)}
                </span>
              ))}
              {emptyDate && !empty && (
                <span className="tag tag--date">〜{emptyDate}</span>
              )}
            </div>
          )}
        </div>
      </button>
      <div className="card-actions">
        <button
          type="button"
          className="btn btn--wear"
          onClick={() => onWear(f.id)}
          disabled={empty || wearing}
        >
          <Icon.drop size={16} /> {wearing ? "記録中…" : "つけた"}
        </button>
        <button
          type="button"
          className="btn btn--ghost btn--icon"
          onClick={() => onEdit(f.id)}
          aria-label={`${f.name || "ボトル"} を編集`}
        >
          <Icon.edit size={16} />
        </button>
      </div>
    </article>
  );
}
