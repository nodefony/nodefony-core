/// <reference types="node" />
import path from "node:path";
import { expect } from "vitest";
import TemplateHelper from "../../src/template/TemplateHelper.js";
import type {
  IViteSupervisor,
  IViteSupervisorStatus,
} from "../../interfaces/IViteSupervisor.js";
import type { IResolvedFrontendEntry } from "../../interfaces/IFrontBuilder.js";

/**
 * Les `<script>` injectés ne portent AUCUNE origine — ni en production (le
 * manifest rend des chemins relatifs) ni en développement (#528 : Vite est
 * relayé sur l'origine de la page). Le bug qui a fondé ce banc (vécu,
 * navigateur en conteneur) : la page annonçait `https://127.0.0.1:5173/…`, le
 * loopback du NAVIGATEUR, où aucun Vite ne tourne. Une URL relative ne peut
 * plus viser la mauvaise machine.
 */

const entry: IResolvedFrontendEntry = {
  moduleName: "studio",
  entryName: "studio",
  type: "react19",
  root: "/abs/studio/frontend",
  entryFile: "src/main.tsx",
  outDir: "/abs/studio/public/dist",
  publicPath: "/_assets/studio/",
};

function supervisorWith(
  status: Partial<IViteSupervisorStatus>,
): IViteSupervisor {
  const full: IViteSupervisorStatus = {
    state: "ready",
    host: "127.0.0.1",
    origin: null,
    port: 5173,
    pid: 42,
    lastError: null,
    entries: [entry],
    https: true,
    portRetries: 0,
    restartCount: 0,
    healthFailures: 0,
    ...status,
  };
  return {
    start: () => Promise.resolve(),
    stop: () => Promise.resolve(),
    status: () => full,
  };
}

describe("TemplateHelper — aucune origine dans les balises", () => {
  it("PROD : le Host est ignoré — les URLs du manifest sont relatives", () => {
    // Non-régression du mode statique : la prod ne dépend d'aucune origine
    // absolue, elle suit déjà l'hôte de la page. Rien ne doit y changer.
    const prod = new TemplateHelper(null, "production", [entry]);
    const withHost = prod.renderTags("studio", undefined, "autre.example.com");
    const without = prod.renderTags("studio");
    expect(withHost).to.equal(without);
    expect(withHost).to.not.include("autre.example.com");
  });

  it("DEV : l'entry est servie via /@fs, relative à la page, quelle que soit l'origine de Vite", () => {
    const helper = new TemplateHelper(
      supervisorWith({ origin: "http://127.0.0.1:5173" }),
      "development",
    );
    const tags = helper.renderTags("studio");
    // Axiome portabilité n°10 : l'attendu se COMPOSE, ne se littéralise pas —
    // `path.resolve("/abs/…")` rend `/abs/…` sur Unix mais `D:\abs\…` sur
    // Windows (lecteur du cwd ajouté), et l'URL émise devient `/@fs/D:/abs/…`.
    const abs = path.resolve(entry.root, entry.entryFile).replace(/\\/g, "/");
    expect(tags).to.include(
      `src="/@fs${abs.startsWith("/") ? "" : "/"}${abs}"`,
    );
    expect(tags).to.not.include("127.0.0.1");
    // Quelle que soit la plateforme, aucune URL émise ne porte de backslash.
    expect(tags).to.not.include("\\");
  });
});
