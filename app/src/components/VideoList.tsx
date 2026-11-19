import type { Video } from "../api";
import { formatBytes, isWorking, statusText } from "../format";

interface Props {
  videos: Video[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

export default function VideoList({ videos, selectedId, onSelect }: Props) {
  return (
    <div className="card list">
      <h2>Your videos</h2>
      {videos.length === 0 ? (
        <p className="muted">No uploads yet.</p>
      ) : (
        <ul>
          {videos.map((v) => (
            <li key={v.id}>
              <button
                className={`list-item ${v.id === selectedId ? "active" : ""}`}
                onClick={() => onSelect(v.id)}
              >
                <span className="truncate name">{v.filename}</span>
                <span className="meta">
                  <span className={`chip ${v.status}`}>
                    {isWorking(v.status) && <span className="spinner" />}
                    {statusText(v.status, v.progress)}
                  </span>
                  <span className="muted">{formatBytes(v.size_bytes)}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
