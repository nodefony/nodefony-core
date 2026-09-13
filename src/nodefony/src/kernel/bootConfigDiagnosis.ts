/**
 * Diagnostic d'un manifeste de modules VIDE au boot.
 *
 * Un manifeste vide sous profil serveur produit toujours le même symptôme —
 * aucun module monté, aucun serveur en écoute, sortie 69 — alors qu'il recouvre
 * trois situations sans rapport. Les confondre envoie chercher au mauvais
 * endroit : le message historique nommait `nodefony.config` et l'exécutable,
 * c'est-à-dire précisément les deux choses qui sont justes quand la cause est un
 * `dist/` vide.
 *
 * 🔴 POURQUOI CE CAS NE LÈVE PAS DE LUI-MÊME. Un export par défaut PRÉSENT mais
 * vide (`export default {}`) passe tous les contrôles : le Kernel le prend pour
 * une application « legacy » et applique `defaultAppConfig`, dont `modules` est
 * `[]` — une résilience voulue pour les runs console, et qui devient un silence
 * coûteux dès qu'on attendait un serveur.
 *
 * ⚠️ Mesuré, et contre-intuitif : un fichier **entièrement** vide, lui, ÉCHOUE
 * bruyamment (`does not provide an export named 'default'`). Le silence ne vient
 * donc pas d'un fichier tronqué, mais d'une configuration qui s'évalue en objet
 * vide. Ne pas envoyer chercher un `dist/` en cours d'écriture comme cause unique.
 *
 * La fonction est PURE : elle ne lit ni le disque ni l'environnement, si bien
 * que les trois cas s'éprouvent sans monter de kernel ni fabriquer de `dist/`.
 *
 * @module
 */

/**
 * D'où provient la configuration d'application effectivement lue au boot.
 *
 * - `descriptor` — `export default defineConfig(…)`, la forme moderne attendue.
 * - `legacy-object` — un objet nu, sans la marque de `defineConfig`.
 * - `absent` — aucun export par défaut : `dist/` vide, absent, ou en cours
 *   d'écriture au moment de l'import.
 */
export type AppConfigOrigin =
  "descriptor" | "legacy-object" | "absent" | "foreign-descriptor";

/**
 * Nom de la marque d'un descripteur de config, tel qu'il apparaît dans la
 * `description` du symbole.
 *
 * Dupliqué ici À DESSEIN, et c'est la seule duplication légitime du fichier : la
 * garde doit reconnaître une marque posée par une AUTRE instance du module,
 * donc par un symbole qui n'est pas le nôtre. Importer la constante de
 * `defineConfig` ramènerait notre propre symbole — précisément celui qui ne
 * correspond pas. On compare donc la `description`, seule chose que deux
 * instances partagent. Un gate confronte les deux littéraux
 * (`configDescriptorCrossInstance.test.ts`).
 */
const CONFIG_DESCRIPTOR_NAME = "nodefony.configDescriptor";

/**
 * Détecte un descripteur produit par une AUTRE instance du module `nodefony`.
 *
 * 🔴 CE QUE CETTE GARDE RATTRAPE, et pourquoi elle ne peut pas être un test. Deux
 * copies du module `nodefony` chargées dans un même process ont chacune leurs
 * symboles : une marque posée par l'une est invisible à l'autre. Le Kernel prend
 * alors un descripteur parfaitement valide pour une configuration historique,
 * applique `defaultAppConfig`, ne monte aucun module et sort en 69 — **sans
 * qu'aucune erreur ne soit levée**, en accusant une configuration saine.
 *
 * Les chemins qui produisent cette situation sont nombreux et ne se devinent
 * pas : un binaire lié globalement vers un dépôt de développement (`npm link`,
 * un lien dans `~/.local/bin`), un monorepo, deux versions dans un arbre npm, un
 * respawn qui repart du mauvais paquet. On ne peut pas tous les tester ; on peut
 * en revanche reconnaître leur SIGNATURE commune à l'exécution.
 *
 * La détection porte sur la `description` du symbole, pas sur son identité :
 * c'est la seule chose que deux instances partagent.
 *
 * @param raw - export par défaut de l'application, tel qu'il a été lu.
 * @returns `true` si l'objet porte la marque d'une autre instance du module.
 */
export function isForeignDescriptor(raw: unknown): boolean {
  if (typeof raw !== "object" || raw === null) return false;
  return Object.getOwnPropertySymbols(raw).some(
    (s) => s.description === CONFIG_DESCRIPTOR_NAME,
  );
}

