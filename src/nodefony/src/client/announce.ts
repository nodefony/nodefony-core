/**
 * Annonce du framework dans la console du navigateur — **sans kernel obligatoire**.
 *
 * Une page qui emploie Nodefony doit pouvoir le DIRE, et se laisser inspecter,
 * même quand elle n'a pris aucun noyau. C'est la révision de l'ADR-0007 **D7**
 * (« le kernel compose, il n'impose pas ») dans le sens qui manquait : l'opt-in
 * strict porte sur la COMPOSITION, jamais sur le diagnostic. Un développeur qui
 * tape `nodefony` dans sa console et obtient `undefined` conclut que le
 * framework n'est pas chargé — alors que sa socket tourne.
 *
 * Deux entrées, une seule sortie :
 *  - {@link announceKernel} — un noyau existe : son nom porte le badge, et il
 *    devient le sujet du handle ;
 *  - {@link announceRealtime} — une socket vit nue : le badge sort quand même.
 *
 * **Le badge n'est émis qu'UNE fois par page.** Le noyau s'annonce dans son
 * constructeur, donc avant de composer sa socket : quand il y en a un, c'est
 * toujours son nom qui s'affiche.
 *
 * **Aucune rétention nouvelle** : le handle ne garde pas les sockets, il lit le
 * registre que `RealtimeClient.shared()` tient déjà (`globalThis.__nfRealtime__`).
 * Une socket construite hors du partage fait sortir le badge mais n'apparaît pas
 * dans `sockets()` — la retenir ici en ferait une fuite pour un confort.
 *
 * @module nodefony/client
 */
import type { RealtimeClient } from "./realtime/RealtimeClient";

/** Ce que `nodefony` rend dans la console. Dev uniquement — jamais publié. */
interface NodefonyConsoleHandle {
  /** Le noyau vivant, s'il y en a un. */
  readonly kernel?: unknown;
  /** La première socket partagée — le raccourci du cas courant. */
  readonly socket?: RealtimeClient;
  /** Les sockets partagées de la page : adresse et état. */
  sockets(): Array<{ url: string; state: string }>;
  /** L'identité courante — du noyau s'il y en a un, sinon de la socket. */
  identity(): unknown;
}

/**
 * Noyau vivant — `null` sans noyau, ce qui est le cas d'une vitrine.
 *
 * Seul état de module : le noyau a une mort observable (`terminate()`), donc un
 * débranchement fiable. Une socket n'en a pas — elle vit avec la page —, et un
 * compteur qu'on ne décrémenterait jamais aurait rendu le badge irréarmable d'un
 * banc à l'autre : le marqueur ci-dessous vit sur `globalThis`, où une page
 * neuve le retrouve absent et un banc peut le retirer.
 */
let kernelVivant: { identity?: unknown } | null = null;

/** Le badge est-il déjà sorti sur cette page ? Posé même en production. */
function dejaAnnonce(): boolean {
  return (globalThis as { __nfAnnounced__?: boolean }).__nfAnnounced__ === true;
}

/**
 * Mode annoncé par le SERVEUR au handshake temps réel — `null` tant qu'aucune
 * socket n'a reçu d'accueil.
 *
 * Il existe parce que `import.meta.env.DEV` ne dit que le mode du BUNDLE : une
 * application bâtie pour la production mais servie par un serveur de
 * développement (banc, `--cluster`, image testée localement) se taisait alors
 * qu'on avait tout intérêt à la faire parler. Le serveur, lui, sait.
 */
let envServeur: string | null = null;

/**
 * Le détail est-il sorti sur cette page ? Un seul par page, comme le badge — et
 * c'est le noyau qui gagne quand il y en a un.
 *
 * Sur `globalThis` et non en variable de module, pour la même raison que le
 * badge : un module vit plus longtemps qu'une page dans un banc, et un état qui
 * ne se réarme pas fait passer les tests suivants pour des régressions.
 */
function dejaDetaille(): boolean {
  return (globalThis as { __nfDetailed__?: boolean }).__nfDetailed__ === true;
}

/**
 * Le mode annoncé par le serveur, quand il en annonce un.
 *
 * ⚠️ Le serveur **ne pose ce champ qu'en dehors de la production** : une absence
 * vaut donc production, jamais l'inverse. C'est la même règle que pour le
 * bundle, et pour la même raison — se taire à tort ne coûte qu'une ligne, parler
 * à tort expose la console de tout le monde.
 *
 * @param env - la valeur reçue dans `realtime:welcome`, ou `undefined`.
 */
