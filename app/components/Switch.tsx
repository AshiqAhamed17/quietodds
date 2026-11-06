"use client";

/// A labelled on/off row: title, one line of detail, and a switch on the right.
export function Switch(p: { checked: boolean; disabled?: boolean; onChange: (on: boolean) => void; title: string; detail?: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={p.checked}
      disabled={p.disabled}
      className={`switch-row ${p.checked ? "on" : ""}`}
      onClick={() => p.onChange(!p.checked)}
    >
      <span className="switch-text">
        <span className="switch-title">{p.title}</span>
        {p.detail && <span className="switch-detail">{p.detail}</span>}
      </span>
      <span className="switch-track" aria-hidden>
        <span className="switch-thumb" />
      </span>
    </button>
  );
}
