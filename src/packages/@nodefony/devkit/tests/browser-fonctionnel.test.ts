import { describe, it, expect, beforeAll } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { request as httpsRequest } from "node:https";
import { commeObjet } from "./browser-outils";

/**
 * Ce que ces tests prouvent : les sondes navigateur, EXÉCUTÉES pour de vrai
 * (conteneur + serveur), mesurent ce qu'elles annoncent — familles, socket de
 * bout en bout, et la reprise sur un état d'authentification invalide, le bug
 * historique de `lib/browser.mjs`.
 *
 * Le décor est PARAMÉTRÉ (`NF_BROWSER_TEST_*`) pour viser aussi bien ce dépôt
 * qu'une application générée ; les défauts sont ceux de ce dépôt. Quand le
 * décor manque, la suite SAUTE en le DISANT — jamais un vert silencieux sur un
 * banc qui n'a rien exercé.
 */
const BASE_HOTE = process.env.NF_BROWSER_TEST_BASE ?? "https://127.0.0.1:5152";
const BASE_CONTENEUR =
  process.env.NF_BROWSER_TEST_BASE_CONTENEUR ??
  "https://host.docker.internal:5152";
const CONTENEUR = process.env.NF_BROWSER_TEST_CONTAINER ?? "nodefony-browser";
const LOGIN = process.env.NF_BROWSER_TEST_LOGIN ?? "/nodefony/login";
const USER = process.env.NF_BROWSER_TEST_USER ?? "admin";
const PASSWORD = process.env.NF_BROWSER_TEST_PASSWORD ?? "secret";
const PAGE_PROTEGEE =
  process.env.NF_BROWSER_TEST_PAGE ?? "/nodefony/supervision";
const TEXTE_ATTENDU =
  process.env.NF_BROWSER_TEST_EXPECT ?? "Santé du framework";
const PAGE_PUBLIQUE = process.env.NF_BROWSER_TEST_PAGE_PUBLIQUE ?? LOGIN;
const SOCKET =
  process.env.NF_BROWSER_TEST_SOCKET ?? "/nodefony/studio/api/realtime";
const PAGE_SOCKET = process.env.NF_BROWSER_TEST_PAGE_SOCKET ?? "/nodefony";
const CANAL = process.env.NF_BROWSER_TEST_CHANNEL ?? "nodefony:supervision";
const CHEMIN_API =
  process.env.NF_BROWSER_TEST_API ?? "/nodefony/kernel/api/info";

/** Identifiants passés aux sondes qui ouvrent une page protégée. */
const ENV_AUTH: Record<string, string> = {
  NF_BROWSER_LOGIN: LOGIN,
  NF_BROWSER_USER: USER,
  NF_BROWSER_PASSWORD: PASSWORD,
};

/** Le conteneur navigateur tourne-t-il — null si oui, la raison sinon. */
function conteneurAbsent(): string | null {
  try {
    const sortie = execFileSync(
      "docker",
      ["ps", "--filter", `name=${CONTENEUR}`, "--format", "{{.Names}}"],
      { encoding: "utf8", timeout: 10000 },
    );
    return sortie.split("\n").includes(CONTENEUR)
      ? null
      : `conteneur « ${CONTENEUR} » absent — docker compose --profile browser up -d`;
  } catch (e) {
    return `docker indisponible : ${String(e).slice(0, 120)}`;
  }
}

/** Le serveur répond-il depuis l'hôte — null si oui, la raison sinon. */
function serveurMuet(): Promise<string | null> {
  return new Promise((resoudre) => {
    const req = httpsRequest(
      BASE_HOTE,
      { method: "GET", rejectUnauthorized: false, timeout: 4000 },
      (res) => {
        res.resume();
        resoudre(null);
      },
    );
    req.on("error", (e) =>
      resoudre(`serveur ${BASE_HOTE} injoignable : ${e.message}`),
    );
    req.on("timeout", () => {
      req.destroy();
      resoudre(`serveur ${BASE_HOTE} muet (timeout)`);
    });
    req.end();
  });
}

const raisons = [conteneurAbsent(), await serveurMuet()].filter(
  (r): r is string => r !== null,
);
if (raisons.length > 0) {
  // Le SKIP se justifie à voix haute : un banc sauté sans message devient un
  // vert qu'on croit, et le décor manquant ne se répare jamais. Écriture
  // BRUTE sur stderr — le runner avale la console des fichiers sautés.
  process.stderr.write(
    `\n[browser-fonctionnel] SUITE SAUTÉE — le décor manque :\n  - ${raisons.join("\n  - ")}\n\n`,
  );
}

interface IResultatSonde {
  code: number;
  stdout: string;
  stderr: string;
}

