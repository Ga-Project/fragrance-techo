"use client";

// フレグランス手帖 — 署名ビジュアル。
//   Vial: 残量を液面の高さで見せる硝子瓶(このアプリの核)。
//   Pyramid: 香りの3層(トップ/ミドル/ラスト)。
//   SpectrumRibbon: 香調のオルファクティブ・スペクトル帯フィルタ。

import { useId } from "react";
import type { CSSProperties, ReactNode } from "react";
import type { FamilyId, Pyramid as PyramidData } from "../lib/types";
import { FAMILIES, familyOf } from "../lib/families";

/* ---- 液面バイアル ------------------------------------------------------- */

export function Vial({
  pct,
  hue,
  size = 88,
  glow = false,
  title,
}: {
  pct: number;
  hue: string;
  size?: number;
  glow?: boolean;
  title?: string;
}) {
  const p = Math.max(0, Math.min(100, pct));
  const topY = 34;
  const botY = 92;
  const fillY = botY - ((botY - topY) * p) / 100;
  // SVG の id は文書全体で大域。バイアルは同じ画面に何本も並ぶため、色や残量から
  // 組み立てた id は容易に衝突し、`url(#...)` が別のバイアルの gradient / clipPath を
  // 掴んで色が入れ替わる。インスタンスごとに一意な id を使う。
  // useId の戻り値は区切り記号を含む形式なので、参照に使える文字だけを残す
  // (連番部分は英数字なので一意性は保たれる)。
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const empty = p <= 0;
  return (
    <svg
      className={`vial${glow ? " vial--glow" : ""}`}
      viewBox="0 0 64 104"
      width={size}
      height={(size * 104) / 64}
      role="img"
      aria-label={title ?? `残量 約${Math.round(p)}%`}
      style={{ ["--vhue" as string]: hue } as CSSProperties}
    >
      <defs>
        <clipPath id={`body-${uid}`}>
          <path d="M18 34 Q18 30 22 29 L22 24 L42 24 L42 29 Q46 30 46 34 L46 88 Q46 92 42 92 L22 92 Q18 92 18 88 Z" />
        </clipPath>
        <linearGradient id={`liq-${uid}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={hue} stopOpacity="0.95" />
          <stop offset="1" stopColor={hue} stopOpacity="0.72" />
        </linearGradient>
      </defs>
      {/* cap */}
      <rect x="26" y="6" width="12" height="12" rx="2" className="vial-cap" />
      <rect x="28" y="16" width="8" height="9" className="vial-collar" />
      {/* glass body */}
      <g clipPath={`url(#body-${uid})`}>
        <rect x="14" y="20" width="36" height="76" className="vial-glass" />
        {!empty && (
          <rect
            x="14"
            y={fillY}
            width="36"
            height={botY - fillY + 2}
            fill={`url(#liq-${uid})`}
          />
        )}
        {!empty && (
          <rect
            x="14"
            y={fillY}
            width="36"
            height="2.4"
            className="vial-meniscus"
          />
        )}
      </g>
      {/* outline */}
      <path
        d="M18 34 Q18 30 22 29 L22 24 L42 24 L42 29 Q46 30 46 34 L46 88 Q46 92 42 92 L22 92 Q18 92 18 88 Z"
        className="vial-outline"
      />
      {/* label plate */}
      <rect
        x="23"
        y="58"
        width="18"
        height="20"
        rx="1.5"
        className="vial-plate"
      />
    </svg>
  );
}

/* ---- 香りのピラミッド --------------------------------------------------- */

export function Pyramid({
  pyramid,
  family,
  compact = false,
}: {
  pyramid: PyramidData;
  family: FamilyId;
  compact?: boolean;
}) {
  const hue = familyOf(family).hue;
  const rows: {
    key: keyof PyramidData;
    label: string;
    sub: string;
    w: number;
  }[] = [
    { key: "top", label: "トップ", sub: "最初の香り", w: 46 },
    { key: "heart", label: "ミドル", sub: "中心の香り", w: 72 },
    { key: "base", label: "ラスト", sub: "残り香", w: 100 },
  ];
  return (
    <div className={`pyramid${compact ? " pyramid--compact" : ""}`}>
      {rows.map((r) => {
        const text = pyramid[r.key].trim();
        return (
          <div className="pyr-row" key={r.key}>
            <div
              className="pyr-band"
              style={
                {
                  width: `${r.w}%`,
                  ["--pyhue" as string]: hue,
                } as CSSProperties
              }
            >
              <span className="pyr-tier">{r.label}</span>
            </div>
            <div className="pyr-note">
              {text ? (
                <span>{text}</span>
              ) : (
                <span className="pyr-empty">{r.sub}（未記入）</span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ---- 香調スペクトル帯 --------------------------------------------------- */

export function SpectrumRibbon({
  active,
  counts,
  onSelect,
}: {
  active: FamilyId | null;
  counts: Record<string, number>;
  onSelect: (id: FamilyId | null) => void;
}) {
  return (
    <div className="ribbon" role="group" aria-label="香調でしぼり込む">
      <button
        type="button"
        className={`ribbon-all${active === null ? " is-active" : ""}`}
        aria-pressed={active === null}
        onClick={() => onSelect(null)}
      >
        すべて
      </button>
      <div className="ribbon-track">
        {FAMILIES.map((f) => {
          const n = counts[f.id] ?? 0;
          const on = active === f.id;
          return (
            <button
              type="button"
              key={f.id}
              className={`ribbon-chip${on ? " is-active" : ""}`}
              aria-pressed={on}
              style={{ ["--chue" as string]: f.hue } as CSSProperties}
              onClick={() => onSelect(on ? null : f.id)}
              title={f.blurb}
            >
              <span className="ribbon-swatch" aria-hidden="true" />
              <span className="ribbon-name">{f.label}</span>
              <span className="ribbon-count" aria-hidden={n === 0}>
                {n}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ---- インライン・アイコン ----------------------------------------------- */

type IconProps = { size?: number };
function svg(size: number, children: ReactNode) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export const Icon = {
  plus: ({ size = 20 }: IconProps) =>
    svg(
      size,
      <>
        <path d="M12 5v14" />
        <path d="M5 12h14" />
      </>,
    ),
  close: ({ size = 20 }: IconProps) =>
    svg(
      size,
      <>
        <path d="M6 6l12 12" />
        <path d="M18 6L6 18" />
      </>,
    ),
  sun: ({ size = 20 }: IconProps) =>
    svg(
      size,
      <>
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4" />
      </>,
    ),
  moon: ({ size = 20 }: IconProps) =>
    svg(size, <path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5Z" />),
  download: ({ size = 20 }: IconProps) =>
    svg(
      size,
      <>
        <path d="M12 4v11" />
        <path d="M8 11l4 4 4-4" />
        <path d="M5 20h14" />
      </>,
    ),
  upload: ({ size = 20 }: IconProps) =>
    svg(
      size,
      <>
        <path d="M12 20V9" />
        <path d="M8 13l4-4 4 4" />
        <path d="M5 4h14" />
      </>,
    ),
  trash: ({ size = 18 }: IconProps) =>
    svg(
      size,
      <>
        <path d="M4 7h16" />
        <path d="M9 7V5h6v2" />
        <path d="M6 7l1 13h10l1-13" />
      </>,
    ),
  edit: ({ size = 18 }: IconProps) =>
    svg(
      size,
      <>
        <path d="M4 20h4L19 9l-4-4L4 16v4Z" />
        <path d="M14 5l4 4" />
      </>,
    ),
  drop: ({ size = 18 }: IconProps) =>
    svg(
      size,
      <path d="M12 3s6 6.4 6 10.5A6 6 0 0 1 6 13.5C6 9.4 12 3 12 3Z" />,
    ),
  sparkle: ({ size = 18 }: IconProps) =>
    svg(
      size,
      <path d="M12 3l1.7 5.3L19 10l-5.3 1.7L12 17l-1.7-5.3L5 10l5.3-1.7L12 3Z" />,
    ),
  camera: ({ size = 18 }: IconProps) =>
    svg(
      size,
      <>
        <path d="M4 8h3l1.5-2h7L17 8h3v11H4Z" />
        <circle cx="12" cy="13" r="3.2" />
      </>,
    ),
  alert: ({ size = 18 }: IconProps) =>
    svg(
      size,
      <>
        <path d="M12 4l9 16H3l9-16Z" />
        <path d="M12 10v4" />
        <path d="M12 17h.01" />
      </>,
    ),
};
