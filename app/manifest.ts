import type { MetadataRoute } from "next";

// PWA マニフェスト。static export では out/manifest.webmanifest として書き出される。
export const dynamic = "force-static";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Sillage — フレグランス手帖",
    short_name: "フレグランス手帖",
    description:
      "香水コレクションを写真・香調・残量で管理。今日の1本提案・重複購入ガード・使い切り予測。端末内完結。",
    start_url: "./",
    scope: "./",
    display: "standalone",
    background_color: "#f3efe6",
    theme_color: "#5a4a8f",
    lang: "ja",
    icons: [
      {
        src: "icon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any",
      },
    ],
  };
}