export function noteServerEnv(env: string | undefined): void {
  if (env) envServeur = env;
}

/**
 * Peut-on se permettre le détail ? Bundle de développement, OU serveur qui
 * annonce un mode hors production.
 */
export function isVerbose(): boolean {
  return isDevBuild() || (envServeur !== null && envServeur !== "production");
}

/**
 * Le bundle a-t-il été bâti en développement ?
 *
 * Le mode se LIT, il ne se devine pas : `import.meta.env.DEV` est posé par le
 * bundler de l'application (Vite le remplace par une constante au build). Hors
 * bundler il n'existe pas — et **l'absence de preuve de développement se traite
 * comme la production**, jamais l'inverse : se taire à tort ne coûte qu'une
 * ligne manquante, parler à tort pollue la console de tout le monde.
 */
export function isDevBuild(): boolean {
  return (import.meta as { env?: { DEV?: boolean } }).env?.DEV === true;
}

/** Les sockets partagées, lues dans le registre de `RealtimeClient.shared()`. */
function socketsPartagees(): RealtimeClient[] {
  const g = globalThis as { __nfRealtime__?: Map<string, RealtimeClient> };
  return g.__nfRealtime__ ? [...g.__nfRealtime__.values()] : [];
}

/**
 * Pose ou actualise `globalThis.nodefony`.
 *
 * Développement seulement : la console d'une application publiée appartient à
 * ses développeurs, et un handle global y serait une surface offerte pour rien.
 */
function poseHandle(): void {
  if (!isVerbose()) return;
  const handle: NodefonyConsoleHandle = {
    get kernel() {
      return kernelVivant ?? undefined;
    },
    get socket() {
      return socketsPartagees()[0];
    },
    sockets: () =>
      socketsPartagees().map((s) => ({
        url: s.url ?? "(adresse non résolue)",
        state: s.state,
      })),
    identity: () => {
      if (kernelVivant) return (kernelVivant as { identity: unknown }).identity;
      return socketsPartagees()[0]?.identity ?? null;
    },
  };
  (globalThis as { nodefony?: unknown }).nodefony = handle;
}

/**
 * Retire le handle et réarme le badge — appelé quand plus rien ne vit.
 *
 * « Plus rien » se CONSTATE : aucun noyau, et aucune socket dans le registre du
 * partage. Une socket construite hors `shared()` échappe à ce constat ; le seul
 * effet est qu'un badge pourrait ressortir, jamais une fuite.
 */
function libere(): void {
  const g = globalThis as { nodefony?: unknown; __nfAnnounced__?: boolean };
  delete g.nodefony;
  delete g.__nfAnnounced__;
  delete (globalThis as { __nfDetailed__?: boolean }).__nfDetailed__;
  envServeur = null;
}

/**
 * Émet le badge, au plus une fois par page.
 *
 * La forme est celle qu'ont adoptée Vue, Vite et les outils qui vivent dans une
 * console partagée : un badge en couleur sur UNE ligne. Pas de dessin en
 * caractères — celui du serveur a du sens dans un terminal qu'on ouvre une fois
 * au démarrage ; dans une console de navigateur il se répète à chaque
 * rechargement et pousse hors de vue les messages de l'application.
 *
 * @param nom - ce qui suit « nodefony » ; le nom du noyau quand il y en a un.
 */
function badge(nom: string): void {
  if (dejaAnnonce()) return;
  // Une console peut manquer (rendu côté serveur, test) : on n'annonce rien
  // plutôt que de jeter au démarrage.
  const c = globalThis.console;
  if (!c?.log) return;
  (globalThis as { __nfAnnounced__?: boolean }).__nfAnnounced__ = true;
  c.log(
    `%c◆ nodefony%c${nom}%c`,
    "background:#0b1120;color:#5eead4;font-weight:700;padding:2px 6px;border-radius:3px 0 0 3px",
    "background:#1e293b;color:#e2e8f0;padding:2px 6px;border-radius:0 3px 3px 0",
    "",
  );
}

