import { useEffect, useState, type CSSProperties } from "react";
import { Film01Icon } from "@hugeicons/core-free-icons";
import { API_BASE, mediaUrl } from "@/api";
import { AppIcon } from "@/components/icon";

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
    <div
      title={label}
      className="relative aspect-video overflow-hidden bg-muted"
      style={{ "--thumb": hue(id) } as CSSProperties}
    >
      {src ? (
        <img src={src} alt="" className="size-full object-cover" />
      ) : (
        <div className="absolute inset-0 grid place-items-center text-white" style={{ background: `hsl(${hue(id)} 32% 28%)` }} aria-hidden>
          <AppIcon icon={Film01Icon} size={28} />
        </div>
      )}
    </div>
  );
}
