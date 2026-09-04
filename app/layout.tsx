import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { withBasePath } from "../lib/basePath";
import "./globals.css";

const DESCRIPTION =
  "香水コレクションを写真・香調・残量で手帖のように整える、端末内で完結するフレグランス管理。今日の1本提案・重複購入ガード・使い切り予測。アカウント不要・広告なし。";

export const metadata: Metadata = {
  title: "Sillage — フレグランス手帖 | 香水コレクション管理",
  description: DESCRIPTION,
  applicationName: "フレグランス手帖",
  manifest: "manifest.webmanifest",
  // アイコンの相対パスは basePath が付かず、ページ URL 基準で解決される。
  // 404 は存在しない任意の URL(例: /<repo>/missing/)で配信されるため、相対のままだと
  // そこからアイコンを取りに行って落ちる。ベースパス込みの絶対パスで指す。
  icons: {
    icon: withBasePath("icon.svg"),
    apple: withBasePath("icon.svg"),
  },
  openGraph: {
    title: "Sillage — フレグランス手帖",
    description: DESCRIPTION,
    type: "website",
    locale: "ja_JP",
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f3efe6" },
    { media: "(prefers-color-scheme: dark)", color: "#15121c" },
  ],
  width: "device-width",
  initialScale: 1,
};

// 保存済みテーマを描画前に適用して初期フラッシュを避ける。
const THEME_INIT = `(function(){try{var t=localStorage.getItem("fragrance-techo:theme");if(t==="light"||t==="dark"){document.documentElement.setAttribute("data-theme",t);}}catch(e){}})();`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ja">
      <body>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT }} />
        {/* アクセス解析(cookieless・匿名のページ閲覧数のみ)。 */}
        <script
          data-goatcounter="https://ga-project.goatcounter.com/count"
          async
          src="//gc.zgo.at/count.js"
        />
        {children}
      </body>
    </html>
  );
}
