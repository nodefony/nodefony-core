/**
 * Le texte d'une source, tel que les contrôles de `doctor` doivent le lire.
 *
 * 🔴 Cette règle était écrite TROIS fois — `surface`, `readiness`, `wiring` —
 * et elle avait déjà divergé : deux copies coupaient à `//` sans condition,
 * la troisième protégeait le `//` d'une URL. Une `https://…` citée dans un
 * manifeste était donc amputée en `https:` chez deux contrôles sur trois, et
 * rien ne le disait. C'est la règle « 1 RÈGLE = 1 implémentation » du dépôt :
 * deux copies ne se contredisent jamais bruyamment, elles se contredisent en
 * silence, et chacune passe ses propres tests.
 *
 * @module
 */
import path from "node:path";

/**
 * Le CODE d'une source : son texte privé de ses commentaires.
 *
 * Un contrôle qui lit le texte brut accuse la documentation qu'il croise. Le
 * cas est vécu, et il n'est pas théorique : le contrôleur écrit par le
 * générateur EXPLIQUE `@IsGranted` dans deux commentaires sans jamais
 * l'employer — le contrôle des briques manquantes y voyait une garde
 * d'autorisation, et `npm run verify` sortait en 1 sur une application qui
 * venait de naître. Un contrôle qui accuse sa propre documentation est un
 * contrôle qu'on désactive.
 *
 * Le `//` précédé d'un `:` est PRÉSERVÉ : c'est le séparateur d'une URL, pas
 * l'ouverture d'un commentaire. Sans cette réserve, `"https://exemple.test"`
 * devient `"https:` et tout motif qui lit cette valeur échoue sans expliquer
 * pourquoi.
 *
 * La lecture reste TEXTUELLE, et c'est assumé : ces contrôles diagnostiquent
 * une application qui ne démarre pas, donc rien ne s'évalue. On y perd les
 * cas tordus — un `//` dans une chaîne, un `/*` dans une expression
 * régulière — et l'on y gagne de répondre quand rien d'autre ne répond.
 *
 * @param source - le texte du fichier, tel qu'il a été lu sur le disque.
 * @returns le même texte, commentaires retirés.
 */
export function withoutComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//gu, "")
    .replace(/(^|[^:])\/\/.*$/gmu, "$1");
}

/**
 * De quoi lire une arborescence — le disque, ou ce qu'un scaffold s'apprête à
 * écrire.
 *
 * L'injection n'est pas un confort de test : le générateur travaille sur des
 * fichiers EN ATTENTE (`ScaffoldWriter`, mode simulation). Lire le disque
 * directement lui ferait rater ce qu'il vient de produire dans le même run, et
 * la simulation cesserait de décrire ce que fera l'exécution réelle.
 * `ScaffoldWriter` satisfait ce contrat sans rien changer.
 */
export interface IManifestReader {
  /** Le fichier existe-t-il (sur disque, ou en attente d'écriture) ? */
  exists(file: string): boolean;
  /** Son contenu. */
  read(file: string): string;
  /** Les entrées d'un dossier. */
  listDir(dir: string): { name: string; isDirectory: boolean }[];
}

/** Un fichier du manifeste, et son texte. */
export interface IManifestSource {
  /** Chemin absolu — un écrivain doit savoir OÙ il a trouvé le motif. */
  path: string;
  /** Le texte, tel qu'il est sur le disque. */
  source: string;
}

/**
 * Dossier d'extraction, relatif à la racine de l'application.
 *
 * `nodefony/` plutôt que `config/` racine : tout le code d'une application y
 * vit déjà, il est dans l'`include` des deux `tsconfig` et dans le glob du
 * bundler — un fichier oublié y reste au moins typechecké.
 */
const EXTRACT_DIR = ["nodefony", "config"] as const;

/**
 * Noms que le dossier d'extraction n'accepte PAS.
 *
 * `config.ts` et `*.config.ts` sont les noms du chargement par convention d'un
 * MODULE : les accepter ici rendrait indécidable, à la lecture, si un fichier
 * est chargé tout seul par le framework ou seulement parce que le manifeste
 * l'importe. Le sous-dossier `cluster/`, lui, est lu PAR CHEMIN par le process
 * maître : c'est une autre nature, et il n'est pas parcouru.
 *
 * @param name - le nom de fichier, sans son dossier.
 * @returns `true` si le fichier est un fragment de manifeste légitime.
 */
function isExtractedManifest(name: string): boolean {
  if (!name.endsWith(".ts") || name.endsWith(".d.ts")) return false;
  if (name === "config.ts" || name.endsWith(".config.ts")) return false;
  return true;
}

