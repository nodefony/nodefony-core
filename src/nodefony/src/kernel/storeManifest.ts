import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Ce qu'un module DÉCLARE, dans son `package.json`, de son rapport aux magasins
 * du framework (sessions, jetons, passkeys, audit, 2FA, idempotence).
 *
 * La déclaration vit chez le module — jamais dans une liste tenue par le cœur —
 * pour que l'écosystème l'étende sans nous : un adaptateur tiers annonce ce
 * qu'il couvre, et le framework le croit sur parole.
 *
 * ```json
 * { "nodefony": { "storeKind": "durable", "stores": ["session", "tokens"] } }
 * { "nodefony": { "consumesStores": true } }
 * ```
 */
export interface IStoreManifest {
  /** Le module FOURNIT des magasins (la clé `nodefony.stores` est déclarée). */
  provides: boolean;
  /**
   * Nature des magasins fournis. `durable` = adossé à une base que le module
   * CONNECTE lui-même (Drizzle, Mongoose) ; `cache` = fabriques posées dans un
   * registre, sans connexion à attendre (Redis).
   */
  storeKind: "durable" | "cache";
  /** Briques couvertes — `session`, `user`, `tokens`, `audit`, `totp`… */
  stores: string[];
  /**
   * Le module CONSOMME les magasins des autres à son propre démarrage — il doit
   * donc être déclaré APRÈS eux dans le manifeste `modules`.
   */
  consumesStores: boolean;
}

/**
 * Lit la déclaration `nodefony` d'un `package.json` déjà analysé.
 *
 * Fonction PURE : elle ne touche pas au disque, ce qui la rend éprouvable sans
 * arborescence de paquets — et laisse chaque appelant choisir sa façon de lire
 * (synchrone côté plan d'administration, asynchrone au boot).
 *
 * @param raw - contenu d'un `package.json` (objet déjà analysé).
 * @returns la déclaration, ou `null` si le module ne dit rien des magasins.
 */
export function parseStoreManifest(raw: unknown): IStoreManifest | null {
  if (!raw || typeof raw !== "object") return null;
  const nf = (raw as { nodefony?: unknown }).nodefony;
  if (!nf || typeof nf !== "object") return null;
  const meta = nf as {
    storeKind?: unknown;
    stores?: unknown;
    consumesStores?: unknown;
  };
  const provides = Array.isArray(meta.stores);
  const consumesStores = meta.consumesStores === true;
  // Ni fournisseur ni consommateur : le module n'a rien à voir avec les
  // magasins, et le dire par `null` évite d'allouer pour les 15 autres.
  if (!provides && !consumesStores) return null;
  return {
    provides,
    storeKind: meta.storeKind === "cache" ? "cache" : "durable",
    stores: provides
      ? (meta.stores as unknown[]).filter(
          (s): s is string => typeof s === "string",
        )
      : [],
    consumesStores,
  };
}

/** Une entrée du manifeste `modules`, avec ce que son paquet déclare. */
export interface IStoreManifestEntry {
  name: string;
  manifest: IStoreManifest | null;
}

/** Le fournisseur fautif et le consommateur qu'il aurait dû précéder. */
export interface IStoreOrderFault {
  /** Module qui FOURNIT des magasins durables, déclaré trop tard. */
  provider: string;
  /** Rang du fournisseur dans le manifeste (0-indexé, après gating). */
  providerIndex: number;
  /** Module qui les CONSOMME, déclaré avant lui. */
  consumer: string;
  /** Rang du consommateur dans le manifeste. */
  consumerIndex: number;
}

/**
 * Cherche un fournisseur de magasins **durables** déclaré APRÈS un module qui
 * les consomme.
 *
 * **Pourquoi cette garde existe.** `@nodefony/security` fabrique ses magasins à
 * son propre démarrage ; un ORM déclaré après lui n'est pas encore connecté à
 * cet instant, et chaque brique durable retombe en mémoire — _fail-soft_. Le
 * serveur démarre quand même, écoute, répond `200`, et a perdu ses jetons, ses
 * passkeys, son journal d'audit et son second facteur. Rien dans le trafic ne
 * le dit : c'est un `WARNING` au boot, au milieu de cent autres lignes.
 *
 * La doctrine du dépôt est fail-soft sur la DISPONIBILITÉ, fail-loud sur la
 * DÉGRADATION. Un ORM injoignable est une indisponibilité — on démarre. Un ORM
 * écrit au mauvais rang est une faute de manifeste, déterministe et corrigible
 * en déplaçant une ligne : on refuse.
 *
 * Seuls les fournisseurs `durable` sont visés. Un fournisseur `cache` (Redis)
 * ne pose que des fabriques dans un registre, sans connexion à attendre : il
 * vit aujourd'hui APRÈS `@nodefony/security` dans ce dépôt, et il y fonctionne.
 * Élargir la garde à lui refuserait un manifeste qui marche.
 *
 * Fonction PURE — l'ordre et les déclarations sont injectés, donc éprouvable
 * sans paquet installé ni disque.
 *
 * @param entries - entrées du manifeste, dans l'ordre de chargement RÉSOLU
 *   (après gating `policy`/`when` : un module écarté ne fournit rien).
 * @returns la première faute rencontrée, ou `null` si l'ordre se tient.
 */
