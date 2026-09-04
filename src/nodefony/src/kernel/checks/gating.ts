/**
 * `doctor --env <e>` — ce qui DISPARAÎTRA là-bas, dit depuis ici.
 *
 * Un module `policy: "dev"` est retiré en production. Ce qu'il fournissait
 * disparaît avec lui — un service, un encodeur de mots de passe, une surcharge
 * de configuration — **et le boot continue**. L'application démarre, sert, et
 * une brique manque. Le dépôt a déjà payé ce défaut deux fois, assez pour lui
 * avoir écrit une règle : « une brique requise en production n'est jamais
 * fournie par un seul module `policy:"dev"` ». Rien ne l'attrapait avant la
 * production : le gating n'apparaît dans le bilan que si le DERNIER démarrage
 * était un démarrage de production — c'est-à-dire jamais, sur un poste de
 * développement.
 *
 * 🔴 **Rien n'est déduit, tout est CONSTATÉ.** La question « ce service
 * a-t-il un autre fournisseur là-bas ? » n'a pas de réponse lisible dans un
 * fichier : un défaut du framework et un module de développement posent le même
 * nom, et seul le second l'écrase. On ne la devine donc pas — on demande à un
 * boot console visant l'environnement cible, et on DIFFÉRENCIE les deux vues.
 * Un service encore là-bas est le cas sain, sans qu'aucune règle n'ait eu à le
 * dire.
 *
 * Le boot cible tourne dans un PROCESSUS À PART, et c'est structurel : poser
 * `NODE_ENV=production` dans celui-ci basculerait tout le diagnostic en
 * production — le catalogue de l'application, la fraîcheur du build, jusqu'à la
 * lecture des sources. On l'a déjà vécu une fois, et le rapport était faux sans
 * le dire.
 */
import { spawn } from "node:child_process";
import { gateModuleManifest, type IModuleGated } from "../moduleGating";
import type { GateConfig } from "../moduleGating";
import type { IExecution } from "./report";
import { engineModeOf } from "../../runtime/engineEnvironment";

/** Ce qu'un boot rend d'un service : son nom, et le module qui le porte. */
export interface IProvidedService {
  name: string;
  module: string;
}

/** Une brique que l'environnement visé fera disparaître. */
export interface IGatingFinding {
  kind: "service-lost";
  /** La phrase telle qu'elle s'affiche. */
  message: string;
  /** Le service perdu — porté pour que le JSON reste exploitable. */
  service: string;
  /** Le ou les modules qui le fournissaient ici. */
  providers: string[];
}

/** Ce que l'étage 2 a constaté du gating, et ce qu'il n'a PAS pu regarder. */
export interface IGatingResult {
  findings: IGatingFinding[];
  /** Les modules que l'environnement visé écarte — INFO, jamais un verdict. */
  gated: IModuleGated[];
  execution: IExecution;
}

/** Le résultat d'un boot console visant un environnement. */
export type ITargetProvision =
  | { ok: true; services: IProvidedService[] }
  | { ok: false; reason: string; short: string; unlock?: string };

/** Ce dont la famille a besoin pour travailler — tout est INJECTÉ. */
export interface IGatingInput {
  /** L'environnement visé (`production`), ou `null` si l'on ne vise rien. */
  targetEnv: string | null;
  /** Le manifeste `config.modules` de l'application démarrée. */
  manifest: unknown;
  /** La config fusionnée, sur laquelle chaque `when()` est évalué. */
  config: GateConfig;
  /** Les services vus ICI, tels que l'application démarrée les déclare. */
  here: IProvidedService[];
  /**
   * Ce que l'environnement visé fournit — le VERDICT d'un boot, jamais la
   * façon de l'obtenir.
   *
   * Injecté pour que la comparaison soit éprouvable sans démarrer quoi que ce
   * soit : une famille qui lance elle-même un processus ne se teste que dans un
   * environnement où ce processus aboutit, c'est-à-dire nulle part en
   * intégration continue.
   */
  readTarget: (env: string) => Promise<ITargetProvision>;
}

/**
 * L'état d'exécution quand aucun environnement n'est visé.
 *
 * Une seule rédaction, parce que deux chemins y mènent — la commande sans
 * `--env`, et la famille appelée sans cible — et que deux formulations du même
 * fait finiraient par se contredire.
 */
export const NO_TARGET: IExecution = {
  ran: false,
  reason:
    "aucun environnement visé : il n'y a rien à comparer tant qu'on ne dit " +
    "pas OÙ l'on va",
  short: "aucune cible",
  notApplicable: true,
  unlock: "`nodefony doctor --live --env production`",
};

