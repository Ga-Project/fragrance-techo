// フレグランス手帖 — 写真の縮小(端末内保存量を抑える)。ブラウザ専用。

/** 画像ファイルを最大辺 maxEdge に縮小した JPEG Blob へ。失敗時は元の Blob を返す。 */
export async function downscaleImage(
  file: Blob,
  maxEdge = 1000,
  quality = 0.82,
): Promise<Blob> {
  if (
    typeof window === "undefined" ||
    typeof createImageBitmap !== "function"
  ) {
    return file;
  }
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, w, h);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob((b) => resolve(b), "image/jpeg", quality),
    );
    return blob ?? file;
  } catch {
    return file;
  }
}
