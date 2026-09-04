"use client";

// モーダル用: Escape で閉じる・開いたら中へフォーカス・Tab を内側に閉じ込める・
// 閉じたら元の要素へフォーカスを戻す。返す ref をダイアログ要素(tabIndex=-1)に付ける。

import { useEffect, useRef } from "react";

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),textarea:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])';

// 開いているダイアログの重なり順。確認ダイアログのようにモーダルが重なると、
// keydown はどちらも document で受けるため、Escape が背面のシートまで一緒に
// 閉じてしまう(同じ要素の別リスナーは stopPropagation では止まらない)し、
// Tab の閉じ込めも背面と奪い合う。最前面の 1 枚だけが鍵盤を扱う。
const openDialogs: HTMLElement[] = [];

export function useDialog(onClose: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const node = ref.current;
    if (node) openDialogs.push(node);
    node?.focus();

    function onKey(e: KeyboardEvent) {
      if (!node || openDialogs[openDialogs.length - 1] !== node) return;
      if (e.key === "Escape") {
        e.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (e.key !== "Tab" || !node) return;
      const items = Array.from(
        node.querySelectorAll<HTMLElement>(FOCUSABLE),
      ).filter((el) => el.offsetParent !== null);
      if (items.length === 0) return;
      const first = items[0]!;
      const last = items[items.length - 1]!;
      const active = document.activeElement as HTMLElement | null;

      // 開いた直後のフォーカスはダイアログ要素そのもの(tabIndex=-1)に置かれる。
      // 「先頭の操作部にいるか」だけを見ていると、この状態からの Shift+Tab が
      // どの条件にも当たらず、背面の要素へ抜けてしまう(aria-modal があっても
      // キーボードでは素通りできる)。フォーカスがダイアログ内に無い場合も含め、
      // 逆方向は必ず末尾へ折り返す。
      if (!active || !node.contains(active)) {
        e.preventDefault();
        (e.shiftKey ? last : first).focus();
        return;
      }
      const index = items.indexOf(active);
      if (e.shiftKey && (active === node || index === 0)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && index === items.length - 1) {
        e.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      if (node) {
        const i = openDialogs.lastIndexOf(node);
        if (i >= 0) openDialogs.splice(i, 1);
      }
      prev?.focus?.();
    };
  }, []);

  return ref;
}
