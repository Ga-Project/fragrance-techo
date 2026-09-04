/** @type {import('next').NextConfig} */
// サブパス配信（例: <owner>.github.io/<repo>/）では basePath/assetPrefix が必須
// （未設定だと /_next/... がドメイン直下に解決され全アセットが 404 になる）。
// ルート配信や独自ドメインでは空でよいので env で切り替える（既定＝空＝ルート配信）。
const basePath = process.env.NEXT_PUBLIC_BASE_PATH || "";

const nextConfig = {
  reactStrictMode: true,
  // static export（out/ に静的書き出し）。サーバランタイム不要。
  output: "export",
  // export では Next の画像最適化サーバが使えないため無効化。
  images: { unoptimized: true },
  // 各ルートを /path/index.html として出力し、サブディレクトリ配信で 404 を避ける。
  trailingSlash: true,
  ...(basePath ? { basePath, assetPrefix: basePath } : {}),
};

export default nextConfig;
