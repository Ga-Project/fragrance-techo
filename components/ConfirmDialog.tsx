"use client";

// フレグランス手帖 — 取り消せない操作の確認ダイアログ。
//
// 取り消せる操作にまで挟むと「はい」を押すだけの作業になり、肝心のときも読まれない。
// ここを通すのは「押した瞬間に復元手段が無くなる操作」だけ:
//   ・ボトルを手放す(写真の実体まで消える。バックアップJSONには写真が入らない)
//   ・入力の破棄(この編集で取り込んだ写真の実体も一緒に回収される)
//   ・バックアップの取り込み(同じボトルの記録が置き換わる)

import { Icon } from "./visuals";
import { useDialog } from "./useDialog";

export function ConfirmDialog({
  title,
  body,
  confirmLabel,
  cancelLabel = "やめる",
  tone = "danger",
  onConfirm,
  onCancel,
}: {
  title: string;
  body: string;
  confirmLabel: string;
  cancelLabel?: string;
  tone?: "danger" | "accent";
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const dialogRef = useDialog(onCancel);

  return (
    <div
      className="sheet-scrim sheet-scrim--confirm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div
        className="sheet sheet--confirm"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        aria-describedby="confirm-body"
        ref={dialogRef}
        tabIndex={-1}
      >
        <div className="confirm-body">
          <p className="confirm-title" id="confirm-title">
            <Icon.alert size={18} /> {title}
          </p>
          <p className="confirm-lead" id="confirm-body">
            {body}
          </p>
        </div>
        <footer className="sheet-foot">
          <span className="sheet-spacer" />
          <button type="button" className="btn btn--ghost" onClick={onCancel}>
            {cancelLabel}
          </button>
          <button
            type="button"
            className={`btn ${tone === "danger" ? "btn--danger" : "btn--primary"}`}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </footer>
      </div>
    </div>
  );
}
