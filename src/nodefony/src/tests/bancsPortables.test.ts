/**
 * **Un banc ne redevine pas une capacité système : il appelle celle du framework.**
 *
 * Deux formes de la même faute sont contrôlées ici — tuer un arbre, et demander
 * qui écoute sur un port. Chaque fois, le script improvise un appel POSIX que le
 * dépôt porte DÉJÀ, portable, et chaque fois le silence de Windows fait accuser
 * le produit à la place de l'instrument.
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

/**
 * Les outils POSIX de sonde réseau, invoqués depuis un script.
 *
 * `lsof` n'existe pas sous Windows : l'appel rend « command not found », le
 * `try/catch` qui l'enveloppe lit l'absence de sortie comme « personne
 * n'écoute », et le banc conclut que le serveur n'a pas démarré alors qu'il
 * écoute très bien. C'est le rouge qui a rendu ce contrôle nécessaire : la
 * preuve d'arrêt gracieux, verte sur deux systèmes, a passé une journée à
 * accuser le drain d'un défaut qui était celui de sa propre sonde.
 *
 * Le motif ne vise QUE l'exécution — un `lsof` cité dans une prose, ou dans le
 * transcript factice d'un banc qui apprend à reconnaître un agent qui bricole,
 * n'invoque rien.
 */
const SONDE_POSIX = /\b(lsof|netstat)\b/;
/** Les appels qui font TOURNER une commande. */
const EXECUTION =
  /\b(execSync|execFileSync|spawnSync|exec|execFile|spawn)\s*\(/;

describe("Bancs et scripts — la sonde de port vient du framework", () => {
  it("des scripts sont bien balayés (sinon ce test ne prouve rien)", () => {
    assert.isAbove(scripts.length, 0, "aucun script trouvé");
  });

  for (const fichier of scripts) {
    const relatif = path.relative(REPO_ROOT, fichier);
    const source = readFileSync(fichier, "utf8");
    const code = source
      .split("\n")
      .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
      .join("\n");

    // La sonde doit être l'ARGUMENT d'une exécution, pas une mention. On borne
    // la fenêtre en arrière : au-delà, l'appel appartient à un autre énoncé.
    const invoquee = [...code.matchAll(new RegExp(SONDE_POSIX, "g"))].some(
      (m) => EXECUTION.test(code.slice(Math.max(0, m.index - 200), m.index)),
    );
    if (!invoquee) continue;

    it(`${relatif} — passe par isPortListening / readRuntimeState`, () => {
      assert.fail(
        `${relatif} interroge les ports par \`lsof\`/\`netstat\`. ` +
          `\`lsof\` n'existe pas sous Windows : la sonde y rend « personne n'écoute » ` +
          `pendant que le serveur écoute, et le banc accuse le produit. ` +
          `Utiliser \`isPortListening(port)\` (une connexion en boucle locale, aucun ` +
          `outil système) ou \`readRuntimeState(cwd)\` pour le PID de qui écoute — ` +
          `tous deux au barrel \`nodefony\`.`,
      );
    });
  }
});
