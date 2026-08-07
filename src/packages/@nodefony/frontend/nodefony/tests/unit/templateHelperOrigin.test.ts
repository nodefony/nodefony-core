/// <reference types="node" />
import path from "node:path";
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

  it("dérive l'origine du Host de la REQUÊTE — deux hôtes, deux origines", () => {
    // Le cœur du lot : une seule instance Vite sert le poste ET le conteneur.
    // La MÊME entrée, demandée par deux noms, annonce deux origines.
    const helper = new TemplateHelper(
      supervisorWith({ origin: "https://127.0.0.1:5173" }),
      "development",
    );
    const fromPoste = helper.renderTags("studio", undefined, "127.0.0.1");
    const fromContainer = helper.renderTags(
      "studio",
      undefined,
      "host.docker.internal",
    );
    expect(fromPoste).to.include('src="https://127.0.0.1:5173/@vite/client"');
    expect(fromContainer).to.include(
      'src="https://host.docker.internal:5173/@vite/client"',
    );
    // Aucune trace de l'hôte de démarrage dans la page servie au conteneur :
    // c'est CE reliquat qui a cassé Studio (un `<script>` sur un nom que seul
    // l'autre monde résout, sans la moindre erreur côté serveur).
    expect(fromContainer).to.not.include("127.0.0.1");
  });

  it("dérive dans TOUS les tags, pas seulement le premier", () => {
    // Un seul tag laissé sur l'ancienne origine suffit à casser la page :
    // le preamble React, le pont HMR et la debug bar importent AUSSI depuis
    // Vite. On compte les origines émises plutôt que d'en vérifier une.
    const helper = new TemplateHelper(
      supervisorWith({ origin: "https://127.0.0.1:5173" }),
      "development",
    );
    const tags = helper.renderTags("studio", "N0NCE", "host.docker.internal");
    const origins = new Set(
      [...tags.matchAll(/https?:\/\/[A-Za-z0-9._-]+:\d+/g)].map((m) => m[0]),
    );
    expect([...origins]).to.deep.equal(["https://host.docker.internal:5173"]);
    // Le preamble React est bien présent (sinon le compte ci-dessus serait
    // trivialement vrai sur une page vide de scripts).
    expect(tags).to.include("__vite_plugin_react_preamble_installed__");
    expect(tags).to.include('nonce="N0NCE"');
  });

  it("le scheme et le port restent ceux de VITE, jamais ceux de la page", () => {
    // Une page servie en clair (http://…:5151) charge légitimement ses assets
    // en https://…:5173 si Vite est en TLS. Déduire le scheme de la page
    // produirait un `http://…` que le serveur TLS ne sert pas.
    const helper = new TemplateHelper(
      supervisorWith({ origin: "https://127.0.0.1:5173" }),
      "development",
    );
    const tags = helper.renderTags("studio", undefined, "host.docker.internal");
    expect(tags).to.include("https://host.docker.internal:5173/");
    expect(tags).to.not.include("http://host.docker.internal");
    // Et l'inverse : un Vite en clair reste en clair.
    const plain = new TemplateHelper(
      supervisorWith({ origin: "http://127.0.0.1:5173", https: false }),
      "development",
    );
    expect(plain.renderTags("studio", undefined, "poste.local")).to.include(
      'src="http://poste.local:5173/@vite/client"',
    );
  });

  it("un Host inexploitable laisse l'origine du superviseur (jamais d'URL bancale)", () => {
    const helper = new TemplateHelper(
      supervisorWith({ origin: "https://127.0.0.1:5173" }),
      "development",
    );
    for (const forged of ["evil.com/x", "evil.com:1", "a@b", "a b", ""]) {
      const tags = helper.renderTags("studio", undefined, forged);
      expect(tags, forged).to.include(
        'src="https://127.0.0.1:5173/@vite/client"',
      );
      expect(tags, forged).to.not.include("evil.com");
    }
  });

  it("PROD : le Host est ignoré — les URLs du manifest sont relatives", () => {
    // Non-régression du mode statique : la prod ne dépend d'aucune origine
    // absolue, elle suit déjà l'hôte de la page. Rien ne doit y changer.
    const prod = new TemplateHelper(null, "production", [entry]);
    const withHost = prod.renderTags("studio", undefined, "autre.example.com");
    const without = prod.renderTags("studio");
    expect(withHost).to.equal(without);
    expect(withHost).to.not.include("autre.example.com");
  });

  it("l'entry est servie via /@fs sur la MÊME origine publique", () => {
    const helper = new TemplateHelper(
      supervisorWith({ origin: "https://host.docker.internal:5173" }),
      "development",
    );
    const tags = helper.renderTags("studio");
    // Axiome portabilité n°10 : l'attendu se COMPOSE, ne se littéralise pas —
    // `path.resolve("/abs/…")` rend `/abs/…` sur Unix mais `D:\abs\…` sur
    // Windows (lecteur du cwd ajouté), et l'URL émise devient `/@fs/D:/abs/…`.
    const abs = path.resolve(entry.root, entry.entryFile).replace(/\\/g, "/");
    expect(tags).to.include(
      `https://host.docker.internal:5173/@fs${abs.startsWith("/") ? "" : "/"}${abs}`,
    );
    // Quelle que soit la plateforme, aucune URL émise ne porte de backslash.
    expect(tags).to.not.include("\\");
  });
});
