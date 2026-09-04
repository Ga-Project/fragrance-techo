"use client";

// フレグランス手帖 — 端末内写真の表示。IndexedDB の Blob を object URL 化して描画し、
// アンマウント時に revoke する。

import { useEffect, useState } from "react";
import { getPhoto } from "../lib/db";

export function usePhotoUrl(id: string | null): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let revoked = false;
    let objectUrl: string | null = null;
    setUrl(null);
    if (!id) return;
    getPhoto(id)
      .then((blob) => {
        if (revoked || !blob) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch(() => {});
    return () => {
      revoked = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [id]);
  return url;
}

export function PhotoThumb({
  id,
  alt,
  className,
}: {
  id: string | null;
  alt: string;
  className?: string;
}) {
  const url = usePhotoUrl(id);
  if (!url) return null;
  // eslint-disable-next-line @next/next/no-img-element -- static export・端末内 object URL
  return <img className={className} src={url} alt={alt} loading="lazy" />;
}
