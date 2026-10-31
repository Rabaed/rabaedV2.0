import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { StepsApp } from "./steps-app.tsx";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <StepsApp />
  </StrictMode>,
);
