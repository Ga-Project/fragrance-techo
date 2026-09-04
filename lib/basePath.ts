// 配信ベースパス。next.config.mjs の basePath と同じ env を読む
// （NEXT_PUBLIC_ なのでビルド時に値が埋め込まれる。未設定＝ルート配信＝空文字）。
//
// 404 ページは GitHub Pages が「存在しない任意の URL」に対して配信する。相対 URL は
// その存在しない URL 基準で解決されるため、たとえば /<repo>/missing/ で出た 404 の
// 「./」は同じ存在しないディレクトリを指し、押しても再び 404 になる。復帰導線には
// ベースパス込みの絶対パスを使う。
export const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH || "";

/** アプリのルート URL（末尾スラッシュ付き・trailingSlash 設定に合わせる）。 */
export const APP_ROOT = `${BASE_PATH}/`;

/** ベースパス込みの絶対パスに整える（"icon.svg" -> "/<repo>/icon.svg"）。 */
export function withBasePath(path: string): string {
  return `${BASE_PATH}/${path.replace(/^\/+/, "")}`;
}
