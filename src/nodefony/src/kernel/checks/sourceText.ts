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
import { existsSync, readFileSync, readdirSync } from "node:fs";
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
 * pourquoi. Une CHAÎNE (`"…"`, `'…'`, `` `…` ``) est copiée telle quelle :
 * ce qu'elle contient n'ouvre ni ne ferme un commentaire.
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
  // Une seule passe, de gauche à droite. Les deux expressions régulières qui
  // vivaient ici retiraient les blocs `/* … */` AVANT les lignes `// …` : un
  // `/*` écrit DANS une ligne de commentaire (`// … /api/*)`) ouvrait alors un
  // faux bloc, refermé des centaines de lignes plus bas — et le manifeste de
  // ce dépôt passait de 31 000 à 2 800 caractères, `keystore` compris.
  // Constaté par `security:secrets`, qui déclarait non câblé ce qui l'était.
  // Une chaîne est copiée telle quelle : `"https://…"` et `'// pas un
  // commentaire'` n'ouvrent rien.
  const n = source.length;
  let out = "";
  let i = 0;
  while (i < n) {
    const c = source[i] as string;
    const d = source[i + 1];
    if (c === '"' || c === "'" || c === "`") {
      let j = i + 1;
      while (j < n) {
        const e = source[j];
        if (e === "\\") {
          j += 2;
          continue;
        }
        if (e === c) {
          j += 1;
          break;
        }
        if (e === "\n" && c !== "`") break;
        j += 1;
      }
      out += source.slice(i, j);
      i = j;
      continue;
    }
    if (c === "/" && d === "*") {
      const end = source.indexOf("*/", i + 2);
      i = end < 0 ? n : end + 2;
      continue;
    }
    if (c === "/" && d === "/" && source[i - 1] !== ":") {
      const end = source.indexOf("\n", i);
      i = end < 0 ? n : end;
      continue;
    }
    out += c;
    i += 1;
  }
  return out;
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

/**
 * LE lecteur du disque — l'implémentation unique que les contrôles, le
 * scaffold hors simulation et les bancs passent à {@link readManifestSources}.
 *
 * Il était recopié trois fois (`surface`, `wiring`, un banc) : trois objets
 * identiques aujourd'hui, trois façons de diverger demain — sur la lecture
 * d'un lien symbolique, d'un dossier illisible, d'un encodage.
 */
export const diskManifestReader: IManifestReader = {
  exists: (file) => existsSync(file),
  read: (file) => readFileSync(file, "utf8"),
  listDir: (dir) =>
    readdirSync(dir, { withFileTypes: true }).map((e) => ({
      name: e.name,
      isDirectory: e.isDirectory(),
    })),
};

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
  if (isReservedFragmentName(name)) return false;
  return true;
}

/**
 * Le nom appartient-il au chargement d'un MODULE, et non à un fragment ?
 *
 * `config.ts` et `*.config.ts` sont ce qu'un module importe lui-même
 * (`nodefony create module` les produit) ; un fragment de manifeste se nomme
 * `<module>.ts`. C'est LA définition de la réserve — le lecteur l'applique
 * pour écarter, `doctor` pour signaler.
 *
 * @param name - le nom de fichier, sans son dossier.
 * @returns `true` si le nom est réservé.
 */
export function isReservedFragmentName(name: string): boolean {
  return name === "config.ts" || name.endsWith(".config.ts");
}

/**
 * Les fichiers de `<app>/nodefony/config/` qui portent un nom RÉSERVÉ — hors
 * sous-dossiers, dont `cluster/`, lu par chemin par le process maître.
 *
 * Un tel fichier est ignoré par tous les lecteurs du manifeste ET chargé par
 * personne : `<app>/nodefony/config/config.ts` n'est importé par aucune
 * convention du cœur. Le silence est la pire des réponses ; `doctor` le
 * signale (#299).
 *
 * @param projectRoot - racine de l'application.
 * @param reader - de quoi lire.
 * @returns les chemins absolus, triés — vide sans manifeste racine.
 */
/**
 * Les fichiers `.ts` du dossier d'extraction qui passent un filtre — hors
 * sous-dossiers, dont `cluster/`, lu par chemin par le process maître.
 *
 * UNE implémentation du parcours : trois lecteurs le faisaient chacun de leur
 * côté (les fragments, les noms réservés, et maintenant la garde `satisfies`).
 * Trois copies ne divergent jamais bruyamment — elles divergent sur le lien
 * symbolique, le dossier illisible, l'ordre de tri, et chacune passe ses
 * propres tests.
 *
 * @param projectRoot - racine de l'application.
 * @param reader - de quoi lire.
 * @param keep - le filtre appliqué au NOM du fichier.
 * @returns les chemins absolus, triés — vide sans manifeste racine.
 */
