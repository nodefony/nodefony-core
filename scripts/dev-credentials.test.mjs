/**
 * Gate — UN SEUL mot de passe de développement, et tout ce qui l'annonce dit vrai.
 *
 * POURQUOI. Le dépôt a porté DEUX mots de passe de fixture selon un réglage
 * invisible : `secret-de-dev-42` pour le dépôt persistant (`DEV_FIXTURE_PASSWORD`,
 * semé par `provisionUsers`) et `secret` pour l'annuaire en mémoire, dont les
 * hachages sont pré-calculés dans `devUsers.ts`. Rien à l'écran ne disait lequel
 * tournait. Conséquence mesurée : l'écran de connexion affichait `admin / secret`,
 * les sept recettes du skill navigateur échouaient, et quatre scripts de charge ne
 * s'authentifiaient plus — sans qu'aucun test ne tombe, puisque le code des suites,
 * lui, avait suivi.
 *
 * CE QU'IL CONTRÔLE, et pourquoi dans cet ordre :
 *  1. les hachages de l'annuaire en mémoire VALIDENT le mot de passe unique —
 *     preuve cryptographique, la seule qui ne puisse pas mentir ;
 *  2. le mot de passe ne se recopie nulle part sous son ancienne forme — balayage
 *     du dépôt, parce que l'exhaustivité ne s'obtient pas à la relecture : deux
 *     passes manuelles avaient laissé quatre sites derrière elles.
 */
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { describe, it, expect } from "vitest";
import { verify } from "@node-rs/argon2";

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const lire = (rel) => readFileSync(path.join(RACINE, rel), "utf8");

/** La SOURCE unique : la constante que `provisionUsers` sème. */
function motDePasseDeReference() {
  const rel = "nodefony/security/provisionUsers.ts";
  expect(
    existsSync(path.join(RACINE, rel)),
    `${rel} introuvable — s'il a déménagé, recaler ce gate, ne pas le supprimer`,
  ).toBe(true);
  const trouve = /DEV_FIXTURE_PASSWORD = "([^"]+)"/.exec(lire(rel));
  expect(trouve, `DEV_FIXTURE_PASSWORD introuvable dans ${rel}`).not.toBeNull();
  return trouve[1];
}

describe("un seul mot de passe de développement", () => {
  const attendu = motDePasseDeReference();

  it("les hachages de l'annuaire en mémoire valident CE mot de passe", async () => {
    const src = lire("nodefony/security/devUsers.ts");
    const hachages = [...src.matchAll(/"(\$argon2id\$[^"]+)"/g)].map(
      (m) => m[1],
    );
    expect(
      hachages.length,
      "aucun hachage argon2id dans devUsers.ts — le fichier a changé de forme",
    ).toBeGreaterThanOrEqual(2);
    for (const h of hachages) {
      expect(
        await verify(h, attendu),
        `un hachage de devUsers.ts ne valide pas « ${attendu} » : l'annuaire en ` +
          `mémoire et le dépôt persistant ont DEUX mots de passe, et rien à ` +
          `l'écran ne dit lequel tourne`,
      ).toBe(true);
    }
  });

  it("aucun fichier n'annonce encore l'ancien mot de passe", () => {
    // Le balayage passe par git : il ne voit que le suivi, donc ni `dist/`, ni
    // `node_modules/`, ni les journaux — et il ne peut pas rater un dossier que
    // l'auteur du gate n'aurait pas pensé à lui donner.
    const suivis = execFileSync("git", ["ls-files", "-z"], {
      cwd: RACINE,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    })
      .split("\0")
      .filter(Boolean);

    // Les formes par lesquelles un mot de passe s'annonce : en paire avec un
    // identifiant, ou posé dans une variable d'environnement connue.
    const formes = [
      /\badmin\s*[/:]\s*secret(?![-\w@])/,
      /\buser\s*[/:]\s*secret(?![-\w@])/,
      /\bNF_(?:ADMIN|USER)_PASSWORD=secret(?![-\w])/,
      /\bNF_BROWSER_PASSWORD=secret(?![-\w])/,
      /\bPW\s*=\s*"secret"/,
    ];
    // Les retex archivés RACONTENT ce qui s'est passé : les corriger réécrirait
    // l'histoire. Ce gate garde ce qui INSTRUIT un lecteur d'aujourd'hui.
    const exempts = (f) =>
      f.startsWith("docs/session-retros/archive/") ||
      f === "scripts/dev-credentials.test.mjs";

    const fautifs = [];
    for (const f of suivis) {
      if (
        exempts(f) ||
        /\.(png|jpg|jpeg|gif|webp|ico|pdf|woff2?|db|sqlite)$/i.test(f)
      )
        continue;
      let contenu;
      try {
        contenu = readFileSync(path.join(RACINE, f), "utf8");
      } catch {
        continue;
      }
      contenu.split("\n").forEach((ligne, i) => {
        if (formes.some((re) => re.test(ligne)))
          fautifs.push(`${f}:${i + 1} ${ligne.trim()}`);
      });
    }
    expect(
      fautifs,
      `ces lignes annoncent un mot de passe de fixture qui n'existe plus ` +
        `(le mot de passe unique est « ${attendu} », ` +
        `DEV_FIXTURE_PASSWORD dans nodefony/security/provisionUsers.ts) :\n` +
        fautifs.join("\n"),
    ).toEqual([]);
  });
});
