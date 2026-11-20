import { useEffect, useState, type CSSProperties } from "react";
import { API_BASE, mediaUrl } from "../api";
import { Icon } from "./Icons";

const hue = (id: string) => {
  let hash = 0;
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) % 360;
  return hash;
};

export default function Thumbnail({ id, label }: { id: string; label: string }) {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const video = document.createElement("video");
    if (API_BASE) video.crossOrigin = "anonymous";
    video.muted = true;
    video.preload = "metadata";
    video.playsInline = true;
    const finish = (next: string | null) => {
      if (alive) setSrc(next);
      video.removeAttribute("src");
      video.load();
    };
    const onData = () => {
      const duration = Number.isFinite(video.duration) ? video.duration : 0;
      if (duration <= 0 || video.videoWidth === 0) {
        finish(null);
        return;
      }
      video.currentTime = Math.min(1, duration * 0.1);
    };
    const onSeeked = () => {
      const canvas = document.createElement("canvas");
      canvas.width = 480;
      canvas.height = 270;
      const context = canvas.getContext("2d");
      if (!context) {
        finish(null);
        return;
      }
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      try {
        finish(canvas.toDataURL("image/jpeg", 0.72));
      } catch {
        finish(null);
      }
    };
    video.addEventListener("loadeddata", onData);
    video.addEventListener("seeked", onSeeked);
    video.addEventListener("error", () => finish(null));
    video.src = mediaUrl(id);
    return () => {
      alive = false;
      video.removeAttribute("src");
      video.load();
    };
  }, [id]);

  return (
    <div className="thumb" style={{ "--thumb-hue": hue(id) } as CSSProperties}>
      {src ? (
        <img src={src} alt="" />
      ) : (
        <div className="thumb-fallback" aria-hidden="true">
          <Icon name="film" width={28} height={28} />
          <span>{[...label][0]?.toUpperCase() ?? "·"}</span>
        </div>
      )}
    </div>
  );
}
