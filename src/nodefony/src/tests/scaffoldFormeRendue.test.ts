/**
 * **Ce que CHAQUE type de scaffold RÉELLEMENT rendu vaut, du point de vue de la forme.**
 *
 * Deux contrôles existaient déjà, et aucun ne couvrait ce cas :
 * `scaffoldFormat.test.ts` éprouve le MÉCANISME de mise en forme sur des
 * fichiers fabriqués pour lui, et `create.test.ts` vérifie qu'une application
 * naît avec son `.prettierrc.json`. Entre les deux, personne ne demandait à un
 * `create service`, `create command` ou `create controller` de rendre du code
 * que le formateur du projet accepterait tel quel.
 *
 * L'écart n'est pas théorique : la forme d'un fichier généré dépend d'un nom
 * que l'utilisateur choisit — un nom long décale une signature au-delà de la
 * largeur permise, un nom court non. Elle est donc INCORRIGIBLE dans le
 * gabarit, et ne peut se constater que sur le rendu. C'est exactement pourquoi
 * le moteur formate sa transaction avant de l'écrire ; ce fichier vérifie que
 * cette promesse tient pour tous les types, pas seulement pour celui qu'on
 * avait sous les yeux en l'écrivant.
 *
 * ⚠️ Le projet cible doit avoir un prettier à prêter, sinon le moteur laisse le
 * texte intact — et le contrôle passerait sans rien avoir mis à l'épreuve. Il
 * est donc LIÉ (jamais copié : dix mégaoctets par cas coûteraient plus que
 * toute la suite), et un cas sentinelle vérifie que ce prêt fonctionne.
 */
import { assert } from "chai";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { version } from "../../package.json";
import { runScaffold } from "../cli/scaffold/engine";

/** Racine du dépôt — c'est SON prettier qu'on prête au projet de test. */
const REPO = path.resolve(__dirname, "..", "..", "..", "..");
const PRETTIER_BIN = path.join(REPO, "node_modules", ".bin", "prettier");

/** Les extensions que le projet confie à prettier — les autres n'ont pas de forme. */
const FORMATABLES = /\.(ts|tsx|js|mjs|cjs|jsx|json|md|css|scss|html|ya?ml)$/;

/**
 * Les types qui se génèrent DANS un projet existant.
 *
 * `entity` en est absent, et c'est un constat, pas un oubli : il exige
 * `@nodefony/drizzle` déclaré et câblé dans le projet cible, donc une
 * installation réelle. Le prouver ici demanderait de monter une application
 * complète par cas — la conformité de son rendu se constate au banc du
 * générateur, qui installe pour de bon.
 */
const TYPES: ReadonlyArray<{ type: string; nom: string }> = [
  { type: "service", nom: "FacturationRecurrenteAutomatique" },
  { type: "command", nom: "facturation:relance:quotidienne" },
  { type: "controller", nom: "FacturationRecurrenteAutomatique" },
];

let racine = "";
const jetables: string[] = [];

/** Une application jetable, avec un prettier à prêter. */
function appAvecPrettier(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "nf-forme-rendue-"));
  jetables.push(dir);
  // ⚠️ `dir` EST la destination de l'application, pas son dossier parent — le
  // supposer produisait un décor vide où `prettier --check` répondait « aucun
  // fichier », que ce contrôle lisait comme « non conforme ». La sonde accusait
  // le générateur d'un défaut qui était le sien.
  runScaffold(
    { type: "app", answers: { name: "formerendue" }, dir, force: false },
    version,
  );
  const dest = dir;
  mkdirSync(path.join(dest, "node_modules"), { recursive: true });
  // `junction` et non `dir` : un lien symbolique de dossier exige un privilège
  // sous Windows que rien ne garantit sur un exécuteur d'intégration continue.
  symlinkSync(
    path.join(REPO, "node_modules", "prettier"),
    path.join(dest, "node_modules", "prettier"),
    "junction",
  );
  return dest;
}

