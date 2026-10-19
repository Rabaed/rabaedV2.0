import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ImportsApp } from "./imports-app.tsx";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ImportsApp />
  </StrictMode>,
);
