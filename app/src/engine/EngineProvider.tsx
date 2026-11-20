import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { getHealth, listVideos, type Health, type Video } from "../api";
import { isWorking } from "./status";

interface EngineValue {
  videos: Video[] | null;
  health: Health | null;
  offline: boolean;
  refresh: () => Promise<void>;
  addVideo: (video: Video) => void;
  removeLocal: (id: string) => void;
}

const EngineContext = createContext<EngineValue | null>(null);

export function EngineProvider({ children }: { children: ReactNode }) {
  const [videos, setVideos] = useState<Video[] | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const [offline, setOffline] = useState(false);

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
        .then((next) => {
          setHealth(next);
          setOffline(false);
        })
        .catch(() => setOffline(true));
    loadHealth();
    void refresh();
    const timer = window.setInterval(loadHealth, 15000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const busy = videos?.some((video) => isWorking(video.status)) ?? false;
  useEffect(() => {
    const timer = window.setInterval(() => void refresh(), busy ? 2000 : 10000);
    return () => window.clearInterval(timer);
  }, [busy, refresh]);

  const addVideo = useCallback((video: Video) => {
    setVideos((prev) => [video, ...(prev ?? []).filter((item) => item.id !== video.id)]);
  }, []);

  const removeLocal = useCallback((id: string) => {
    setVideos((prev) => prev?.filter((item) => item.id !== id) ?? prev);
  }, []);

  const value = useMemo(
    () => ({ videos, health, offline, refresh, addVideo, removeLocal }),
    [videos, health, offline, refresh, addVideo, removeLocal],
  );

  return <EngineContext.Provider value={value}>{children}</EngineContext.Provider>;
}

export function useEngine(): EngineValue {
  const value = useContext(EngineContext);
  if (!value) throw new Error("useEngine must be used within EngineProvider");
  return value;
}
