/// <reference types="node" />
import path from "node:path";
import { expect } from "vitest";
import { RequestContext } from "nodefony";
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

describe("TemplateHelper — la barre de débogage connaît la requête qui rend la page", () => {
  // La navigation du document n'est ni `fetch` ni XHR : sans son identifiant,
  // la barre ne peut ni la rattacher à ses lignes serveur ni en ouvrir le profil.
  it("🔴 rendu DANS une requête : son requestId part dans les options de montage", () => {
    const helper = new TemplateHelper(supervisorWith({}), "development");
    const tags = RequestContext.run({ requestId: "rid-de-la-page" }, () =>
      helper.renderTags("studio"),
    );
    expect(tags).to.include("mountDebugBar(");
    expect(tags).to.include('"page":{"requestId":"rid-de-la-page"}');
  });

  // Les modules s'exécutent dans l'ordre du document : montée après l'entrée,
  // la barre ne voyait ni la socket ni les premiers `fetch` de l'application.
  it("🔴 la barre s'exécute AVANT l'entrée de l'application, après le client Vite", () => {
    const helper = new TemplateHelper(supervisorWith({}), "development");
    const tags = helper.renderTags("studio");
    const bar = tags.indexOf("mountDebugBar(");
    expect(bar).to.be.greaterThan(tags.indexOf("/@vite/client"));
    expect(bar).to.be.lessThan(tags.indexOf("src/main.tsx"));
  });

  it("rendu hors de toute requête : aucune option page, rien d'inventé", () => {
    const helper = new TemplateHelper(supervisorWith({}), "development");
    const tags = helper.renderTags("studio");
    expect(tags).to.include("mountDebugBar(");
    expect(tags).to.not.include('"page"');
  });
});