/**
 * Constat émis quand la configuration de l'application a été résolue par une
 * AUTRE copie du framework — c'est-à-dire quand deux paquets `nodefony`
 * tournent dans ce process, et que la copie fautive est trop ancienne pour
 * s'être inscrite au registre d'instances.
 *
 * ⚠️ Ce texte est un CONSTAT, pas un verdict : c'est `Kernel` qui décide
 * (`packageDualityVerdict`) — avertissement en développement, refus de
 * démarrer partout ailleurs. Il a d'abord affirmé « l'application DÉMARRE »,
 * ce qui est devenu FAUX le jour où la production a commencé à refuser : un
 * message qui promet un démarrage à qui vient de lire un refus est pire que
 * pas de message.
 *
 * Pourquoi ce décor n'est pas anodin : les défauts et le schéma de validation
 * appliqués sont ceux de l'AUTRE version. Entre deux versions proches c'est
 * sans effet ; entre deux versions éloignées, un champ peut manquer ou être
 * validé autrement, et cela se manifesterait par un comportement inexplicable,
 * jamais par une erreur.
 *
 * @returns le texte du constat (français, destiné à un humain).
 */
export function foreignPackageWarning(): string {
  return (
    "DEUX paquets `nodefony` différents tournent dans ce process : la " +
    "configuration a été écrite avec `defineConfig(…)` d'une copie, et ce noyau " +
    "vient d'une autre. La configuration a pu être résolue — c'est la copie qui " +
    "l'a produite qui s'en est chargée — mais les défauts et la validation " +
    "appliqués sont ceux de SA version, et les modules construits à la " +
    "frontière perdent leur container sans la moindre erreur. Causes usuelles : " +
    "un binaire `nodefony` lié globalement vers un autre dossier (`npm link`, " +
    "un lien dans `~/.local/bin`), deux versions dans l'arbre npm, un monorepo. " +
    "Pour trancher : `npm ls nodefony` liste les copies installées et qui les " +
    "réclame ; `NF_CLI_DEBUG=1 nodefony --version` dit quel CLI s'exécute."
  );
}

/** Entrée du diagnostic — les trois faits constatés au boot. */
export interface IEmptyManifestFacts {
  /** Le profil d'exécution attendait-il des serveurs en écoute. */
  serversExpected: boolean;
  /** Nombre d'entrées déclarées par `config.modules`. */
  manifestEntries: number;
  /** Provenance de la configuration lue. */
  origin: AppConfigOrigin;
}

/**
 * Nomme la cause probable d'un manifeste vide, ou `null` s'il n'y a rien à dire.
 *
 * Ne parle QUE sous profil serveur : une commande console ou un test qui boote
 * sans manifeste est un cas nominal, et une remédiation posée là serait un faux
 * diagnostic recopié partout où le rapport de boot est lu.
 *
 * @param facts - les faits constatés au boot.
 * @returns une phrase d'action nommant la cause, ou `null`.
 */
export function diagnoseEmptyManifest(
  facts: IEmptyManifestFacts,
): string | null {
  if (!facts.serversExpected || facts.manifestEntries > 0) return null;

  switch (facts.origin) {
    case "absent":
      return (
        "`nodefony.config` n'exporte AUCUNE configuration exploitable — son " +
        "export par défaut est vide ou absent, si bien que le manifeste tombe à " +
        "`[]` SANS qu'une erreur soit levée. Vérifier dans cet ordre : (1) le " +
        "`dist/` chargé correspond-il aux sources (`npm run build`, puis " +
        "relancer) ; (2) `nodefony.config.ts` porte-t-il bien " +
        "`export default defineConfig(…)`. `nodefony inspect config` dit la " +
        "config effective et sa provenance"
      );
    case "legacy-object":
      return (
        "la configuration exportée par `nodefony.config` ne porte pas la marque " +
        "de `defineConfig(…)` : elle a été traitée comme une configuration " +
        "historique, dont le manifeste par défaut est VIDE ⇒ écrire " +
        '`export default defineConfig({ modules: [use("@nodefony/http"), …] })`'
      );
    case "foreign-descriptor":
      // Ce cas ne se produit QUE si la config résolue par l'autre copie déclare
      // elle-même un manifeste vide : la dualité seule n'empêche plus de démarrer
      // (cf `Kernel.resolveAppOptions`). On dit donc les deux faits.
      return (
        "le manifeste `modules` est VIDE, et deux paquets `nodefony` différents " +
        "tournent dans ce process (la configuration a été résolue par l'autre " +
        "copie) ⇒ déclarer les modules dans `nodefony.config`, et régler la " +
        "dualité : `NF_CLI_DEBUG=1 nodefony --version` dit quel CLI s'exécute"
      );
    case "descriptor":
      return (
        "`nodefony.config` déclare un manifeste `modules` VIDE ⇒ y déclarer au " +
        'moins `use("@nodefony/http")` pour qu\'un serveur puisse monter ' +
        "(`nodefony inspect config` dit la config effective et sa provenance)"
      );
  }
}