/** Lance une sonde dans le conteneur et rend code + sorties, sans jamais lever. */
function lancerSonde(
  script: string,
  args: string[],
  env: Record<string, string>,
): IResultatSonde {
  const drapeaux: string[] = [];
  for (const [cle, valeur] of Object.entries({
    NF_BROWSER_BASE: BASE_CONTENEUR,
    ...env,
  })) {
    drapeaux.push("-e", `${cle}=${valeur}`);
  }
  const res = spawnSync(
    "docker",
    [
      "exec",
      ...drapeaux,
      CONTENEUR,
      "node",
      `/app/see-screen/${script}`,
      ...args,
    ],
    { encoding: "utf8", timeout: 150000, maxBuffer: 16 * 1024 * 1024 },
  );
  return {
    code: res.status ?? -1,
    stdout: res.stdout ?? "",
    stderr: res.stderr ?? "",
  };
}

/** Parse la sortie JSON d'une sonde — l'échec cite la sortie réelle. */
function sortieJson(r: IResultatSonde): Record<string, unknown> {
  try {
    return commeObjet(JSON.parse(r.stdout), "sortie de sonde");
  } catch {
    throw new Error(
      `sortie non-JSON (code ${r.code})\nstdout: ${r.stdout.slice(0, 400)}\nstderr: ${r.stderr.slice(0, 400)}`,
    );
  }
}

/** Dépose un état d'authentification ARBITRAIRE dans le volume du conteneur. */
function poserEtat(contenu: string): void {
  const dossier = mkdtempSync(path.join(tmpdir(), "nf-browser-test-"));
  const fichier = path.join(dossier, ".auth-state.json");
  writeFileSync(fichier, contenu);
  execFileSync(
    "docker",
    ["cp", fichier, `${CONTENEUR}:/output/.auth-state.json`],
    { timeout: 20000 },
  );
}

