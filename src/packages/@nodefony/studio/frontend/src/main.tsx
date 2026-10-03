import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { NODEFONY_LOGO_URL } from "./components/NodefonyLogo";

// Favicon = le logo officiel, pris à la MÊME importation que le bandeau : un
// `index.html` ne peut pas importer le fichier du paquet, et y recopier l'image
// en data-URI en faisait une seconde source. Sans favicon, le navigateur
// demande `/favicon.ico` et journalise un 404 sur chaque page.
const icon = document.createElement("link");
icon.rel = "icon";
icon.type = "image/svg+xml";
icon.href = NODEFONY_LOGO_URL;
document.head.append(icon);

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("#root not found");
createRoot(rootEl).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
