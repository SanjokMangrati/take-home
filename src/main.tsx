import "@fontsource/barlow/latin-400.css";
import "@fontsource/barlow/latin-500.css";
import "@fontsource/barlow/latin-600.css";
import "@fontsource/barlow-semi-condensed/latin-600.css";
import "@fontsource/ibm-plex-mono/latin-400.css";
import "./styles/index.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./ui/App.tsx";
import { serverApi } from "./ui/api.ts";

const root = document.getElementById("root");
if (root === null) {
  throw new Error("The page has no #root element.");
}

createRoot(root).render(
  <StrictMode>
    <App api={serverApi} />
  </StrictMode>,
);