describe.skipIf(raisons.length > 0)("sondes navigateur — fonctionnel", () => {
  beforeAll(() => {
    // Copie idempotente des sondes du DÉPÔT vers le conteneur — le `/.` copie
    // le CONTENU : sans lui, une seconde copie imbrique un dossier et l'on
    // exécute une version périmée sans aucun message.
    const scripts = path.join(
      import.meta.dirname,
      "..",
      "skills",
      "nodefony-browser",
      "scripts",
    );
    execFileSync(
      "docker",
      ["cp", `${scripts}${path.sep}.`, `${CONTENEUR}:/app/see-screen`],
      { timeout: 30000 },
    );
  });

  it("inspect.mjs — le socle sur une page publique", () => {
    const r = lancerSonde("inspect.mjs", [PAGE_PUBLIQUE], {});
    expect(r.code, r.stderr).toBe(0);
    const d = sortieJson(r);
    expect(String(d["url"])).toContain(BASE_CONTENEUR);
    expect(Array.isArray(d["sondes"])).toBe(true);
    expect(String(d["capture"])).toMatch(/\.png$/u);
    expect(typeof d["theme"]).toBe("string");
    expect(Array.isArray(d["erreursNonCapturees"])).toBe(true);
  }, 180000);

  it("inspect.mjs — toutes les familles sur la page protégée", () => {
    const r = lancerSonde("inspect.mjs", [PAGE_PROTEGEE, TEXTE_ATTENDU], {
      ...ENV_AUTH,
      NF_BROWSER_FAMILIES: "toutes",
    });
    expect(r.code, r.stderr).toBe(0);
    const d = sortieJson(r);
    // Chaque famille a rendu sa section ET son verdict — une famille absente
    // serait un vert qui n'a rien mesuré.
    for (const famille of [
      "a11y",
      "rendu",
      "reseau",
      "perf",
      "stockage",
      "responsive",
    ]) {
      const section = commeObjet(d[famille], famille);
      expect(typeof section["verdict"], famille).toBe("string");
    }
    const reseau = commeObjet(d["reseau"], "reseau");
    expect(Number(reseau["total"])).toBeGreaterThan(0);
    const stockage = commeObjet(d["stockage"], "stockage");
    expect(Array.isArray(stockage["cookies"])).toBe(true);
    const responsive = commeObjet(d["responsive"], "responsive");
    expect(Array.isArray(responsive["parLargeur"])).toBe(true);
    const a11y = commeObjet(d["a11y"], "a11y");
    expect(commeObjet(a11y["arbre"], "arbre")["lignes"]).toBeDefined();
    expect(["OK", "ALERTE"]).toContain(String(d["verdict"]));
  }, 180000);

  it("sens négatif — une famille inconnue est refusée (64), avec la liste", () => {
    const r = lancerSonde("inspect.mjs", ["/"], {
      NF_BROWSER_FAMILIES: "inexistante",
    });
    expect(r.code).toBe(64);
    expect(r.stderr).toContain("inexistante");
    expect(r.stderr).toContain("a11y");
  }, 60000);

  it("sens négatif — un texte attendu introuvable rend 65, avec la page réelle", () => {
    const r = lancerSonde(
      "inspect.mjs",
      [PAGE_PUBLIQUE, "TEXTE-IMPOSSIBLE-9f4e2a"],
      {},
    );
    expect(r.code).toBe(65);
    expect(r.stderr).toContain("jamais apparu");
    expect(r.stderr).toContain(BASE_CONTENEUR);
  }, 180000);

  it("reprise sur un état d'authentification FORGÉ — le bug historique", () => {
    // L'état le plus vicieux, vécu : un cookie de session INVALIDE plus un
    // stockage local où l'application a mémorisé l'identifiant (le formulaire
    // saute alors l'étape 1). Avant correction : la sonde restait sur l'écran
    // de connexion et rendait 65 en accusant les identifiants.
    const hote = new URL(BASE_CONTENEUR).hostname;
    poserEtat(
      JSON.stringify({
        cookies: [
          {
            name: "nf-session-forgee",
            value: "invalide-0000",
            domain: hote,
            path: "/",
            expires: -1,
            httpOnly: true,
            secure: true,
            sameSite: "Lax",
          },
        ],
        origins: [
          {
            origin: BASE_CONTENEUR,
            localStorage: [
              { name: "nf.studio.lastMethod", value: "password" },
              { name: "nf.studio.lastUser", value: USER },
            ],
          },
        ],
      }),
    );
    const r = lancerSonde(
      "inspect.mjs",
      [PAGE_PROTEGEE, TEXTE_ATTENDU],
      ENV_AUTH,
    );
    expect(r.code, r.stderr).toBe(0);
    const d = sortieJson(r);
    expect(String(d["url"])).toContain(PAGE_PROTEGEE);
  }, 180000);

  it("reprise sur un état d'authentification CORROMPU (JSON illisible)", () => {
    poserEtat("ceci nest pas du JSON{{{");
    const r = lancerSonde(
      "inspect.mjs",
      [PAGE_PROTEGEE, TEXTE_ATTENDU],
      ENV_AUTH,
    );
    expect(r.code, r.stderr).toBe(0);
    // La reprise se DIT : l'état jeté sans un mot serait une autre panne muette.
    expect(r.stderr).toContain("illisible");
    expect(String(sortieJson(r)["url"])).toContain(PAGE_PROTEGEE);
  }, 180000);

  it("socket.mjs — le scénario complet : accueil, canal, latence, api, reconnexion", () => {
    const r = lancerSonde("socket.mjs", [SOCKET], {
      ...ENV_AUTH,
      NF_BROWSER_PAGE: PAGE_SOCKET,
      NF_BROWSER_CHANNEL: CANAL,
      NF_BROWSER_API: CHEMIN_API,
    });
    expect(r.code, r.stderr).toBe(0);
    const d = sortieJson(r);
    const accueil = commeObjet(d["accueil"], "accueil");
    expect(accueil["canaux"]).toContain(CANAL);
    const identite = commeObjet(accueil["identite"], "identite");
    expect(identite["authenticated"]).toBe(true);
    const abonnement = commeObjet(d["abonnement"], "abonnement");
    expect(abonnement["verdict"]).toBe("OK");
    expect(Number(abonnement["total"])).toBeGreaterThan(0);
    const latence = commeObjet(d["latence"], "latence");
    expect(latence["verdict"]).toBe("OK");
    expect(Number(latence["medianeMs"])).toBeGreaterThan(0);
    const api = commeObjet(d["api"], "api");
    expect(api["verdict"]).toBe("OK");
    const reconnexion = commeObjet(d["reconnexion"], "reconnexion");
    expect(reconnexion["verdict"]).toBe("OK");
    expect(reconnexion["memeIdentite"]).toBe(true);
  }, 180000);

  it("sens négatif — socket sans endpoint : refus 64, rien n'est deviné", () => {
    const r = lancerSonde("socket.mjs", [], {});
    expect(r.code).toBe(64);
    expect(r.stderr).toContain("NF_BROWSER_SOCKET");
  }, 60000);

  it("sens négatif — endpoint inexistant : accueil jamais reçu, 65 diagnostiqué", () => {
    const r = lancerSonde("socket.mjs", ["/route/inexistante-9f4e2a"], {
      NF_BROWSER_SOCKET_WAIT: "1000",
    });
    expect(r.code).toBe(65);
    expect(r.stderr).toContain("accueil jamais reçu");
  }, 120000);
});