function fragmentDirFiles(
  projectRoot: string,
  reader: IManifestReader,
  keep: (name: string) => boolean,
): string[] {
  if (!reader.exists(path.join(projectRoot, "nodefony.config.ts"))) return [];
  const dir = path.join(projectRoot, ...EXTRACT_DIR);
  if (!reader.exists(dir)) return [];
  let entries: { name: string; isDirectory: boolean }[];
  try {
    entries = reader.listDir(dir);
  } catch {
    // Dossier illisible : on rend ce qu'on a. Un contrôle amputé vaut mieux
    // qu'un `doctor` qui refuse de répondre — il tourne précisément quand
    // l'application ne va pas bien.
    return [];
  }
  return (
    entries
      .filter(
        (e) =>
          !e.isDirectory &&
          e.name.endsWith(".ts") &&
          !e.name.endsWith(".d.ts") &&
          keep(e.name),
      )
      .map((e) => path.join(dir, e.name))
      // Trié par nom : deux exécutions sur la même arborescence doivent rendre
      // le même ordre, sinon un rapport diffère d'une machine à l'autre.
      .sort()
  );
}

/**
 * Les fichiers de `<app>/nodefony/config/` qui portent un nom RÉSERVÉ — hors
 * sous-dossiers, dont `cluster/`, lu par chemin par le process maître.
 *
 * Un tel fichier est ignoré par tous les lecteurs du manifeste ET chargé par
 * personne : `<app>/nodefony/config/config.ts` n'est importé par aucune
 * convention du cœur. Le silence est la pire des réponses ; `doctor` le
 * signale (#299).
 *
 * @param projectRoot - racine de l'application.
 * @param reader - de quoi lire.
 * @returns les chemins absolus, triés — vide sans manifeste racine.
 */
export function reservedFragmentFiles(
  projectRoot: string,
  reader: IManifestReader,
): string[] {
  return fragmentDirFiles(projectRoot, reader, isReservedFragmentName);
}

/**
 * Un fragment EXPORTE-t-il une fonction ? C'est ce qui en fait une config de
 * module, plutôt qu'une constante partagée entre plusieurs fragments.
 *
 * Lecture textuelle, sur le CODE : ces contrôles répondent quand rien ne
 * s'évalue.
 */