/**
 * Rend TOUS les textes qui composent le manifeste d'une application.
 *
 * ⭐ TL;DR : `nodefony.config.ts` d'abord, puis les fragments de
 * `nodefony/config/*.ts`. Tout contrôle qui cherche un motif dans « la
 * configuration de l'application » passe par ici.
 *
 * **Pourquoi une fonction, et pas un chemin en dur chez chacun.** Quatre
 * instruments du produit lisent le TEXTE du manifeste à l'expression
 * régulière : le rapport de surface de `doctor` y cherche son bloc `areas` —
 * un rapport de SÉCURITÉ —, le contrôle de câblage y cherche les modules
 * montés, et le générateur y lit `connectors` et y ancre `roleHierarchy`.
 * Chacun supposait que tout tenait dans ce seul fichier. Le jour où un bloc
 * est extrait — ce que la documentation propose —, ces contrôles deviennent
 * aveugles **sans un mot** : zéro constat au lieu d'un manquement, ce qui se
 * lit « tout va bien ». C'est la panne la plus dangereuse qu'un contrôle
 * puisse avoir.
 *
 * Le manifeste racine vient TOUJOURS en premier : il reste l'index ordonné des
 * modules, et c'est lui qu'un écrivain doit choisir quand le motif ne se
 * trouve nulle part ailleurs.
 *
 * @param projectRoot - racine de l'application (celle qui porte `nodefony.config.ts`).
 * @param reader - de quoi lire ; par défaut le disque.
 * @returns le manifeste puis ses fragments, chacun avec son chemin ; vide si
 *   l'application n'a pas de manifeste.
 */
export function readManifestSources(
  projectRoot: string,
  reader: IManifestReader,
): IManifestSource[] {
  const out: IManifestSource[] = [];
  const root = path.join(projectRoot, "nodefony.config.ts");
  if (reader.exists(root)) {
    out.push({ path: root, source: reader.read(root) });
  }
  const dir = path.join(projectRoot, ...EXTRACT_DIR);
  if (!reader.exists(dir)) {
    return out;
  }
  let entries: { name: string; isDirectory: boolean }[];
  try {
    entries = reader.listDir(dir);
  } catch {
    // Dossier illisible : on rend ce qu'on a. Un contrôle amputé vaut mieux
    // qu'un `doctor` qui refuse de répondre — il tourne précisément quand
    // l'application ne va pas bien.
    return out;
  }
  // Trié par nom : deux exécutions sur la même arborescence doivent rendre le
  // même ordre, sinon un rapport diffère d'une machine à l'autre.
  const names = entries
    .filter((e) => !e.isDirectory && isExtractedManifest(e.name))
    .map((e) => e.name)
    .sort();
  for (const name of names) {
    const file = path.join(dir, name);
    try {
      out.push({ path: file, source: reader.read(file) });
    } catch {
      // idem : un fragment illisible ne fait pas taire les autres.
    }
  }
  return out;
}

/**
 * Le fichier du manifeste qui porte un motif — celui qu'un ÉCRIVAIN doit
 * modifier.
 *
 * Lire suffit à concaténer les sources ; écrire non. Le générateur ancre
 * `roleHierarchy` et lit `connectors` : le jour où ces blocs sont extraits, il
 * doit toucher le fragment, pas le manifeste racine — sinon il insère dans un
 * fichier où l'ancre n'est pas, ou pire, il n'ancre plus rien en silence.
 *
 * Quand le motif ne se trouve nulle part, c'est le manifeste RACINE qui est
 * rendu : c'est l'index de l'application, l'endroit par défaut, et l'appelant
 * y trouvera l'absence d'ancre qu'il sait déjà signaler.
 *
 * @param projectRoot - racine de l'application.
 * @param reader - de quoi lire ; le scaffold passe son écrivain (simulation).
 * @param pattern - ce qu'on cherche, appliqué au texte BRUT de chaque source.
 * @returns le chemin du fichier porteur, ou celui du manifeste racine.
 */
export function manifestFileWith(
  projectRoot: string,
  reader: IManifestReader,
  pattern: RegExp,
): string {
  const sources = readManifestSources(projectRoot, reader);
  for (const { path: file, source } of sources) {
    // `lastIndex` d'une expression globale survit d'un appel à l'autre et
    // ferait sauter une source sur deux — on ne teste jamais l'objet reçu.
    if (
      new RegExp(pattern.source, pattern.flags.replace("g", "")).test(source)
    ) {
      return file;
    }
  }
  return path.join(projectRoot, "nodefony.config.ts");
}
