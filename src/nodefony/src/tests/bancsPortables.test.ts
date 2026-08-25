/**
 * **Un banc ne redevine pas le kill d'arbre : il appelle celui du framework.**
 *
 * Les groupes de process n'existent pas sous Windows (axiome 5). Un
 * `process.kill(-pid, …)` y LÈVE — et comme cet appel est presque toujours
 * enveloppé d'un `try/catch` qui lit la levée comme « déjà mort », il ne tue
 * rien EN SILENCE. Le dépôt porte l'implémentation unique qui traite les trois
 * systèmes (`signalProcessGroup`, `taskkill /T /F` sous Windows) et qui, en
 * plus, RÉPOND ce qu'elle a atteint.
 *
 * Vécu, et c'est ce qui a rendu ce fichier nécessaire : un banc du kit tuait
 * son serveur par groupe de process. Sur Linux et macOS, vert depuis toujours.
 * Au premier passage sous Windows, le serveur survivait au banc et emportait
 * les ports du SUIVANT — qui échouait alors sur « Port 5173 is already in
 * use », puis sur « Aucun process n'écoute sur :5151 », pendant que `status`,
 * privé de `ps`, lisait le fichier d'état du résidu et annonçait le mauvais
 * mode. Trois symptômes, une cause, et aucun ne nommait le coupable.
 *
 * Ce contrôle ne remplace pas l'exécution sous Windows — il empêche la
 * RÉCIDIVE, que l'exécution ne peut attraper qu'après coup, et seulement si
 * quelqu'un lit le journal.
 *
 * L'implémentation, elle, est éprouvée à part (`devProcess.test.ts` :
 * `killTreeCommand` par plateforme, `signalProcessGroup` sur son verdict, avec
 * la plateforme INJECTÉE — c'est ainsi qu'on éprouve Windows sans Windows).
 */
import { describe, it } from "vitest";
import { assert } from "chai";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const REPO_ROOT = path.resolve(import.meta.dirname, "../../../..");

/** Les racines où vivent les scripts exécutables du dépôt (bancs et outils). */
const RACINES = [
  path.join(REPO_ROOT, ".claude", "skills"),
  path.join(REPO_ROOT, "scripts"),
];

/** Tous les `.mjs`/`.js` sous une racine, en profondeur. */
const scriptsSous = (racine: string): string[] => {
  const trouves: string[] = [];
  const descendre = (dir: string): void => {
    let entrees: string[];
    try {
      entrees = readdirSync(dir);
    } catch {
      return; // racine absente : rien à contrôler ici
    }
    for (const nom of entrees) {
      if (nom === "node_modules" || nom === "dist") continue;
      const p = path.join(dir, nom);
      if (statSync(p).isDirectory()) descendre(p);
      else if (/\.(mjs|js)$/.test(nom)) trouves.push(p);
    }
  };
  descendre(racine);
  return trouves;
};

/**
 * Un `process.kill(-…)` — le signal à un GROUPE.
 *
 * Volontairement littéral : c'est la forme exacte qui a mordu, et une
 * expression plus large attraperait `process.kill(pid, …)`, qui est légitime.
 */
const KILL_DE_GROUPE = /process\s*\.\s*kill\s*\(\s*-/;

const scripts = RACINES.flatMap(scriptsSous);

describe("Bancs et scripts — le kill d'arbre vient du framework", () => {
  it("des scripts sont bien balayés (sinon ce test ne prouve rien)", () => {
    assert.isAbove(scripts.length, 0, "aucun script trouvé");
  });

  for (const fichier of scripts) {
    const relatif = path.relative(REPO_ROOT, fichier);
    const source = readFileSync(fichier, "utf8");
    // Le motif apparaît légitimement dans une PROSE qui l'explique.
    const code = source
      .split("\n")
      .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
      .join("\n");
    if (!KILL_DE_GROUPE.test(code)) continue;

    it(`${relatif} — passe par signalProcessGroup`, () => {
      assert.fail(
        `${relatif} tue un GROUPE de process (\`process.kill(-pid)\`). ` +
          `Cela ne tue RIEN sous Windows, où les groupes n'existent pas — et ` +
          `l'appel y lève, donc un \`catch\` le prend pour « déjà mort ». ` +
          `Utiliser \`signalProcessGroup(pid, signal)\` (barrel \`nodefony\`), ` +
          `qui traite les trois systèmes et REND ce qu'il a atteint.`,
      );
    });
  }
});
