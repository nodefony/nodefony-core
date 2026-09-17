/**
 * **Le cache de transformation s'ALLUME à la demande — il n'est jamais le défaut.**
 *
 * Le gain n'existe qu'au DEUXIÈME run d'un MÊME paquet ; à cache vide le premier
 * paie l'écriture sans rien récupérer (4,20 s → 4,60 s). Or `npm run test:all`
 * lance presque chaque paquet UNE fois : il écrirait 270 Mo pour ne les relire
 * jamais. Le cache appartient donc à la boucle de développement sur un module,
 * où il rend 34 % (4,31 s → 2,86 s, médiane de 5 runs), et nulle part ailleurs.
 *
 * Ce contrôle existe parce que la règle est INVISIBLE à l'usage. Un cache écrit
 * pour rien ne se remarque pas : les suites restent vertes, elles sont seulement
 * plus lentes et le disque plus plein. Une règle qu'aucun test ne relit finit
 * inversée au premier refactor, sans erreur ni symptôme.
 *
 * La règle s'éprouve sur la fonction PURE `transformCacheFor`, jamais en
 * réimportant le module avec un `process.env` bricolé : un import de chemin
 * absolu est lu comme un protocole sous Windows (`D:` …), et un module déjà
 * évalué rendrait la valeur figée au premier appel — le test passerait alors
 * pour la mauvaise raison.
 */
import { describe, it } from "vitest";
import { assert } from "chai";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { transformCacheFor } from "../../../../vitest.perf";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../..",
);

/** Fichiers suivis par git, chemins normalisés en `/` pour être filtrables. */
const suivis = (sousDossier?: string): string[] =>
  execFileSync("git", ["ls-files", ...(sousDossier ? [sousDossier] : [])], {
    cwd: ROOT,
    encoding: "utf8",
  })
    .split("\n")
    // Normaliser AVANT de filtrer : un motif écrit en `/` ne mord pas sur un
    // chemin au séparateur natif.
    .map((l) => l.trim().split(path.sep).join("/"))
    .filter(Boolean);

