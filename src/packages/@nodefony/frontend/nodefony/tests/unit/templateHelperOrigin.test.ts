/// <reference types="node" />
import path from "node:path";
import { expect } from "vitest";
import { RequestContext } from "nodefony";
import TemplateHelper, {
  devEntryUrl,
} from "../../src/template/TemplateHelper.js";
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
  it("DEV : l'entry est relative à la page, quelle que soit l'origine de Vite", () => {
    const helper = new TemplateHelper(
      supervisorWith({
        origin: "http://127.0.0.1:5173",
        base: "/_vite/default/",
      }),
      "development",
    );
    const tags = helper.renderTags("studio");
    expect(tags).to.include('src="/_vite/default/src/main.tsx"');
    expect(tags).to.not.include("127.0.0.1");
    // Quelle que soit la plateforme, aucune URL émise ne porte de backslash.
    expect(tags).to.not.include("\\");
  });
});

describe("TemplateHelper — une entrée a la MÊME URL que celle que Vite donne à ses imports", () => {
  // Vite sert un fichier sous sa racine en `/src/…` et hors de sa racine en
  // `/@fs/…`. Une entrée posée en `/@fs` alors qu'elle est sous la racine
  // existait sous deux URL : un module qui l'importait en recevait une seconde
  // instance (vécu sur une application Svelte réelle, #890).
  const second: IResolvedFrontendEntry = {
    ...entry,
    moduleName: "billing",
    entryName: "billing",
    root: "/abs/billing/frontend",
  };

  it("🔴 entrée SOUS la racine Vite (la première de la famille) → relative, jamais /@fs", () => {
    const helper = new TemplateHelper(
      supervisorWith({ base: "/_vite/default/", entries: [entry, second] }),
      "development",
    );
    const tags = helper.renderTags("studio");
    expect(tags).to.include('src="/_vite/default/src/main.tsx"');
    expect(tags).to.not.include("/@fs/abs/studio");
  });

  it("entrée HORS de la racine (second front de la famille) → /@fs, qui la distingue du premier", () => {
    const helper = new TemplateHelper(
      supervisorWith({ base: "/_vite/default/", entries: [entry, second] }),
      "development",
    );
    const tags = helper.renderTags("billing");
    // Axiome portabilité n°10 : l'attendu se COMPOSE — `path.resolve("/abs/…")`
    // rend `D:\abs\…` sous Windows, et l'URL émise devient `/@fs/D:/abs/…`.
    const abs = path.resolve(second.root, second.entryFile).replace(/\\/g, "/");
    expect(tags).to.include(
      `src="/_vite/default/@fs${abs.startsWith("/") ? "" : "/"}${abs}"`,
    );
  });

  it("grammaire win32 : relative sous la racine, /@fs/C:/… hors d'elle, aucun backslash", () => {
    const winRoot = "C:\\app\\frontend";
    expect(
      devEntryUrl(
        "/_vite/default",
        winRoot,
        { root: winRoot, entryFile: "src\\main.ts" },
        path.win32,
      ),
    ).to.equal("/_vite/default/src/main.ts");
    expect(
      devEntryUrl(
        "/_vite/default",
        winRoot,
        {
          root: "C:\\app\\modules\\billing\\frontend",
          entryFile: "src/main.ts",
        },
        path.win32,
      ),
    ).to.equal(
      "/_vite/default/@fs/C:/app/modules/billing/frontend/src/main.ts",
    );
  });

  it("un dossier VOISIN au même préfixe n'est pas « sous » la racine", () => {
    // `/abs/front` n'est pas la racine de `/abs/frontend-admin/…`.
    expect(
      devEntryUrl(
        "/_vite/default",
        "/abs/front",
        { root: "/abs/frontend-admin", entryFile: "src/main.ts" },
        path.posix,
      ),
    ).to.equal("/_vite/default/@fs/abs/frontend-admin/src/main.ts");
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

describe("TemplateHelper — le nonce CSP s'annonce aux styles créés à l'exécution (ADR-0024 §C2)", () => {
  // Le client de Vite lit `<meta property="csp-nonce">` pour signer les
  // `<style>` du rechargement à chaud ; sans elle, `style-src 'nonce-…'` les
  // bloque et la page s'affiche sans ses styles.
  it("🔴 la balise meta précède le client Vite et porte le nonce de la requête", () => {
    const helper = new TemplateHelper(supervisorWith({}), "development");
    const tags = helper.renderTags("studio", "n0nce");
    const meta = tags.indexOf('<meta property="csp-nonce" nonce="n0nce">');
    expect(meta).to.equal(0);
    expect(meta).to.be.lessThan(tags.indexOf("/@vite/client"));
  });

  it("sans nonce (sécurité coupée) : aucune balise", () => {
    const helper = new TemplateHelper(supervisorWith({}), "development");
    expect(helper.renderTags("studio")).not.to.include("csp-nonce");
  });
});