const EXPORTS_FUNCTION_RE =
  /export\s+(?:default\s+)?(?:async\s+)?function\s|export\s+(?:const|let|var)\s+[A-Za-z_$][\w$]*(?:\s*:[^=]+)?\s*=\s*(?:async\s*)?(?:\(|function\b|[A-Za-z_$][\w$]*\s*=>)/u;

/**
 * Les fragments qui rendent une configuration SANS `satisfies`.
 *
 * ## Pourquoi cette garde existe
 *
 * Écrite dans le manifeste, `use("@nodefony/http", { … })` fait vérifier le
 * littéral AU POINT D'APPEL : une clé inconnue est refusée par TypeScript
 * (excess property check). Extraire ce bloc vers une fonction fait PERDRE ce
 * contrôle sans que rien ne le dise — le typage contextuel du retour ne le
 * déclenche jamais. La clé inconnue compile alors, puis Zod la retire EN
 * SILENCE au boot, et le module démarre sur son défaut : c'est le défaut
 * `trustProxi` en grand, et il est indétectable à la lecture.
 *
 * Aucune signature du cœur ne peut rattraper cela — seul `satisfies` sur le
 * littéral rétablit le contrôle, et seul un contrôle TEXTUEL peut l'exiger.
 * L'extraction n'ajoute donc pas de sûreté : elle en retire une, que
 * `satisfies` rend. C'est la seule raison pour laquelle cette garde est ici.
 *
 * @param projectRoot - racine de l'application.
 * @param reader - de quoi lire.
 * @returns les chemins absolus, triés — vide sans manifeste racine.
 */
export function fragmentsWithoutSatisfies(
  projectRoot: string,
  reader: IManifestReader,
): string[] {
  return fragmentDirFiles(projectRoot, reader, isExtractedManifest).filter(
    (file) => {
      let code: string;
      try {
        code = withoutComments(reader.read(file));
      } catch {
        // Fragment illisible : il est déjà signalé ailleurs, et accuser un
        // fichier qu'on n'a pas lu enverrait corriger à l'aveugle.
        return false;
      }
      if (!EXPORTS_FUNCTION_RE.test(code)) return false;
      return !/\bsatisfies\b/u.test(code);
    },
  );
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
 * ## La doctrine — écrite ICI une fois, et nulle part ailleurs
 *
 * - **Ce qu'un fragment porte** : des OPTIONS — le bloc de configuration d'un
 *   module (`security`, `http`, `connectors`…), rendu par une fonction que le
 *   manifeste racine importe et passe à `use()`.
 * - **Ce qui reste dans la racine** : l'INDEX `modules`, c'est-à-dire les
 *   `use()` eux-mêmes, dans leur ordre. C'est là que le générateur câble un
 *   module neuf (`wireModuleManifest`), et là que `nodefony doctor` lit ce
 *   qui est déclaré. Un `use()` déplacé dans un fragment n'est pas interdit,
 *   mais il n'est pas la convention, et aucun outil ne l'y écrira.
 * - **Pourquoi les lecteurs lisent tout de même l'ENSEMBLE** : un contrôle
 *   qui ne lirait que la racine deviendrait aveugle le jour où un bloc est
 *   extrait, sans un mot ; et un `use()` égaré dans un fragment doit être vu
 *   plutôt que déclaré manquant. Lire large coûte trois fichiers ; se tromper
 *   coûte un faux « tout va bien ».
 * - **Un fragment ne vaut que parce que le manifeste le NOMME** : sans
 *   `nodefony.config.ts`, rien n'est un fragment — un paquet de module lancé
 *   seul porte `nodefony/config/defineModuleConfig.ts`, `services.ts`,
 *   `routing.ts`, qui ne sont pas des morceaux d'un manifeste absent.
 * - **La réserve de noms** : `config.ts` et `*.config.ts` appartiennent au
 *   chargement d'un MODULE (voir {@link isExtractedManifest}) ; un fragment se
 *   nomme `<module>.ts`. Un fragment au nom réservé est ignoré ici — et
 *   `doctor` le signale (#299), parce qu'il ne serait chargé par personne.
 *
 * @param projectRoot - racine de l'application (celle qui porte `nodefony.config.ts`).
 * @param reader - de quoi lire ; {@link diskManifestReader} hors simulation.
 * @returns le manifeste puis ses fragments, chacun avec son chemin ; VIDE si
 *   l'application n'a pas de manifeste racine — fragments compris.
 */
export function readManifestSources(
  projectRoot: string,
  reader: IManifestReader,
): IManifestSource[] {
  const out: IManifestSource[] = [];
  const root = path.join(projectRoot, "nodefony.config.ts");
  if (!reader.exists(root)) {
    return out;
  }
  out.push({ path: root, source: reader.read(root) });
  for (const file of fragmentDirFiles(
    projectRoot,
    reader,
    isExtractedManifest,
  )) {
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
 * Le motif est cherché dans le CODE de chaque source, commentaires retirés.
 * Sur le texte brut, le manifeste de ce dépôt — qui porte un exemple
 * `mongoose` entièrement commenté contenant `connectors: {` — « portait » le
 * motif et gagnait toujours : le fragment qui porte le vrai bloc n'était
 * jamais lu, c'est-à-dire exactement la panne que cette fonction existe pour
 * empêcher, réintroduite par elle-même.
 *
 * @param projectRoot - racine de l'application.
 * @param reader - de quoi lire ; le scaffold passe son écrivain (simulation).
 * @param pattern - ce qu'on cherche, appliqué au CODE de chaque source.
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
      new RegExp(pattern.source, pattern.flags.replace("g", "")).test(
        withoutComments(source),
      )
    ) {
      return file;
    }
  }
  return path.join(projectRoot, "nodefony.config.ts");
}

/**
 * Le CODE du manifeste entier — racine puis fragments, commentaires retirés,
 * concaténés — pour les lecteurs qui cherchent un motif sans avoir à savoir
 * quel fichier le porte (`security:secrets`, l'état d'installation).
 *
 * @param projectRoot - racine de l'application.
 * @param reader - de quoi lire.
 * @returns le code, ou la chaîne vide sans manifeste.
 */
export function readManifestCode(
  projectRoot: string,
  reader: IManifestReader,
): string {
  return readManifestSources(projectRoot, reader)
    .map((m) => withoutComments(m.source))
    .join("\n");
}