export function findStoreOrderFault(
  entries: readonly IStoreManifestEntry[],
): IStoreOrderFault | null {
  let consumerIndex = -1;
  let consumer = "";
  for (let i = 0; i < entries.length; i++) {
    const manifest = entries[i]?.manifest;
    if (!manifest) continue;
    if (consumerIndex === -1 && manifest.consumesStores) {
      consumerIndex = i;
      consumer = entries[i].name;
      continue;
    }
    if (
      consumerIndex !== -1 &&
      manifest.provides &&
      manifest.storeKind === "durable"
    ) {
      return {
        provider: entries[i].name,
        providerIndex: i,
        consumer,
        consumerIndex,
      };
    }
  }
  return null;
}

/**
 * Rédige le CONSTAT : ce qui est fautif, ce que ça coûte, et le geste exact qui
 * répare. Le remède est une ligne à déplacer — le dire évite la demi-heure
 * passée à chercher pourquoi une session ne survit pas à un redémarrage.
 *
 * Le texte est NEUTRE, sans verbe de décision : c'est l'appelant qui tranche, et
 * les deux ne tranchent pas pareil. Le boot REFUSE — à son instant, poursuivre
 * livrerait un serveur amputé. Le diagnostic à froid SIGNALE : il n'a rien
 * empêché, et écrire « refusé » dans un rapport qui n'a rien refusé ferait
 * chercher un démarrage qui n'a pas eu lieu.
 *
 * @param fault - la faute constatée par {@link findStoreOrderFault}.
 * @returns le message destiné à celui qui a écrit le manifeste.
 */
export function storeOrderFaultMessage(fault: IStoreOrderFault): string {
  return (
    `"${fault.provider}" (rang ${fault.providerIndex + 1}) ` +
    `fournit des magasins DURABLES et est déclaré APRÈS "${fault.consumer}" ` +
    `(rang ${fault.consumerIndex + 1}), qui les consomme à son démarrage.\n` +
    `À ce rang, l'ORM n'est pas encore connecté quand "${fault.consumer}" fabrique ` +
    `ses magasins : sessions, jetons, passkeys, audit et second facteur retombent ` +
    `en MÉMOIRE, et le serveur sert quand même du trafic sans eux.\n` +
    `Remède : déplacer "${fault.provider}" AVANT "${fault.consumer}" dans ` +
    `\`modules\` — un ORM se déclare en tête.`
  );
}

/**
 * Extrait, dans l'ORDRE, les noms de paquets déclarés par le bloc `modules: [ … ]`
 * d'un manifeste — depuis son TEXTE, sans rien évaluer.
 *
 * Pourquoi lire le texte : `nodefony doctor` doit répondre sur une application
 * **qui ne démarre plus**, c'est précisément là qu'on le consulte. Évaluer le
 * manifeste exigerait le boot que le diagnostic remplace.
 *
 * La lecture est bornée au bloc `modules`, jamais au fichier entier : un
 * `import { … } from "@nodefony/drizzle"` en tête placerait l'ORM avant tout le
 * monde et ferait conclure à un ordre sain. On équilibre donc les crochets
 * depuis le `[` qui suit `modules:`.
 *
 * Limite ASSUMÉE : un nom construit à l'exécution (variable, concaténation)
 * n'est pas vu — il n'y a pas de littéral à lire. Le contrôle rend alors un
 * ordre incomplet, donc au pire silencieux ; il ne peut pas accuser à tort.
 * Le boot, lui, voit la liste résolue : c'est lui qui tranche pour de bon.
 *
 * @param source - texte du manifeste, commentaires DÉJÀ retirés (un paquet cité
 *   dans un commentaire passerait sinon pour déclaré).
 * @returns les noms de paquets, dans l'ordre du manifeste, sans doublon.
 */
