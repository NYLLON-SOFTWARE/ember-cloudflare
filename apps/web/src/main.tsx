import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { listenForInstallPrompt } from "./lib/install-prompt";
import "./index.css";

listenForInstallPrompt();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