/**
 * Les services que l'environnement visé ne fournira plus.
 *
 * Fonction PURE : c'est un DIFF de deux listes, rien de plus. Un service encore
 * présent là-bas ne lève rien, quel que soit le module qui le porte — un défaut
 * du framework qui reprend la main est exactement le cas sain que ce contrôle
 * ne doit pas signaler.
 *
 * @param here - les services de l'application telle qu'elle tourne ici.
 * @param there - les services de l'application dans l'environnement visé.
 * @param targetEnv - le nom de l'environnement visé, pour la phrase rendue.
 * @returns un manquement par service perdu, dans l'ordre alphabétique.
 */
export function lostServices(
  here: readonly IProvidedService[],
  there: readonly IProvidedService[],
  targetEnv: string,
): IGatingFinding[] {
  const survivors = new Set(there.map((s) => s.name));
  /** Les modules qui portent chaque service perdu, sans doublon. */
  const providers = new Map<string, string[]>();
  for (const service of here) {
    if (survivors.has(service.name)) continue;
    const list = providers.get(service.name);
    if (list) {
      if (!list.includes(service.module)) list.push(service.module);
    } else {
      providers.set(service.name, [service.module]);
    }
  }
  return [...providers.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, from]) => ({
      kind: "service-lost" as const,
      service: name,
      providers: from,
      message:
        `« ${name} » — fourni ici par ${from.map((m) => `« ${m} »`).join(", ")}, ` +
        `absent en ${targetEnv}`,
      // 🔴 AUCUN geste, et c'est le fond du sujet.
      //
      // Ce contrôle ne sait pas si la perte est VOULUE. Un module `policy:
      // "dev"` disparaît en production : c'est sa raison d'être, pas un
      // défaut. Le geste qui était proposé ici — « retire `policy: "dev"` » —
      // était donc pire qu'inutile : le suivre embarquerait l'outillage de
      // développement en production.
      //
      // La distinction qui manque est « ce service est-il REQUIS là-bas ? »,
      // et rien dans le produit ne permet de la déclarer : `requiredIn`
      // n'existe que pour les variables d'environnement. Tant qu'un service ne
      // peut pas dire qu'on l'exige, ce contrôle INFORME — il n'accuse pas, il
      // ne prescrit pas, et il ne pèse pas sur le code de sortie.
    }));
}

/**
 * Confronte ce que l'application fournit ICI à ce qu'elle fournira LÀ-BAS.
 *
 * Ne lève jamais : un boot cible impossible devient un état d'exécution
 * lisible. C'est la doctrine de tout l'étage 2 — le rapport statique est celui
 * dont on a besoin quand l'application va mal, et une exception l'emporterait
 * au pire moment.
 *
 * @param input - l'environnement visé, le manifeste, et les deux vues.
 * @returns les briques perdues, les modules écartés, et l'état d'exécution.
 */
export async function checkGating(input: IGatingInput): Promise<IGatingResult> {
  if (!input.targetEnv)
    return { findings: [], gated: [], execution: NO_TARGET };

  const target = input.targetEnv;
  // Ce que le manifeste dit du gating se lit SANS boot : c'est la même règle
  // que le Kernel applique au démarrage, rejouée pour l'environnement visé.
  // On la calcule avant le boot cible pour que son échec laisse quand même
  // cette moitié du diagnostic — c'est celle qui répond le plus souvent.
  const { gated } = gateModuleManifest(input.manifest, {
    // Le collapse du Kernel, APPELÉ et non recopié (`engineModeOf`) : tout ce
    // qui n'est pas « dev » tourne comme la production. Une seconde écriture
    // ferait dire à `--env staging` autre chose que ce que le conteneur de
    // préproduction produit vraiment.
    isProduction: engineModeOf(target) === "production",
    // La dérogation `NF_WITH_DEV_MODULES` n'est PAS reprise : elle décrit ce
    // poste-ci, pas le déploiement visé. La rejouer ferait dire « rien ne
    // disparaît » à cause d'une variable posée pour un banc local.
    forceDevModules: false,
    config: input.config,
  });

  const there = await input.readTarget(target);
  if (!there.ok)
    return {
      findings: [],
      gated,
      execution: {
        ran: false,
        reason: there.reason,
        short: there.short,
        ...(there.unlock ? { unlock: there.unlock } : {}),
      },
    };

  return {
    findings: lostServices(input.here, there.services, target),
    gated,
    execution: { ran: true },
  };
}

/** Ce qu'il faut pour lancer le boot cible — injecté, jamais lu ici. */
export interface ITargetBootInput {
  /** L'interpréteur à relancer (`process.execPath`). */
  execPath: string;
  /** Le binaire `nodefony` en cours (`process.argv[1]`). */
  binPath: string;
  /** La racine de l'application. */
  cwd: string;
  /** L'environnement du processus courant, dont la cible hérite. */
  env: Record<string, string | undefined>;
  /** Délai au-delà duquel on renonce (défaut : 120 s). */
  timeoutMs?: number;
}

/** Le délai au-delà duquel un boot cible qui n'a pas répondu est abandonné. */
export const TARGET_BOOT_TIMEOUT_MS = 120_000;