describe("vitest.perf — le cache de transformation reste hors de la forge", () => {
  it("est ÉTEINT par défaut — le cas de la passe complète", () => {
    // `npm run test:all` ne relance presque jamais un même paquet : le cache y
    // écrirait 270 Mo sans jamais les relire, et le premier run de chaque paquet
    // paie l'écriture (+9 % mesuré).
    assert.isFalse(
      transformCacheFor({}).fsModuleCache,
      "le défaut ne doit pas dégrader la commande d'autorité du dépôt",
    );
  });

  it("s'allume sur demande explicite — la boucle sur un seul paquet", () => {
    for (const valeur of ["1", "true"]) {
      assert.isTrue(
        transformCacheFor({ NF_VITEST_FS_CACHE: valeur }).fsModuleCache,
        `\`NF_VITEST_FS_CACHE=${valeur}\` doit allumer le cache`,
      );
    }
  });

  it("reste éteint si on le demande éteint", () => {
    for (const valeur of ["0", "false"]) {
      assert.isFalse(
        transformCacheFor({ NF_VITEST_FS_CACHE: valeur }).fsModuleCache,
        `\`NF_VITEST_FS_CACHE=${valeur}\` doit éteindre le cache`,
      );
    }
  });

  it("la forge garde le dernier mot, même sur demande explicite", () => {
    // Le cache y serait écrit puis jeté avec le `node_modules` que `npm ci`
    // refait à chaque tâche. `CI` est l'une des deux exceptions au préfixe
    // `NF_` : une variable que nous ne possédons pas, posée par la forge.
    assert.isFalse(
      transformCacheFor({ CI: "true", NF_VITEST_FS_CACHE: "1" }).fsModuleCache,
      "la forge écrirait un cache qu'elle ne relira jamais",
    );
  });

  it("traite `CI=false` comme la forge — toute valeur POSÉE vaut présence", () => {
    // La convention des forges est la PRÉSENCE de la variable : GitHub pose
    // `CI=true`, d'autres `CI=1`. Lire la valeur ferait dépendre le
    // comportement d'une chaîne qu'aucune spécification ne fixe.
    assert.isFalse(
      transformCacheFor({ CI: "false", NF_VITEST_FS_CACHE: "1" }).fsModuleCache,
      "une variable posée signale une forge, quelle que soit sa valeur",
    );
  });

  it("une valeur VIDE ne compte pas comme une demande", () => {
    // `NF_VITEST_FS_CACHE=` traîne dans les fichiers d'environnement et les
    // définitions de tâches ; personne ne l'a voulue.
    assert.isFalse(
      transformCacheFor({ NF_VITEST_FS_CACHE: "" }).fsModuleCache,
      "une chaîne vide doit laisser le défaut décider, et le défaut est éteint",
    );
  });

  it("ne porte QUE des options de vitesse — aucune qui change un verdict", () => {
    // Les CLÉS rendues, pas le source : chercher dans le texte du fichier
    // ferait mordre le contrôle sur la prose de son propre commentaire.
    const autorisees = new Set([
      "fsModuleCache",
      "fsModuleCachePath",
      "isolate",
      "pool",
      "maxWorkers",
      "minWorkers",
      "fileParallelism",
    ]);
    const posees = Object.keys(transformCacheFor({}));
    const hors = posees.filter((clef) => !autorisees.has(clef));
    assert.deepEqual(
      hors,
      [],
      `le socle porte une option hors de son périmètre : ${hors.join(", ")}`,
    );
  });

  it("chaque configuration Vitest d'un espace de travail étale le socle", () => {
    // Le relevé se fait sur un critère STRUCTUREL — un fichier `vitest.*.ts`
    // posé à côté d'un `package.json` —, jamais sur un motif de nom.
    //
    // Les deux critères plus évidents ont été essayés et sont FAUX :
    //  - `*.config.ts` rate `drizzle/vitest.config.load.ts`, qui porte son
    //    qualificatif APRÈS `config`. Ce fichier est bien à exclure, mais par
    //    décision — et non parce qu'un motif ne l'a pas vu : un nom inattendu
    //    échapperait alors au contrôle sans un mot, ce qui est un faux vert.
    //  - chercher `export default defineConfig` dans le texte attrape
    //    `vitest.gates.ts`, où cette ligne est un EXEMPLE de TSDoc.
    const dossiersDePaquet = new Set(
      suivis()
        .filter((l) => l.endsWith("/package.json"))
        .map((l) => l.slice(0, -"/package.json".length)),
    );

    const toutes = suivis()
      .filter((l) => /(^|\/)vitest[^/]*\.ts$/.test(l))
      .filter((l) => !l.endsWith(".d.ts"))
      // À côté d'un `package.json` : écarte d'un coup les socles de la racine du
      // dépôt (`vitest.oxc.ts`, `vitest.perf.ts`, `vitest.gates.ts`) et les
      // `vitest.setup.ts`, qui vivent dans un dossier `tests/`.
      .filter((l) => dossiersDePaquet.has(path.dirname(l)))
      // Les gabarits partent dans les applications générées : leur
      // `node_modules` est un AUTRE dossier, souvent éphémère, et le choix
      // appartient à l'application — pas à nous.
      .filter((l) => !l.includes("/templates/"));

    // Les suites de CHARGE et de mémoire gardent un décor CONSTANT : un banc ne
    // change pas d'outillage entre deux mesures. Reconnu au qualificatif `load`
    // où qu'il soit dans le nom — `vitest.load.config.ts` côté http,
    // `vitest.config.load.ts` côté drizzle.
    const bancs = toutes.filter((l) => /\bload\b/.test(path.basename(l)));
    const configs = toutes.filter((l) => !bancs.includes(l));

    // Sans cette borne, un relevé devenu vide rendrait le contrôle vert en
    // n'ayant rien contrôlé.
    assert.isAbove(configs.length, 15, "le relevé des configurations a échoué");
    // Contrôle INDÉPENDANT du filtre : ce qui est écarté doit être exactement
    // les deux bancs connus. Un banc de plus se déclare ici — et une config
    // ordinaire qui porterait `load` dans son nom serait attrapée au lieu de
    // disparaître en silence.
    assert.deepEqual(
      bancs,
      [
        "src/packages/@nodefony/drizzle/vitest.config.load.ts",
        "src/packages/@nodefony/http/vitest.load.config.ts",
      ],
      "la liste des suites de charge écartées a changé — la revoir explicitement",
    );

    const sans = configs.filter(
      (rel) =>
        !readFileSync(path.join(ROOT, rel), "utf8").includes(
          "...transformCache",
        ),
    );
    assert.deepEqual(
      sans,
      [],
      `configuration(s) qui n'étalent pas le socle : ${sans.join(", ")}`,
    );
  });

  it("aucun gabarit d'application n'impose ce cache", () => {
    const gabarits = suivis("src/nodefony/templates").filter((l) =>
      l.endsWith(".tpl"),
    );
    assert.isAbove(gabarits.length, 10, "le relevé des gabarits a échoué");

    const fautifs = gabarits.filter((rel) =>
      readFileSync(path.join(ROOT, rel), "utf8").includes("fsModuleCache"),
    );
    assert.deepEqual(
      fautifs,
      [],
      `gabarit(s) imposant un cache au node_modules d'une application : ${fautifs.join(", ")}`,
    );
  });
});
