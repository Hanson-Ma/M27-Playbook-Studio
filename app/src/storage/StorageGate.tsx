// Decides where files live before the app boots (src/storage/storage.ts) and renders the app once a backend is
// ready. Local server (`npm run dev` / `npm start`): straight through. Hosted as a static site: a Madden-styled
// start screen asks for the "2026 Playbook" folder (or offers to reconnect to the one opened last time).
import { useEffect, useState, type ReactNode } from "react";
import { Button, Icon } from "../ui";
import { openFolder, reconnectFolder, retryServer, startStorage, useStorageState, type StoragePhase } from "./storage";
import s from "./StorageGate.module.css";

export function StorageGate({ children }: { children: ReactNode }) {
  const state = useStorageState((st) => st.state);
  useEffect(() => {
    void startStorage();
  }, []);
  if (state.phase === "ready") return <>{children}</>;
  return <StartScreen state={state} />;
}

function StartScreen({ state }: { state: Exclude<StoragePhase, { phase: "ready" }> }) {
  // Probing the local server takes a few ms: only show the splash if it takes noticeably longer.
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (state.phase !== "detecting") return;
    const t = window.setTimeout(() => setSlow(true), 400);
    return () => window.clearTimeout(t);
  }, [state.phase]);

  return (
    <div className={s.screen}>
      <div className={s.stadium} aria-hidden />
      {state.phase === "detecting" ? (
        slow && (
          <div className={s.center}>
            <Brand />
            <p className={s.status}>Starting…</p>
          </div>
        )
      ) : (
        <div className={s.center}>
          <Brand />
          {state.phase === "folder" && <FolderCard state={state} />}
          {state.phase === "unsupported" && <UnsupportedCard reason={state.reason} />}
          {state.phase === "server-down" && <ServerDownCard error={state.error} />}
        </div>
      )}
    </div>
  );
}

function Brand() {
  return (
    <>
      <div className={s.eyebrow}>Madden NFL 27</div>
      <h1 className={s.wordmark}>
        Playbook <span>Studio</span>
      </h1>
    </>
  );
}

function FolderCard({ state }: { state: Extract<StoragePhase, { phase: "folder" }> }) {
  const { remembered, busy, problem, hint } = state;
  return (
    <section className={s.card} aria-labelledby="storage-title">
      <h2 id="storage-title" className={s.title}>
        {remembered ? "Welcome back" : "Open your 2026 Playbook folder"}
      </h2>
      <p className={s.lead}>
        Playbook Studio works on the files in your <b>2026 Playbook</b> folder — the one with <code>data</code>, <code>playbooks</code> and{" "}
        <code>tools</code> inside. Your playbooks and the game library stay on this computer: nothing is uploaded. This page reads the folder
        you pick and saves your changes straight back into it.
      </p>

      <div className={s.actions}>
        {remembered ? (
          <>
            <Button variant="primary" size="lg" icon="folder" loading={busy} onClick={() => void reconnectFolder()}>
              Reconnect to “{remembered}”
            </Button>
            <Button variant="secondary" size="lg" disabled={busy} onClick={() => void openFolder()}>
              Open a different folder…
            </Button>
          </>
        ) : (
          <Button variant="primary" size="lg" icon="folder" loading={busy} onClick={() => void openFolder()}>
            Open folder…
          </Button>
        )}
      </div>

      {problem && (
        <div className={s.problem} role="alert">
          <Icon name="warning" size={16} />
          <div>
            <div>{problem}</div>
            {hint && <div className={s.hint}>{hint}</div>}
          </div>
        </div>
      )}

      <ol className={s.steps}>
        <li>
          {remembered ? (
            <>
              Click <b>Reconnect</b> — the browser asks once per visit whether this site may keep editing the folder.
            </>
          ) : (
            <>
              Click <b>Open folder…</b> and pick <b>2026 Playbook</b> (not a folder inside it).
            </>
          )}
        </li>
        <li>
          When the browser asks, allow it to <b>view</b> and <b>edit</b> the files. Choose <b>Allow on every visit</b> if it offers that, and
          the app opens straight away next time.
        </li>
        <li>
          On the Madden PC, export as always: <code>tools\export.ps1 -Install</code> from the same folder.
        </li>
      </ol>

      <details className={s.more}>
        <summary>How does this work?</summary>
        <p>
          This website is only the app. When you open a folder, Chrome or Edge lets this page read and write the files inside it — nothing
          else on your computer, and nothing leaves it. Saves land in <code>playbooks/</code> and <code>app-data/</code> exactly like when the
          app runs from <code>npm run dev</code>; deleted files go to <code>app-data/.trash/</code>.
        </p>
        <p>
          Use the same folder on your Mac and the Madden PC by syncing it with git (push / pull) or a synced folder. See{" "}
          <code>app/docs/HOSTING.md</code> for the full walkthrough.
        </p>
      </details>
    </section>
  );
}

function UnsupportedCard({ reason }: { reason: "insecure" | "no-api" }) {
  return (
    <section className={s.card} aria-labelledby="storage-title">
      <h2 id="storage-title" className={s.titleWarn}>
        <Icon name="warning" size={20} /> {reason === "insecure" ? "Open this page over https" : "Use Chrome or Edge"}
      </h2>
      {reason === "insecure" ? (
        <p className={s.lead}>
          Browsers only let secure pages open folders on your computer. This page was opened over plain <code>http://</code> — use the{" "}
          <code>https://</code> address of the site instead.
        </p>
      ) : (
        <p className={s.lead}>
          Playbook Studio saves straight into your <b>2026 Playbook</b> folder, which needs <b>Google Chrome</b> or <b>Microsoft Edge</b> on a
          Mac or PC. Safari, Firefox and phones can't open folders from a web page. Open this address in Chrome or Edge.
        </p>
      )}
      <p className={s.note}>
        On the computer that has the repo you can also run the app locally (<code>cd app</code>, <code>npm run dev</code>) — that works in any
        browser.
      </p>
    </section>
  );
}

function ServerDownCard({ error }: { error: string }) {
  const [busy, setBusy] = useState(false);
  const retry = async () => {
    setBusy(true);
    try {
      await retryServer();
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className={s.card} aria-labelledby="storage-title">
      <h2 id="storage-title" className={s.titleWarn}>
        <Icon name="warning" size={20} /> Can't reach the local server
      </h2>
      <p className={s.lead}>{error}</p>
      <p className={s.note}>
        Start it with <code>npm run dev</code> in <code>app/</code>, or remove <code>?storage=server</code> from the address to open a folder instead.
      </p>
      <div className={s.actions}>
        <Button variant="primary" size="lg" icon="refresh" loading={busy} onClick={() => void retry()}>
          Try again
        </Button>
      </div>
    </section>
  );
}
