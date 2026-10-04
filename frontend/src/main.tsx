import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { watchProviderToken } from "./lib/google";
import { watchSystemTheme } from "./lib/theme";
import "./index.css";

watchProviderToken();
watchSystemTheme();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
