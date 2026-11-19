import { useCallback, useEffect, useState } from "react";
import { getHealth, listVideos, type Health, type Video } from "./api";
import { isWorking } from "./format";
import UploadCard from "./components/UploadCard";
import VideoList from "./components/VideoList";
import VideoDetail from "./components/VideoDetail";

function idFromHash(): string | null {
  const m = window.location.hash.match(/^#\/video\/([\w-]+)$/);
  return m ? m[1] : null;
}

export default function App() {
  const [videos, setVideos] = useState<Video[]>([]);
  const [selectedId, setSelectedIdState] = useState<string | null>(idFromHash);
  const [health, setHealth] = useState<Health | null>(null);
  const [offline, setOffline] = useState(false);

  // Keep the selected video in the URL (#/video/<id>) so links and Back work.
  const setSelectedId = useCallback((id: string | null) => {
    setSelectedIdState(id);
    const hash = id ? `#/video/${id}` : "";
    if (window.location.hash !== hash) {
      history.pushState(null, "", hash || window.location.pathname);
    }
  }, []);
  useEffect(() => {
    const onPop = () => setSelectedIdState(idFromHash());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const list = await listVideos();
      setVideos(list);
      setOffline(false);
    } catch {
      setOffline(true);
    }
  }, []);

  useEffect(() => {
    const loadHealth = () =>
      getHealth()
        .then((h) => {
          setHealth(h);
          setOffline(false);
        })
        .catch(() => setOffline(true));
    loadHealth();
    refresh();
    // The desktop engine may need a moment to start; re-check health periodically.
    const t = window.setInterval(loadHealth, 15000);
    return () => window.clearInterval(t);
  }, [refresh]);

  // Poll quickly while something is processing, slowly otherwise.
  const busy = videos.some((v) => isWorking(v.status));
  useEffect(() => {
    const t = window.setInterval(refresh, busy ? 2000 : 10000);
    return () => window.clearInterval(t);
  }, [busy, refresh]);

  const selected = videos.find((v) => v.id === selectedId) ?? null;

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <img src="/icon.svg" alt="" width={32} height={32} />
          <div>
            <h1>Automate</h1>
            <p>Video → transcript, captions &amp; speaking speed</p>
          </div>
        </div>
        {health && (
          <span
            className={`engine ${health.ok ? "ok" : "warn"}`}
            title={
              health.vision
                ? `Silent videos: steps are read from the screen with ${health.vision_model}`
                : "Silent videos: install Ollama + a vision model to read steps from the screen"
            }
          >
            {health.ok ? `Engine ready · ${health.model_name ?? "whisper"}` : "Setup needed"}
            {health.vision ? " · screen reader on" : ""}
          </span>
        )}
      </header>

      {offline && (
        <div className="banner error">
          Can't reach the analysis engine. Start it with <code>npm run server</code> (website) or
          restart the desktop app.
        </div>
      )}
      {health && !health.ok && (
        <div className="banner warn">
          Missing free tools:
          {!health.ffmpeg && " ffmpeg"}
          {!health.whisper && " whisper-cli"}
          {!health.model && " whisper model"}. Run <code>scripts\setup-tools.ps1</code> once, then
          restart.
        </div>
      )}

      <main className="layout">
        <aside className="sidebar">
          <UploadCard
            maxUploadMb={health?.max_upload_mb}
            onUploaded={(v) => {
              setVideos((prev) => [v, ...prev]);
              setSelectedId(v.id);
            }}
          />
          <VideoList
            videos={videos}
            selectedId={selectedId}
            onSelect={setSelectedId}
          />
        </aside>
        <section className="content">
          {selected ? (
            <VideoDetail
              key={selected.id}
              summary={selected}
              onChanged={refresh}
              onDeleted={() => {
                setSelectedId(null);
                refresh();
              }}
            />
          ) : (
            <div className="empty card">
              <h2>Upload a video to get started</h2>
              <p>
                Automate extracts the speech, writes a full transcript, creates timed captions
                (SRT / VTT) and measures how fast people speak. Everything runs on this machine —
                free and private.
              </p>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