/**
 * Ce que `prettier --check` dit du fichier — vide si conforme.
 *
 * 🔴 Le chemin est RELATIF au projet, jamais absolu. Prettier lancé avec un
 * `cwd` donné et un chemin absolu SORTANT de ce répertoire répond « All matched
 * files use Prettier code style! » sans avoir rien contrôlé : il accepte tout,
 * en silence. Le cas sentinelle ci-dessous est né de là — il a rendu quatre
 * contrôles complaisants d'un coup, tous verts sur une mesure qui ne mordait
 * pas.
 */
function nonConforme(relatif: string): string {
  try {
    execFileSync(PRETTIER_BIN, ["--check", relatif], {
      cwd: racine,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return "";
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string };
    return `${err.stdout ?? ""}${err.stderr ?? ""}`.trim() || "non conforme";
  }
}

describe("Scaffold — la FORME de ce que chaque type rend vraiment", () => {
  beforeAll(() => {
    racine = appAvecPrettier();
  }, 120000);

  afterAll(() => {
    for (const d of jetables) rmSync(d, { recursive: true, force: true });
  });

  it("le prettier prêté est bien ATTEINT (sinon rien de ce qui suit ne prouve)", () => {
    writeFileSync(
      path.join(racine, "cobaye-forme.ts"),
      "export const a = {b:1,   c:2};\n",
    );
    assert.notEqual(
      nonConforme("cobaye-forme.ts"),
      "",
      "un fichier volontairement mal formé doit être REFUSÉ — sinon le " +
        "contrôle ci-dessous passerait sur un formateur injoignable",
    );
    rmSync(path.join(racine, "cobaye-forme.ts"));
  });

  it("l'application générée est elle-même conforme", () => {
    const fautifs: string[] = [];
    for (const f of ["index.ts", "nodefony.config.ts", "env.ts"]) {
      const p = path.join(racine, f);
      // Un `continue` sur fichier absent avait masqué un décor entièrement
      // vide : le cas passait sans avoir rien contrôlé. Une absence est un
      // échec, pas un saut.
      if (!existsSync(p)) {
        fautifs.push(`${f} — ABSENT de l'application générée`);
        continue;
      }
      const verdict = nonConforme(f);
      if (verdict) fautifs.push(`${f} — ${verdict}`);
    }
    assert.deepEqual(fautifs, [], "fichiers d'application non conformes");
  });

  for (const { type, nom } of TYPES) {
    it(`create ${type} rend du code que le formateur du projet accepte`, () => {
      const resultat = runScaffold(
        { type, answers: { name: nom }, dir: racine, force: true },
        version,
      );
      const rendus = resultat.files.filter((f) => FORMATABLES.test(f));
      assert.isAbove(
        rendus.length,
        0,
        `create ${type} n'a rendu aucun fichier formatable — le cas ne prouve rien`,
      );

      const fautifs: string[] = [];
      for (const f of rendus) {
        const verdict = nonConforme(f);
        if (verdict) fautifs.push(`${f} — ${verdict}`);
      }
      assert.deepEqual(
        fautifs,
        [],
        `create ${type} rend ${fautifs.length} fichier(s) non conforme(s)`,
      );
    });
  }

  it("un nom LONG ne fait pas déborder la largeur permise", () => {
    // La forme dépend d'un nom que l'utilisateur choisit : c'est précisément ce
    // qu'un gabarit ne peut pas corriger, et donc ce qu'il faut constater sur
    // le rendu. Un nom qui pousse les signatures au-delà de la largeur du
    // projet est le cas qui a motivé la mise en forme de la transaction.
    const nom = "ReconciliationBancaireMultiDevisesAvecEcheancierGlissant";
    const resultat = runScaffold(
      { type: "service", answers: { name: nom }, dir: racine, force: true },
      version,
    );
    const fautifs = resultat.files
      .filter((f) => FORMATABLES.test(f))
      .map((f) => ({ f, v: nonConforme(f) }))
      .filter((x) => x.v)
      .map((x) => `${x.f} — ${x.v}`);
    assert.deepEqual(fautifs, [], "un nom long produit du code non conforme");
  });
});
