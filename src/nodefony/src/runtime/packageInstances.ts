/**
 * Registre des copies du paquet `nodefony` chargées dans CE process.
 *
 * 🔴 POURQUOI CE REGISTRE EXISTE, et pourquoi il ne peut pas être remplacé par
 * une inspection d'objet. Deux copies du paquet dans un même process forment
 * deux runtimes distincts : chacune a ses classes, ses symboles privés, son
 * `AsyncLocalStorage`, ses registres d'injection et son propre singleton
 * {@link Nodefony}. Rien ne le signale — l'application démarre, et se dégrade
 * en silence.
 *
 * La détection a d'abord été tentée sur l'OBJET qui traverse la frontière (le
 * descripteur de configuration), et c'était le mauvais endroit : la marque de
 * `defineConfig` vit désormais dans le registre GLOBAL de symboles
 * (`Symbol.for`), donc les deux copies posent et lisent LE MÊME symbole. Un
 * descripteur venu d'ailleurs est alors indiscernable d'un descripteur local —
 * mesuré : `isConfigDescriptor` rend `true` d'une copie à l'autre. La garde qui
 * s'appuyait dessus ne mord plus dès que les deux copies portent ce correctif,
 * c'est-à-dire précisément quand le parc est à jour.
 *
 * Ce registre pose la question à l'endroit où elle a une réponse stable : on ne
 * demande plus « cet objet vient-il d'ailleurs ? » mais « **combien de copies
 * de moi tournent ici ?** ». Chaque copie s'inscrit à l'évaluation de son
 * module `Nodefony`, dans une entrée de `globalThis` adressée par un symbole du
 * registre global — la seule case mémoire que deux copies partagent.
 *
 * Ce que la dualité coûte, mesuré sur ce dépôt (17 modules) : 11 modules
 * chargés, 5 écartés en fail-soft — dont `@nodefony/http` (aucun serveur) et
 * `@nodefony/security` (aucun pare-feu). La cause profonde n'est pas le
 * singleton mais {@link Service}, qui teste `container instanceof Container` :
 * le test échoue d'une copie à l'autre, le service JETTE le container qu'on lui
 * passe et s'en fabrique un vide — donc plus de kernel, plus de journal, plus
 * d'injection. C'est pourquoi la dualité est refusée en production : ce qui
 * disparaît en silence est exactement ce dont dépend la sécurité.
 */

/** Case partagée par toutes les copies : seul le registre global les réunit. */
const REGISTRY_KEY = Symbol.for("nodefony.packageInstances");

/** Une copie du paquet `nodefony` évaluée dans ce process. */
export interface INodefonyPackageInstance {
  /** URL du module `Nodefony` de cette copie — identifie le fichier chargé. */
  readonly url: string;
  /** Version déclarée par le `package.json` de cette copie. */
  readonly version: string;
}

/** Forme de `globalThis` une fois le registre posé. */
type TGlobalWithRegistry = typeof globalThis & {
  [REGISTRY_KEY]?: INodefonyPackageInstance[];
};

/**
 * Inscrit la copie courante. Appelé UNE fois, à l'évaluation de `Nodefony.ts`.
 *
 * Idempotent par URL : un même module réévalué (rechargement de test, double
 * import par deux spécificateurs qui résolvent au même fichier) ne compte pas
 * pour deux — sinon le registre inventerait une dualité qui n'existe pas.
 *
 * @param url - `import.meta.url` du module appelant.
 * @param version - version du paquet de cette copie.
 */
export function registerPackageInstance(url: string, version: string): void {
  const scope = globalThis as TGlobalWithRegistry;
  // Alloc au PREMIER enregistrement seulement : dans le cas normal (une seule
  // copie) le registre est un tableau d'une entrée, posé une fois par process.
  const known = scope[REGISTRY_KEY] ?? (scope[REGISTRY_KEY] = []);
  if (known.some((entry) => entry.url === url)) return;
  known.push({ url, version });
}

/**
 * Les copies inscrites, dans leur ordre d'évaluation.
 *
 * @returns la liste des copies — au moins une dès que `Nodefony` est chargé.
 */
export function listPackageInstances(): readonly INodefonyPackageInstance[] {
  return (globalThis as TGlobalWithRegistry)[REGISTRY_KEY] ?? [];
}

/**
 * Y a-t-il plus d'une copie du paquet dans ce process ?
 *
 * @returns `true` si le process porte au moins deux copies distinctes.
 */
export function isPackageDuplicated(): boolean {
  return listPackageInstances().length > 1;
}

/**
 * Texte destiné à un humain décrivant la dualité constatée — les chemins des
 * copies d'abord, parce que c'est la seule information qui permette d'agir.
 *
 * Le geste proposé n'est pas décoratif : sans lui, celui qui lit le message
 * sait qu'il a un problème mais pas lequel de ses deux `nodefony` s'exécute.
 *
 * @returns le texte, ou `null` s'il n'y a qu'une copie (rien à dire).
 */
export function packageDualityReport(): string | null {
  const copies = listPackageInstances();
  if (copies.length < 2) return null;
  const list = copies
    .map((c, i) => `  ${i + 1}. ${c.url} (version ${c.version})`)
    .join("\n");
  return (
    `${copies.length} copies du paquet \`nodefony\` sont chargées dans ce ` +
    `process :\n${list}\n` +
    "Chacune a ses propres classes, son contexte de requête et ses registres " +
    "d'injection : les modules chargés par l'une sont invisibles à l'autre, " +
    "et un service construit à la frontière perd son container SANS erreur. " +
    "Causes usuelles : un binaire `nodefony` lié globalement vers un autre " +
    "dossier (`npm link`, un lien dans `~/.local/bin`), deux versions dans " +
    "l'arbre npm, un monorepo dont deux paquets ne partagent pas leur " +
    "dépendance. `NF_CLI_DEBUG=1 nodefony --version` dit quel CLI s'exécute."
  );
}
