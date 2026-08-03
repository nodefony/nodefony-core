/**
 * Décor de la tâche 32 — déclarer dans le manifeste un module qui n'est PAS
 * installé, puis laisser l'application démarrer.
 *
 * Ce n'est pas une panne franche, et c'est tout l'intérêt : le Kernel charge les
 * modules en **fail-soft**. Le paquet absent n'arrête donc pas le boot — les
 * ports s'ouvrent, l'application répond, et ce qu'elle ne fait plus ne lève
 * aucune erreur au point d'usage. Mesuré sur une app réelle :
 *
 *   WARNING KERNEL : MODULE LOAD: échec non bloquant (fail-soft) de "@nodefony/mongoose"
 *   WARNING KERNEL : BOOT dégradé — 9 module(s) chargé(s), 1 en échec
 *
 * Ces deux lignes passent une fois, au terminal de celui qui a lancé. C'est
 * exactement le cas que `nodefony check` est seul à savoir redire APRÈS coup.
 *
 * Le script échoue FORT si l'ancre n'est plus dans le gabarit : mieux vaut une
 * tâche non jouée qu'une tâche jugée sur un décor à moitié posé — l'agent
 * porterait le rouge d'un trou qu'il n'a pas laissé.
 *
 * Éprouvable seul (c'est la raison d'être du fichier — un `node -e` inline ne
 * l'est pas) :
 *   node prepare-module-absent.mjs --selftest
 */
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";

/** Le module déclaré-mais-absent. Nommé ici, et cité par la tâche 32. */
export const MODULE_ABSENT = "@nodefony/mongoose";

/** L'ancre : la première entrée du manifeste, posée par tous les presets. */
const ANCRE = /use\("@nodefony\/http",\s*\{\}\),/u;

/**
 * Insère la déclaration du module absent juste après l'ancre.
 *
 * @param source - contenu de `nodefony.config.ts`
 * @returns le manifeste modifié
 * @throws Si l'ancre est absente — le gabarit a changé de forme.
 */
export function poserModuleAbsent(source) {
  const m = ANCRE.exec(source);
  if (!m) {
    throw new Error(
      'ancre introuvable dans le manifeste (use("@nodefony/http", {}),) — ' +
        "le gabarit a changé de forme, la tâche 32 ne peut pas être posée",
    );
  }
  return source.replace(m[0], `${m[0]}\n    use("${MODULE_ABSENT}", {}),`);
}

/** Auto-contrôle : la pose, l'idempotence refusée, et l'ancre manquante. */
function selftest() {
  const cas = [];
  const sain = `  modules: [\n    use("@nodefony/http", {}),\n    use("@nodefony/security", {}),\n  ],\n`;

  const pose = poserModuleAbsent(sain);
  cas.push([
    "pose le module absent après l'ancre",
    pose.includes(`use("${MODULE_ABSENT}", {}),`),
  ]);
  cas.push([
    "ne touche pas au reste du manifeste",
    pose.includes(`use("@nodefony/security", {}),`) &&
      pose.includes(`use("@nodefony/http", {}),`),
  ]);
  cas.push([
    "insère APRÈS l'ancre, pas avant",
    pose.indexOf("@nodefony/http") < pose.indexOf(MODULE_ABSENT),
  ]);

  let leve = false;
  try {
    poserModuleAbsent(
      `  modules: [\n    use("@nodefony/realtime", {}),\n  ],\n`,
    );
  } catch {
    leve = true;
  }
  cas.push(["échoue FORT quand l'ancre a disparu", leve]);

  // Le fichier écrit est bien celui qu'on relit — le décor passe par le disque.
  const dir = mkdtempSync(path.join(tmpdir(), "prep-mod-"));
  const f = path.join(dir, "nodefony.config.ts");
  writeFileSync(f, sain, "utf8");
  writeFileSync(f, poserModuleAbsent(readFileSync(f, "utf8")), "utf8");
  cas.push([
    "l'écriture sur disque porte la modification",
    readFileSync(f, "utf8").includes(MODULE_ABSENT),
  ]);

  let rouge = 0;
  for (const [nom, ok] of cas) {
    console.log(`  ${ok ? "✅" : "❌"} ${nom}`);
    if (!ok) rouge += 1;
  }
  console.log(`\n━━ ${cas.length - rouge}/${cas.length} cas`);
  return rouge === 0 ? 0 : 1;
}

if (process.argv.includes("--selftest")) {
  process.exit(selftest());
} else {
  const f = "nodefony.config.ts";
  writeFileSync(f, poserModuleAbsent(readFileSync(f, "utf8")), "utf8");
}
