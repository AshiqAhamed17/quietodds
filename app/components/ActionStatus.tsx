"use client";

import { useCallback, useState } from "react";
import { explorerTx } from "@/lib/contract";
import { STEP_LABEL, type Step } from "@/lib/private";

export interface ActionState {
  busy: boolean;
  step?: Step;
  error?: string;
  tx?: string;
  summary?: string;
}

/// Runs one private action and tracks its steps for <ActionStatus>.
export function useAction() {
  const [state, setState] = useState<ActionState>({ busy: false });
  const run = useCallback(async (fn: (onStep: (s: Step) => void) => Promise<{ txHash?: string; summary?: string } | void>) => {
    setState({ busy: true, step: "sync" });
    try {
      const r = (await fn((step) => setState((s) => ({ ...s, step })))) || {};
      setState({ busy: false, step: "done", tx: r.txHash, summary: r.summary });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setState({ busy: false, error: msg.length > 300 ? msg.slice(0, 300) + "…" : msg });
    }
  }, []);
  const reset = useCallback(() => setState({ busy: false }), []);
  return { state, run, reset };
}

const ORDER: Step[] = ["sync", "prove", "relay", "done"];

/// `steps` overrides which steps show and their labels (e.g. a public deposit has no proof).
export function ActionStatus({ state, steps }: { state: ActionState; steps?: Partial<Record<Step, string>> }) {
  if (!state.busy && !state.step && !state.error) return null;
  const at = state.step ? ORDER.indexOf(state.step) : -1;
  return (
    <div className={`action-status ${state.error ? "err" : ""}`} aria-live="polite">
      {!state.error && (
        <ol>
          {ORDER.slice(0, 3).map((s, i) =>
            steps && !(s in steps) ? null : (
              <li key={s} className={i < at || state.step === "done" ? "ok" : i === at ? "now" : ""}>
                {steps?.[s] ?? STEP_LABEL[s]}
              </li>
            ),
          )}
        </ol>
      )}
      {state.error && <p className="mono">{state.error}</p>}
      {state.step === "done" && (
        <p className="mono">
          {state.summary ?? "Done."}{" "}
          {state.tx && (
            <a href={explorerTx(state.tx)} target="_blank" rel="noreferrer">
              View tx ↗
            </a>
          )}
        </p>
      )}
    </div>
  );
}
