// Talks to the Rust engine.
// - Website: same origin (`/api`), or VITE_API_BASE if the API is hosted elsewhere.
// - Desktop app (Tauri): the engine embedded in the app on 127.0.0.1:17890.
const isDesktop = "__TAURI_INTERNALS__" in window;
export const API_BASE: string = isDesktop
  ? "http://127.0.0.1:17890"
  : (import.meta.env.VITE_API_BASE ?? "");

export type Status =
  | "queued"
  | "extracting_audio"
  | "transcribing"
  | "analyzing"
  | "reading_screen"
  | "done"
  | "failed";

export interface Segment {
  start_ms: number;
  end_ms: number;
  text: string;
  wpm: number;
}

export interface Stats {
  duration_sec: number;
  speaking_sec: number;
  word_count: number;
  wpm: number;
  wpm_overall: number;
  pace: "slow" | "normal" | "fast" | "no_speech" | "no_audio";
}

export interface AnalysisResult {
  /** speech = transcribed from audio; visual = steps read from the screen; silent = nothing found */
  mode: "speech" | "visual" | "silent";
  language: string | null;
  /** Explanation when the result is empty, e.g. a silent video. */
  notice?: string;
  text: string;
  segments: Segment[];
  stats: Stats;
}

export interface Video {
  id: string;
  filename: string;
  size_bytes: number;
  language: string;
  status: Status;
  progress: number | null;
  error: string | null;
  created_at: string;
  updated_at: string;
  result?: AnalysisResult;
}

export interface Health {
  ok: boolean;
  ffmpeg: boolean;
  whisper: boolean;
  model: boolean;
  model_name: string | null;
  vision: boolean;
  vision_model: string | null;
  max_upload_mb: number;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, init);
  if (!res.ok) {
    let msg = `${res.status} ${res.statusText}`;
    try {
      msg = (await res.json()).error ?? msg;
    } catch {
      /* not JSON */
    }
    throw new Error(msg);
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
}

export const getHealth = () => request<Health>("/api/health");
export const listVideos = () => request<Video[]>("/api/videos");
export const getVideo = (id: string) => request<Video>(`/api/videos/${id}`);
export const deleteVideo = (id: string) =>
  request<void>(`/api/videos/${id}`, { method: "DELETE" });
export const retryVideo = (id: string) =>
  request<Video>(`/api/videos/${id}/retry`, { method: "POST" });

export const mediaUrl = (id: string) => `${API_BASE}/api/videos/${id}/media`;
export const captionsUrl = (id: string, format: "srt" | "vtt" | "txt") =>
  `${API_BASE}/api/videos/${id}/captions/${format}`;

/** Upload with progress reporting (fetch can't report upload progress). */
export function uploadVideo(
  file: File,
  language: string,
  onProgress: (fraction: number) => void,
): Promise<Video> {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    form.append("language", language);
    form.append("file", file);

    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${API_BASE}/api/videos`);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded / e.total);
    };
    xhr.onload = () => {
      let body: any = null;
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        /* ignore */
      }
      if (xhr.status >= 200 && xhr.status < 300) resolve(body as Video);
      else reject(new Error(body?.error ?? `Upload failed (${xhr.status})`));
    };
    xhr.onerror = () => reject(new Error("Network error — is the server running?"));
    xhr.send(form);
  });
}
