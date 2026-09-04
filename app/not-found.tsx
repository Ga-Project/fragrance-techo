// フレグランス手帖 — 404。static export では out/404.html に書き出される。
import type { Metadata } from "next";
import { APP_ROOT } from "../lib/basePath";

export const metadata: Metadata = {
  title: "404 — フレグランス手帖",
  robots: { index: false, follow: false },
};

export default function NotFound() {
  return (
    <main
      style={{
        maxWidth: "420px",
        margin: "0 auto",
        padding: "22vh 24px",
        textAlign: "center",
      }}
    >
      <p
        style={{
          fontSize: "0.74rem",
          letterSpacing: "0.24em",
          textTransform: "uppercase",
          color: "var(--ink-2)",
        }}
      >
        Sillage
      </p>
      <h1
        style={{
          fontFamily: "var(--font-serif)",
          fontSize: "2rem",
          margin: "8px 0 12px",
        }}
      >
        香りの棚が見つかりません
      </h1>
      <p style={{ color: "var(--ink-2)", marginBottom: "20px" }}>
        お探しのページは存在しないようです。
      </p>
      {/* この 404 は存在しない任意の URL に対して配信される。相対 URL だと
          /<repo>/missing/ のような末尾スラッシュ付きの URL でまた 404 に戻るため、
          ベースパス込みのルートを指す。 */}
      <a
        href={APP_ROOT}
        style={{
          display: "inline-block",
          minHeight: "44px",
          lineHeight: "44px",
          padding: "0 22px",
          borderRadius: "999px",
          background: "var(--accent-fill)",
          color: "var(--on-accent)",
          fontWeight: 600,
        }}
      >
        調香卓へ戻る
      </a>
    </main>
  );
}
