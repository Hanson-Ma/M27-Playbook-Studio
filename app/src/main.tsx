import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles/base.css";
import { App } from "./App";
import { StorageGate } from "./storage/StorageGate";

// StorageGate decides where files live (local server, or a folder the user opens when the app is hosted) and only
// renders the app once that backend is ready, so App's boot (workspace + library load) always has one.
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <StorageGate>
      <App />
    </StorageGate>
  </StrictMode>,
);
