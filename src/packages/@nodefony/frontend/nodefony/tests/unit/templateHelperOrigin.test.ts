/// <reference types="node" />
import { expect } from "chai";
import TemplateHelper from "../../src/template/TemplateHelper.js";
import type {
  IViteSupervisor,
  IViteSupervisorStatus,
} from "../../interfaces/IViteSupervisor.js";
import type { IResolvedFrontendEntry } from "../../interfaces/IFrontBuilder.js";

/**
 * P14.17 — les `<script>` injectés suivent l'origine PUBLIQUE du superviseur.
 *
 * Le bug d'origine (vécu, navigateur en conteneur) : la page annonçait ses
 * assets en `https://127.0.0.1:5173/...` — ce loopback est celui du NAVIGATEUR,
 * donc du conteneur, où aucun Vite ne tourne. L'origine du status est désormais
 * la SOURCE UNIQUE des URLs émises ; ce banc verrouille qu'elle est reprise
 * VERBATIM (port implicite d'un forwarder compris) et que le fallback
 * historique reste correct pour un status sans `origin`.
 */

const entry: IResolvedFrontendEntry = {
  moduleName: "studio",
  entryName: "studio",
  type: "react19",
  root: "/abs/studio/frontend",
  entryFile: "src/main.tsx",
  outDir: "/abs/studio/public/dist",
  publicPath: "/_assets/studio/",
  apiProxyPaths: [],
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

describe("TemplateHelper — origine publique des tags dev (P14.17)", () => {
  it("reprend l'origine du superviseur VERBATIM (conteneur Docker)", () => {
    const helper = new TemplateHelper(
      supervisorWith({ origin: "https://host.docker.internal:5173" }),
      "development",
    );
    const tags = helper.renderTags("studio");
    expect(tags).to.include(
      'src="https://host.docker.internal:5173/@vite/client"',
    );
    expect(tags).to.not.include("127.0.0.1");
  });

  it("origine SANS port (forwarder TLS Codespaces) : aucun port ajouté", () => {
    const helper = new TemplateHelper(
      supervisorWith({ origin: "https://mona-5173.app.github.dev" }),
      "development",
    );
    const tags = helper.renderTags("studio");
    expect(tags).to.include(
      'src="https://mona-5173.app.github.dev/@vite/client"',
    );
    // Le port d'ÉCOUTE (5173) ne doit pas fuiter dans une URL de forwarder.
    expect(tags).to.not.include("app.github.dev:5173");
  });

  it("status sans origin (double de test) : fallback scheme://host:port", () => {
    const helper = new TemplateHelper(
      supervisorWith({ origin: null }),
      "development",
    );
    const tags = helper.renderTags("studio");
    expect(tags).to.include('src="https://127.0.0.1:5173/@vite/client"');
  });

  it("l'entry est servie via /@fs sur la MÊME origine publique", () => {
    const helper = new TemplateHelper(
      supervisorWith({ origin: "https://host.docker.internal:5173" }),
      "development",
    );
    const tags = helper.renderTags("studio");
    expect(tags).to.include(
      "https://host.docker.internal:5173/@fs/abs/studio/frontend/src/main.tsx",
    );
  });
});
