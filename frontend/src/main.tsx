import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { registerSW } from "virtual:pwa-register";

import { App } from "./App.tsx";
import { TestCopyBanner } from "./components/TestCopyBanner.tsx";
import "./styles.css";

// Installs the service worker; with `autoUpdate` a new version is picked up on the next open.
registerSW({ immediate: true });

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <TestCopyBanner />
    <App />
  </StrictMode>,
);
