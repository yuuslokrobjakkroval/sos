import { useEffect, useRef, useState } from "react";
import type { AnalysisResult, Video } from "../api";
import { getExport, getVideo } from "../api";

export function useInsights(videos: Video[] | null) {
  const [results, setResults] = useState<Record<string, AnalysisResult>>({});
  const [exportsDone, setExportsDone] = useState(0);
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const videosRef = useRef(videos);
  videosRef.current = videos;

  const key =
    videos === null
      ? null
      : videos
          .filter((video) => video.status === "done")
          .map((video) => `${video.id}:${video.updated_at}`)
          .join("|");

  useEffect(() => {
    if (key === null) return;
    const done = (videosRef.current ?? []).filter((video) => video.status === "done");
    let alive = true;
    (async () => {
      const next: Record<string, AnalysisResult> = {};
      let exported = 0;
      for (let index = 0; index < done.length; index += 4) {
        const chunk = done.slice(index, index + 4);
        const rows = await Promise.all(
          chunk.map(async (video) => {
            try {
              const [full, exp] = await Promise.all([
                getVideo(video.id),
                getExport(video.id).catch(() => null),
              ]);
              return { id: video.id, result: full.result, exported: exp?.status === "done" };
            } catch {
              return { id: video.id, result: undefined, exported: false };
            }
          }),
        );
        for (const row of rows) {
          if (row.result) next[row.id] = row.result;
          if (row.exported) exported += 1;
        }
      }
      if (!alive) return;
      setResults(next);
      setExportsDone(exported);
      setLoadedKey(key);
    })();
    return () => {
      alive = false;
    };
  }, [key]);

  return { results, exportsDone, loaded: key !== null && loadedKey === key };
}
