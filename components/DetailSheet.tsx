"use client";

// フレグランス手帖 — ボトル詳細。香りのピラミッドを主役に、残量と使い切り予測を見せる。

import type { CSSProperties } from "react";
import type { Fragrance } from "../lib/types";
import { familyOf, sceneLabel, seasonLabel } from "../lib/families";
import { daysUntilEmpty, lastWorn, predictEmptyDate } from "../lib/suggest";
import { humanizeDays, remainingLabel, yen } from "../lib/format";
import { Icon, Pyramid, Vial } from "./visuals";
import { PhotoThumb } from "./photos";
import { useDialog } from "./useDialog";

export function DetailSheet({
  f,
  todayISO,
  onClose,
  onEdit,
  onWear,
  wearing = false,
}: {
  f: Fragrance;
  todayISO: string;
  onClose: () => void;
  onEdit: (id: string) => void;
  onWear: (id: string) => void;
  /** このボトルの「つけた」を書き込み中(確定するまで押せない)。 */
  wearing?: boolean;
}) {
  const dialogRef = useDialog(onClose);
  const fam = familyOf(f.family);
  const empty = f.remainingPct <= 0;
  const worn = lastWorn(f);
  const days = daysUntilEmpty(f, todayISO);
  const emptyDate = predictEmptyDate(f, todayISO);

  return (
    <div
      className="sheet-scrim"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="sheet sheet--detail"
        role="dialog"
        aria-modal="true"
        aria-labelledby="detail-title"
        style={{ ["--fhue" as string]: fam.hue } as CSSProperties}
        ref={dialogRef}
        tabIndex={-1}
      >
        <header className="sheet-head">
          <h2 id="detail-title">{f.name || "無名のボトル"}</h2>
          <button
            type="button"
            className="btn btn--ghost btn--icon"
            onClick={onClose}
            aria-label="閉じる"
          >
            <Icon.close />
          </button>
        </header>

        <div className="sheet-body">
          <div className="detail-hero">
            <div className="detail-vial">
              <Vial pct={f.remainingPct} hue={fam.hue} size={104} />
            </div>
            <div className="detail-meta">
              <p className="detail-brand">{f.brand || "ブランド未設定"}</p>
              <p className="detail-fam">
                <span className="fam-dot" aria-hidden="true" /> {fam.label}
                <span className="detail-blurb"> — {fam.blurb}</span>
              </p>
              <dl className="detail-stats">
                <div>
                  <dt>残量</dt>
                  <dd>{remainingLabel(f.remainingPct)}</dd>
                </div>
                <div>
                  <dt>使い切り予測</dt>
                  <dd>{empty ? "空" : humanizeDays(days)}</dd>
                </div>
                <div>
                  <dt>目安の日</dt>
                  <dd>{empty ? "—" : (emptyDate ?? "—")}</dd>
                </div>
                <div>
                  <dt>最後に使った日</dt>
                  <dd>{worn ?? "まだ未使用"}</dd>
                </div>
                <div>
                  <dt>容量</dt>
                  <dd>{f.volumeMl}ml</dd>
                </div>
                <div>
                  <dt>価格</dt>
                  <dd>{yen(f.price)}</dd>
                </div>
              </dl>
            </div>
          </div>

          {f.photoIds.length > 0 && (
            <div className="detail-gallery">
              {f.photoIds.map((pid) => (
                <PhotoThumb
                  key={pid}
                  id={pid}
                  alt="ボトルの写真"
                  className="gallery-img"
                />
              ))}
            </div>
          )}

          <h3 className="detail-h3">香りのピラミッド</h3>
          <Pyramid pyramid={f.pyramid} family={f.family} />

          {(f.seasons.length > 0 || f.scenes.length > 0) && (
            <div className="detail-tags">
              {f.seasons.map((s) => (
                <span className="tag tag--season" key={s}>
                  {seasonLabel(s)}
                </span>
              ))}
              {f.scenes.map((s) => (
                <span className="tag tag--scene" key={s}>
                  {sceneLabel(s)}
                </span>
              ))}
            </div>
          )}

          {f.notes.trim() && (
            <>
              <h3 className="detail-h3">メモ</h3>
              <p className="detail-notes">{f.notes}</p>
            </>
          )}

          {f.wearLog.length > 0 && (
            <p className="detail-worn">
              これまで {f.wearLog.length} 回つけました。
            </p>
          )}
        </div>

        <footer className="sheet-foot">
          <span className="sheet-spacer" />
          <button
            type="button"
            className="btn btn--ghost"
            onClick={() => onEdit(f.id)}
          >
            <Icon.edit size={16} /> 編集
          </button>
          <button
            type="button"
            className="btn btn--wear"
            onClick={() => onWear(f.id)}
            disabled={empty || wearing}
          >
            <Icon.drop size={16} /> {wearing ? "記録中…" : "つけた"}
          </button>
        </footer>
      </div>
    </div>
  );
}