export function extractManifestModuleOrder(source: string): string[] {
  const start = /\bmodules\s*:\s*\[/u.exec(source);
  if (!start) return [];
  let depth = 0;
  let end = -1;
  for (let i = start.index + start[0].length - 1; i < source.length; i++) {
    const c = source[i];
    if (c === "[") depth++;
    else if (c === "]") {
      depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  if (end === -1) return [];
  // Le `]` fermant est INCLUS : le dernier élément du tableau n'est suivi de
  // rien d'autre, et l'exclure le rendait invisible — un ORM écrit en queue de
  // manifeste, c'est-à-dire le cas même qu'on traque.
  const block = source.slice(start.index, end + 1);
  const names: string[] = [];
  const seen = new Set<string>();
  // Un nom de module se reconnaît à sa POSITION, jamais à sa seule forme : un
  // manifeste porte aussi `policy: "dev"` et `"mandatory"`, qui ont la forme
  // d'un nom de paquet. Trois positions, et trois seulement — la chaîne nue
  // d'un élément du tableau, le premier argument de `use(…)`, la clé `name:`.
  const POSITIONS =
    /use\s*\(\s*["'`]([^"'`]+)["'`]|\bname\s*:\s*["'`]([^"'`]+)["'`]|[[,]\s*["'`]([^"'`]+)["'`]\s*(?=[,\]])/gu;
  for (const m of block.matchAll(POSITIONS)) {
    const quoted = m.at(1) ?? m.at(2) ?? m.at(3);
    if (!quoted) continue;
    if (!/^(?:@[a-z0-9-~][\w.-]*\/)?[a-z0-9-~][\w.-]*$/u.test(quoted)) continue;
    if (seen.has(quoted)) continue;
    seen.add(quoted);
    names.push(quoted);
  }
  return names;
}

/**
 * Lit la déclaration d'un module INSTALLÉ, sans rien résoudre ni importer.
 *
 * Voie SYNCHRONE, pour `nodefony doctor` : le diagnostic est une lecture pure,
 * il doit répondre sur une application qui ne démarre plus, et il ne peut donc
 * pas s'appuyer sur la résolution de modules. Le boot, lui, prend la voie
 * asynchrone ({@link readStoreManifest}) — seule l'I/O diffère, l'ANALYSE est
 * la même fonction pour les deux.
 *
 * @param projectRoot - racine de l'application.
 * @param moduleName - nom du paquet, tel qu'écrit dans le manifeste.
 * @returns la déclaration, ou `null` si le paquet n'est pas installé là, ou muet.
 */
export function readInstalledStoreManifest(
  projectRoot: string,
  moduleName: string,
): IStoreManifest | null {
  try {
    return parseStoreManifest(
      JSON.parse(
        readFileSync(
          path.join(
            projectRoot,
            "node_modules",
            ...moduleName.split("/"),
            "package.json",
          ),
          "utf8",
        ),
      ),
    );
  } catch {
    return null;
  }
}

/**
 * Localise le `package.json` d'un module résolu DEPUIS l'application, puis rend
 * sa déclaration de magasins.
 *
 * `require.resolve("<pkg>/package.json")` ne marche pas : un paquet moderne ne
 * publie pas ce sous-chemin dans ses `exports` (`ERR_PACKAGE_PATH_NOT_EXPORTED`).
 * On résout donc le point d'entrée, puis on remonte jusqu'au `package.json` qui
 * porte le bon `name` — ce qui traverse aussi bien un hoisting npm qu'un magasin
 * pnpm ou un workspace lié.
 *
 * @param appRoot - racine de l'application (`kernel.path`).
 * @param moduleName - nom du paquet, tel qu'écrit dans le manifeste.
 * @returns la déclaration, ou `null` si le paquet est introuvable ou muet.
 */
export async function readStoreManifest(
  appRoot: string,
  moduleName: string,
): Promise<IStoreManifest | null> {
  let entry: string;
  try {
    entry = createRequire(path.join(appRoot, "package.json")).resolve(
      moduleName,
    );
  } catch {
    // Paquet absent : ce n'est pas à cette garde de le dire — le chargement
    // s'en chargera, avec son propre message.
    return null;
  }
  let dir = path.dirname(entry);
  // Borne HAUTE : on s'arrête à la racine du volume, jamais sur un compteur en
  // dur — une arborescence pnpm est plus profonde qu'on ne le croit.
  for (;;) {
    try {
      const raw = JSON.parse(
        await readFile(path.join(dir, "package.json"), "utf8"),
      ) as { name?: unknown };
      if (raw.name === moduleName) return parseStoreManifest(raw);
    } catch {
      // Pas de `package.json` lisible ici : on continue de remonter.
    }
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}