/**
 * Annonce un noyau client : son nom porte le badge, et il devient le sujet du
 * handle. À appeler AVANT que le noyau compose sa socket, sinon c'est le badge
 * générique de la socket qui sortirait le premier.
 *
 * @param kernel - le noyau, exposé tel quel en `nodefony.kernel`.
 * @param nom - son nom, affiché dans le badge.
 * @param annoncer - `false` fait taire l'annonce ET le handle (app publiée qui
 *   ne veut rien dans sa console) ; `true` force le détail hors développement.
 * @returns le débranchement, à appeler à la mort du noyau — sans quoi un
 *   rechargement à chaud accumulerait des noyaux morts retenus par le handle.
 */
export function announceKernel(
  kernel: { identity?: unknown },
  nom: string,
  annoncer?: boolean,
): () => void {
  if (annoncer === false) return () => undefined;
  kernelVivant = kernel;
  badge(nom);
  poseHandle();
  return () => {
    if (kernelVivant !== kernel) return;
    kernelVivant = null;
    if (socketsPartagees().length === 0) libere();
    else poseHandle();
  };
}

/**
 * Annonce une socket qui vit NUE — aucune composition, aucun noyau. C'est le cas
 * des vitrines du dépôt et de tout widget qui monte une socket et rien d'autre.
 *
 * @param annoncer - `false` fait taire l'annonce (option `banner` de la socket).
 * @returns le débranchement ; une socket partagée vit avec la page et n'a pas à
 *   l'appeler — il existe pour les bancs, qui doivent repartir d'une page vierge.
 */
export function announceRealtime(annoncer?: boolean): () => void {
  if (annoncer === false) return () => undefined;
  badge("client");
  poseHandle();
  return () => {
    if (!kernelVivant && socketsPartagees().length === 0) libere();
  };
}

/**
 * Détail du framework, dans un groupe REPLIÉ de la console : un tableau
 * `clé → valeur` et les deux rappels qui font gagner du temps.
 *
 * **Un seul détail par page**, et le noyau gagne : quand il y en a un, la socket
 * ne le double pas — c'est lui qui a le plus à dire (état, identité, services).
 * Une vitrine sans noyau, elle, obtient enfin le sien : c'est la moitié
 * « diagnostic » que l'ADR-0007 D7 laissait derrière le péage de la composition.
 *
 * Le groupe est replié et non ouvert : présent pour qui le cherche, invisible
 * pour qui débogue autre chose. `groupEnd` est atteint même si une lecture
 * jette — un groupe laissé ouvert avale tous les messages suivants.
 *
 * @param lignes - le tableau à rendre, `clé → { valeur }`, composé par
 *   l'appelant : lui seul sait ce qu'il a d'important à dire.
 * @param sujet - l'objet vivant à imprimer en dernier (noyau, ou socket).
 * @param titre - l'intitulé du groupe.
 * @returns `true` si le détail a été émis.
 */
export function detailsConsole(
  lignes: Record<string, { valeur: string }>,
  sujet: unknown,
  titre: string,
): boolean {
  if (dejaDetaille() || !isVerbose()) return false;
  const c = globalThis.console;
  if (!c?.log || !c.groupCollapsed || !c.groupEnd) return false;
  (globalThis as { __nfDetailed__?: boolean }).__nfDetailed__ = true;
  c.groupCollapsed(`%c${titre}`, "color:#94a3b8");
  try {
    // `table` plutôt que des lignes : aligné, trié, dépliable — et natif.
    if (c.table) c.table(lignes);
    else for (const [k, v] of Object.entries(lignes)) c.log(k, v.valeur);
    c.log(
      "%cconsole :%c nodefony.socket · nodefony.sockets() · nodefony.identity()" +
        (kernelVivant ? " · nodefony.kernel" : ""),
      "color:#94a3b8",
      "color:#5eead4;font-family:monospace",
    );
    // L'atout que personne d'autre n'a : la même valeur relie ce navigateur au
    // journal du serveur. Le dire ICI, c'est éviter la question « comment je
    // retrouve ma requête ? » — qui se pose toujours trop tard.
    c.log(
      "%ccorrélation :%c chaque journal porte un requestId — la même valeur côté serveur relie clic, route, base et réponse",
      "color:#94a3b8",
      "color:#e2e8f0",
    );
    c.log("%cobjet :%c", "color:#94a3b8", "", sujet);
  } finally {
    c.groupEnd();
  }
  return true;
}

/** Un noyau est-il vivant sur cette page ? La socket s'efface devant lui. */
export function aUnNoyau(): boolean {
  return kernelVivant !== null;
}
