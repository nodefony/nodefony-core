/**
 * check-script-descriptions — chaque script `npm` dit ce qu'il fait.
 *
 * `package.json` est du JSON : il n'accepte aucun commentaire, et le seul indice
 * de ce que fait un script y est son NOM. Sur un dépôt qui en porte soixante,
 * son propre auteur ne s'en souvient plus. Les descriptions vivent donc dans
 * `nodefony.scripts` — et ce contrôle existe parce qu'une liste tenue à la main
 * se périme en trois semaines : un script ajouté sans description n'apparaît
 * nulle part, et personne ne s'en aperçoit.
 *
 * Il refuse DEUX choses, et la seconde compte autant : un script non décrit, et
 * une description ORPHELINE — qui parle d'un script supprimé depuis. La première
 * laisse un trou, la seconde fait croire à une capacité qui n'existe plus.
 * Et une troisième, de la même famille : un script qui NOMME un fichier de test
 * absent — vitest l'ignore sans un mot, et la suite passe amputée.
 *
 * @usage   node scripts/gates/check-script-descriptions.mjs
 * @usage   node scripts/gates/check-script-descriptions.mjs <autre/package.json> [...]
 * @output  la liste des manquants et des orphelines ; sortie 1 si l'une existe
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

/**
 * Un crochet npm se CONSTATE, il ne se devine pas à son préfixe.
 *
 * `pre<X>`/`post<X>` s'exécutent autour de `<X>` : leur nom dit déjà à quoi ils
 * se rattachent, et les décrire reviendrait à écrire « avant build » sous
 * `prebuild`. Mais le préfixe seul ment — `prepare` et `preview` commencent par
 * `pre` sans être des crochets de quoi que ce soit. Le critère est donc
 * l'EXISTENCE du script cible dans le même manifeste.
 *
 * @param nom - le nom du script examiné.
 * @param scripts - tous les scripts déclarés.
 * @returns vrai seulement si `nom` encadre un script réellement présent.
 */
function estCrochet(nom, scripts) {
  for (const prefixe of ["pre", "post"]) {
    if (nom.startsWith(prefixe)) {
      const cible = nom.slice(prefixe.length);
      if (cible && scripts.includes(cible)) return true;
    }
  }
  return false;
}

const cibles = process.argv.slice(2);
const fichiers = cibles.length ? cibles : ["package.json"];

let fautif = false;
let undescribed = false;

for (const fichier of fichiers) {
  const chemin = path.resolve(fichier);
  let manifeste;
  try {
    manifeste = JSON.parse(readFileSync(chemin, "utf8"));
  } catch (cause) {
    console.error(`⛔ ${fichier} — illisible : ${cause.message}`);
    fautif = true;
    continue;
  }

  const scripts = Object.keys(manifeste.scripts ?? {});
  const decrits = manifeste.nodefony?.scripts ?? {};

  if (!scripts.length) {
    console.log(`·  ${fichier} — aucun script, rien à décrire`);
    continue;
  }

  const manquants = scripts.filter(
    (nom) =>
      !estCrochet(nom, scripts) &&
      (typeof decrits[nom] !== "string" || !decrits[nom].trim()),
  );
  const orphelines = Object.keys(decrits).filter(
    (nom) => !scripts.includes(nom),
  );

  if (manquants.length) {
    fautif = true;
    undescribed = true;
    console.error(
      `⛔ ${fichier} — ${manquants.length} script(s) sans description ` +
        `dans « nodefony.scripts » :`,
    );
    for (const nom of manquants) console.error(`     ${nom}`);
  }
  if (orphelines.length) {
    fautif = true;
    undescribed = true;
    console.error(
      `⛔ ${fichier} — ${orphelines.length} description(s) qui ne désignent ` +
        `plus aucun script :`,
    );
    for (const nom of orphelines) console.error(`     ${nom}`);
  }
  // Un fichier de test NOMMÉ par un script doit exister : vitest prend chaque
  // chemin pour un filtre, et un filtre qui ne désigne rien se tait tant qu'un
  // autre trouve des fichiers. Vécu (#796) : une espace perdue a collé deux
  // chemins de `test:pilotage`, et les 81 tests de board-lint ont sauté, vert.
  const base = path.dirname(chemin);
  const missingTests = Object.entries(manifeste.scripts ?? {}).flatMap(
    ([name, command]) =>
      String(command)
        .split(/\s+/u)
        .filter((arg) => /\.test\.[cm]?[jt]sx?$/u.test(arg))
        .filter((arg) => !existsSync(path.resolve(base, arg)))
        .map((arg) => `${name} : ${arg}`),
  );
  if (missingTests.length) {
    fautif = true;
    console.error(
      `⛔ ${fichier} — ${missingTests.length} fichier(s) de test nommé(s) mais ` +
        "absent(s) (vitest les ignorerait sans un mot) :",
    );
    for (const line of missingTests) console.error(`     ${line}`);
  }
  if (!manquants.length && !orphelines.length && !missingTests.length) {
    console.log(`✅ ${fichier} — ${scripts.length} script(s), tous décrits`);
  }
}

if (undescribed) {
  console.error(
    "\n   Les décrire dans « nodefony.scripts » du package.json. Elles sont " +
      "rendues par `nodefony scripts` et par `nodefony --help`.",
  );
}
process.exit(fautif ? 1 : 0);
