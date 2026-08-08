import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/**
 * Ce que ces tests prouvent : les sondes publiées DÉMARRENT et REFUSENT ce
 * qu'elles doivent refuser, sur le système qui exécute cette suite.
 *
 * Le trou qu'ils ferment est précis. Le banc fonctionnel voisin lance les sondes
 * dans un conteneur : il éprouve donc toujours du Linux, quelle que soit la
 * machine — et il saute entièrement là où docker et le serveur manquent. Les
 * scripts partaient ainsi sur npm sans avoir jamais été exécutés ailleurs, alors
 * que Windows est un impératif de ce framework et que rien n'y est acquis :
 * résolution des imports depuis une URL de fichier, séparateur de chemin,
 * création du dossier de sortie, code de sortie remonté au shell.
 *
 * Ces cas ne demandent NI serveur, NI conteneur, NI navigateur : ce sont les
 * chemins de REFUS, tous décidés avant qu'un navigateur soit lancé. Ils tournent
 * donc partout où tourne la suite — dont le poste Windows de la forge, où ils
 * sont la seule exécution réelle de ce code.
 *
 * ⚠️ « Ça se lit » ne dit rien : seul un test qui EXÉCUTE prouve quelque chose.
 */
const SCRIPTS = path.join(
  import.meta.dirname,
  "..",
  "skills",
  "nodefony-browser",
  "scripts",
);

/** Dossier de sortie jetable — sinon les sondes écrivent dans le dossier courant. */
const SORTIE = mkdtempSync(path.join(tmpdir(), "nf-browser-demarrage-"));

interface ILancement {
  code: number;
  stderr: string;
}

/**
 * Lance une sonde AVEC le Node courant, dans un environnement RÉDUIT.
 *
 * L'environnement est reconstruit plutôt qu'hérité : une variable `NF_BROWSER_*`
 * laissée par une manipulation précédente changerait le cas éprouvé sans que
 * personne le voie.
 *
 * Ce qui est CONSERVÉ l'est pour ne pas fabriquer un échec qui n'aurait rien à
 * voir avec le cas — un processus Windows privé de `SystemRoot` ou de ses
 * dossiers d'utilisateur échoue pour des raisons de système, et l'on
 * accuserait la sonde. On garde donc ce que le système possède, on écarte ce
 * qui appartient au test.
 *
 * @param script - nom du fichier de sonde.
 * @param args - arguments positionnels.
 * @param env - les seules variables `NF_BROWSER_*` du cas.
 * @returns le code de sortie et la sortie d'erreur.
 */
const ENV_SYSTEME = [
  "PATH",
  "Path",
  "PATHEXT",
  "SystemRoot",
  "windir",
  "COMSPEC",
  "TEMP",
  "TMP",
  "HOME",
  "USERPROFILE",
  "APPDATA",
  "LOCALAPPDATA",
] as const;

function lancer(
  script: string,
  args: string[],
  env: Record<string, string>,
): ILancement {
  const base: Record<string, string> = {};
  for (const cle of ENV_SYSTEME) {
    const valeur = process.env[cle];
    if (valeur !== undefined) base[cle] = valeur;
  }
  const res = spawnSync(
    process.execPath,
    [path.join(SCRIPTS, script), ...args],
    {
      encoding: "utf8",
      timeout: 60000,
      env: { ...base, NF_BROWSER_OUT: SORTIE, ...env },
    },
  );
  return { code: res.status ?? -1, stderr: res.stderr ?? "" };
}

/**
 * Playwright manque-t-il ? Les sondes le disent alors en code 69, AVANT tout
 * contrôle d'usage — et aucun refus 64 ne peut être observé.
 *
 * On le CONSTATE en lançant, plutôt que de le déduire d'un `require.resolve` :
 * c'est le verdict du script lui-même qui décide, dans le décor où il tourne.
 */
const sansPlaywright = lancer("socket.mjs", [], {}).code === 69;
if (sansPlaywright) {
  process.stderr.write(
    "\n[browser-demarrage] SUITE SAUTÉE — Playwright absent (code 69) : " +
      "les sondes s'arrêtent avant tout contrôle d'usage.\n\n",
  );
}

describe.skipIf(sansPlaywright)("sondes publiées — démarrage et refus", () => {
  it("socket.mjs — sans endpoint : refus 64, rien n'est deviné", () => {
    const r = lancer("socket.mjs", [], {});
    expect(r.code).toBe(64);
    expect(r.stderr).toContain("NF_BROWSER_SOCKET");
  });

  it("socket.mjs — des paramètres d'action illisibles sont refusés, pas ignorés", () => {
    const r = lancer("socket.mjs", ["/temps-reel"], {
      NF_BROWSER_ACTION_PARAMS: "{ceci nest pas du json",
    });
    expect(r.code).toBe(64);
    expect(r.stderr).toContain("NF_BROWSER_ACTION_PARAMS");
  });

  it("inspect.mjs — une famille inconnue est refusée, avec la liste", () => {
    const r = lancer("inspect.mjs", ["/"], {
      NF_BROWSER_FAMILIES: "inexistante",
    });
    expect(r.code).toBe(64);
    expect(r.stderr).toContain("inexistante");
    expect(r.stderr).toContain("a11y");
  });

  it("un identifiant SANS chemin de connexion s'arrête — aucun écran n'est deviné", () => {
    // Deviner ferait « se connecter » sur une page inexistante, puis mesurer un
    // écran d'erreur en croyant tenir une session.
    const r = lancer("inspect.mjs", ["/"], { NF_BROWSER_USER: "quelquun" });
    expect(r.code).toBe(64);
    expect(r.stderr).toContain("NF_BROWSER_LOGIN");
  });

  it("un schéma de couleurs inconnu est refusé — on ne mesure pas l'autre thème", () => {
    const r = lancer("inspect.mjs", ["/"], {
      NF_BROWSER_COLOR_SCHEME: "sombre",
    });
    expect(r.code).toBe(64);
    expect(r.stderr).toContain("sombre");
  });

  it("une entrée de stockage malformée est refusée, jamais avalée", () => {
    const r = lancer("inspect.mjs", ["/"], {
      NF_BROWSER_STORAGE: "sansEgal",
    });
    expect(r.code).toBe(64);
    expect(r.stderr).toContain("sansEgal");
  });

  it("watch.mjs et audit.mjs démarrent aussi — les quatre sondes se chargent", () => {
    // Le seul défaut qu'on cherche ici est structurel : un import qui ne se
    // résout pas (spécificateur qui n'est pas une URL de fichier, séparateur de
    // chemin), et il ferait échouer le chargement AVANT tout contrôle d'usage.
    // Le refus d'usage est donc la PREUVE que le module s'est chargé.
    for (const sonde of ["watch.mjs", "audit.mjs"]) {
      const r = lancer(sonde, ["/"], { NF_BROWSER_COLOR_SCHEME: "sombre" });
      expect(r.code, `${sonde} : ${r.stderr.slice(0, 300)}`).toBe(64);
    }
  });
});