/**
 * Demande à un boot console visant `env` ce qu'il fournit.
 *
 * `nodefony inspect services --json` et rien d'autre : c'est le producteur que
 * la console d'administration et `inspect` lisent déjà, et le dépôt interdit
 * d'en écrire une seconde version. Le sous-processus n'ouvre aucun port (profil
 * console) — il cohabite donc avec un serveur de développement en marche.
 *
 * ⚠️ Les deux étiquettes sont posées ENSEMBLE (`NODE_ENV` et `NF_ENV`) : le
 * mode d'exécution décide du gating `policy`, l'environnement de déploiement
 * décide des surcharges de configuration et des `when()`. N'en poser qu'une
 * ferait diagnostiquer un environnement qui n'existe nulle part.
 *
 * @param input - de quoi relancer le binaire courant.
 * @returns ce que l'environnement visé fournit, ou la raison de son silence.
 */
/**
 * L'environnement du boot cible, dérivé de celui d'ici.
 *
 * Extrait pour être ÉPROUVÉ : la seule autre façon de constater ce qu'un
 * sous-processus reçoit est de le démarrer, c'est-à-dire de ne le vérifier que
 * là où il aboutit.
 *
 * @param env - l'environnement du processus courant.
 * @param target - l'environnement visé.
 * @returns l'environnement à donner au boot cible.
 */
export function targetEnvironment(
  env: Record<string, string | undefined>,
  target: string,
): Record<string, string | undefined> {
  // Les DEUX étiquettes, et elles ÉCRASENT celles d'ici : le mode d'exécution
  // décide du gating `policy`, l'environnement de déploiement décide des
  // surcharges de configuration et des `when()`. N'en poser qu'une ferait
  // diagnostiquer un environnement qui n'existe nulle part — et hériter de
  // celles du poste ferait dire « rien ne disparaît » à une comparaison qui
  // n'a jamais quitté le développement.
  return { ...env, NODE_ENV: target, NF_ENV: target };
}

export function readTargetProvision(
  input: ITargetBootInput,
): (env: string) => Promise<ITargetProvision> {
  return (env: string) =>
    new Promise<ITargetProvision>((resolve) => {
      const child = spawn(
        input.execPath,
        [input.binPath, "inspect", "services", "--json"],
        {
          cwd: input.cwd,
          env: targetEnvironment(input.env, env),
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      let out = "";
      let err = "";
      // Le journal du boot cible part sur la sortie d'erreur : on le garde pour
      // EXPLIQUER un échec, jamais pour le rendre tel quel — un diagnostic qui
      // recrache mille lignes de démarrage n'est plus un diagnostic.
      child.stdout.on("data", (c: Buffer) => (out += c.toString()));
      child.stderr.on("data", (c: Buffer) => (err += c.toString()));
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
      }, input.timeoutMs ?? TARGET_BOOT_TIMEOUT_MS);
      // `unref` : ce délai ne doit jamais retenir le processus à lui seul.
      timer.unref?.();
      child.on("error", (e) => {
        clearTimeout(timer);
        resolve({
          ok: false,
          reason: `le démarrage visant ${env} n'a pas pu être lancé — ${e.message}`,
          short: "boot impossible",
        });
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        if (code !== 0)
          return resolve({
            ok: false,
            reason:
              `l'application ne démarre pas en ${env} (code ${code ?? "tué"}) — ` +
              `il n'y a rien à comparer tant qu'elle ne démarre pas${lastLine(err)}`,
            short: "boot en échec",
            unlock: `NODE_ENV=${env} npx nodefony inspect services`,
          });
        try {
          const parsed: unknown = JSON.parse(out);
          if (!Array.isArray(parsed)) throw new Error("liste attendue");
          return resolve({ ok: true, services: parsed.map(toService) });
        } catch (e) {
          return resolve({
            ok: false,
            reason:
              `le démarrage visant ${env} a répondu autre chose qu'une liste ` +
              `de services — ${(e as Error).message}`,
            short: "réponse illisible",
          });
        }
      });
    });
}

/** Un élément de la réponse, sans rien affirmer de sa forme. */
function toService(row: unknown): IProvidedService {
  const bag = (row ?? {}) as Record<string, unknown>;
  return {
    name: typeof bag.name === "string" ? bag.name : "",
    module: typeof bag.module === "string" ? bag.module : "",
  };
}

/**
 * La dernière ligne utile d'un journal d'erreur, pour EXPLIQUER un échec.
 *
 * Un boot qui échoue écrit des dizaines de lignes ; les rendre toutes noierait
 * le rapport, n'en rendre aucune laisserait « ça ne démarre pas » sans la
 * moindre piste. Une ligne, et le geste pour voir le reste.
 */
function lastLine(stderr: string): string {
  const lines = stderr
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  const last = lines[lines.length - 1];
  return last ? ` : ${last}` : "";
}
