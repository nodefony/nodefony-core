import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  BROWSER_PROBES,
  BROWSER_SCRIPTS_DIR,
  missingDependencies,
  pickMode,
  resolveBrowserScript,
  scriptArguments,
  seeUsageError,
} from "../cli/see";

/** Racine du dépôt, depuis ce fichier de test. */
const REPO = path.resolve(import.meta.dirname, "..", "..", "..", "..");
const DEVKIT = path.join(REPO, "src", "packages", "@nodefony", "devkit");
/** Un dossier qui n'existe pas : le décor de « rien n'est installé ». */
const VIDE = path.join(REPO, "aucun-projet-ici");

describe("commande see — lecture de la ligne de commande", () => {
  it("prend l'inspection par défaut", () => {
    expect(pickMode(["node", "nodefony", "see", "/"])).toBe("inspect");
  });

  it("reconnaît les deux autres modes", () => {
    expect(pickMode(["node", "nodefony", "see", "/", "--watch"])).toBe("watch");
    expect(pickMode(["node", "nodefony", "see", "/", "--audit"])).toBe("audit");
  });

  it("passe à la sonde ce qui suit, sans les drapeaux de mode", () => {
    expect(
      scriptArguments([
        "node",
        "nodefony",
        "see",
        "/tableau-de-bord",
        "Chiffre d'affaire",
        "--audit",
        "--install",
      ]),
    ).toEqual(["/tableau-de-bord", "Chiffre d'affaire"]);
  });

  it("ne rend rien quand la commande n'est pas là", () => {
    expect(scriptArguments(["node", "nodefony", "doctor"])).toEqual([]);
  });

  it("🔴 refuse une option inconnue au lieu de la passer pour une URL", () => {
    // Vécu : `see --nope` partait vers la sonde, le navigateur échouait sur
    // « invalid URL » — pile brute et code 1 au lieu de l'usage et de 64.
    expect(seeUsageError(["node", "nodefony", "see", "--nope"])).toBe(
      "option inconnue : --nope",
    );
  });

  it("refuse plus de deux positionnels — la page, puis le texte ou la durée", () => {
    expect(
      seeUsageError(["node", "nodefony", "see", "/", "Accueil", "x"]),
    ).toBe("trop d'arguments : x");
  });

  it("accepte ses modes, ses positionnels et les drapeaux globaux", () => {
    for (const argv of [
      ["node", "nodefony", "see"],
      ["node", "nodefony", "see", "/connexion", "Connexion"],
      ["node", "nodefony", "see", "--watch", "/", "8000"],
      ["node", "nodefony", "see", "--audit", "--install", "/", "-d"],
    ]) {
      expect(seeUsageError(argv), argv.join(" ")).toBeNull();
    }
  });
});

describe("commande see — contrat avec le paquet qui publie les sondes", () => {
  // Ce cas est la RAISON du test. Le cœur compose un chemin dans un AUTRE
  // paquet ; rien dans TypeScript ne le vérifie. Une réorganisation du devkit
  // ferait répondre « le navigateur piloté n'est pas installé » à une
  // application où il l'est — un message qui envoie chercher au mauvais endroit.
  it("chaque sonde attendue existe là où le cœur la cherche", () => {
    expect(BROWSER_PROBES.length).toBe(3);
    for (const probe of BROWSER_PROBES) {
      const file = path.join(DEVKIT, ...BROWSER_SCRIPTS_DIR, probe);
      expect(fs.existsSync(file), `sonde absente : ${file}`).toBe(true);
    }
  });

  it("les sondes sont dans ce que le paquet PUBLIE", () => {
    // Le chemin peut exister dans le dépôt et ne pas partir sur npm : c'est
    // `files` qui décide, et une application n'a que le tarball.
    const manifest = JSON.parse(
      fs.readFileSync(path.join(DEVKIT, "package.json"), "utf8"),
    );
    expect(manifest.files).toContain(BROWSER_SCRIPTS_DIR[0]);
  });

  it("rend null quand le paquet est absent", () => {
    expect(resolveBrowserScript(VIDE, "inspect")).toBeNull();
  });
});

describe("commande see — ce qui manque se constate sur le disque", () => {
  it("nomme les paquets absents, par mode", () => {
    expect(missingDependencies(VIDE, "audit")).toEqual([
      "playwright",
      "lighthouse",
    ]);
    expect(missingDependencies(VIDE, "inspect")).toEqual([
      "playwright",
      "axe-core",
    ]);
  });
});
