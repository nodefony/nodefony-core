import http from "node:http";

/**
 * Le verdict de boot d'un runtime, OBSERVÉ DE L'EXTÉRIEUR — une seule implémentation.
 *
 * POURQUOI ce fichier existe : deux appelants ont besoin de la même réponse à la même
 * question, « cette application est-elle AMPUTÉE ? », et ils y répondaient séparément —
 * le superviseur de développement en la journalisant, le lancement détaché pas du tout.
 * Or c'est le second qui sert la production et la suite e2e de toute application
 * générée : la question y était posée par personne, et un module déclaré au manifeste
 * qui ne charge pas rendait 404 sur toutes ses routes, sans un mot.
 *
 * Le canal est HTTP en boucle locale (`/nodefony/kernel/api/livez`), jamais une IPC :
 * c'est une OBSERVATION du process réellement en train de servir, pas une confidence
 * qu'il se fait à lui-même. La route est publique par dessein (sonde k8s) et son champ
 * `degraded` ne nomme personne — les noms restent réservés à l'appelant authentifié.
 * Ici on ne lit qu'un booléen ; les noms, on va les chercher dans le JOURNAL.
 */

/** Intervalle de re-sonde tant que le verdict reste inconclusif. */
const POLL_MS = 250;

/**
 * Ce qu'une sonde peut rendre — et la distinction qui évite d'attendre pour rien.
 *
 * `"booting"` et `"unreachable"` valent tous deux « pas de verdict », mais PAS la même
 * conduite : le premier s'attend (le boot finira), le second ne s'attendra jamais (rien
 * ne répond en clair sur ce port, et rien n'y répondra). Les confondre coûtait la
 * fenêtre de stabilisation ENTIÈRE à chaque démarrage d'une application sans route de
 * santé joignable — un prix payé par tous pour une information qui ne viendra pas.
 */
export type BootProbe = boolean | "booting" | "unreachable";

/**
 * Interroge `livez` et rend le verdict de boot, ou pourquoi il n'y en a pas.
 *
 * Aucune de ces situations ne se confond avec « sain » : une sonde muette ne doit ni
 * bloquer un démarrage, ni le certifier.
 *
 * @param port - port en clair du runtime (boucle locale).
 * @param deps - injection du client HTTP, pour éprouver sans réseau.
 * @returns `true` (dégradé), `false` (sain), `"booting"` (verdict pas encore stable),
 *   `"unreachable"` (aucune réponse exploitable).
 */
export function probeBootDegraded(
  port: number | undefined,
  deps: {
    /** Récupère le corps de `livez` ; rend `null` sur tout échec. */
    readonly fetchLivez?: (port: number) => Promise<string | null>;
  } = {},
): Promise<BootProbe> {
  // Ce port vient d'un fichier d'état, et il décide d'une requête sortante. Le
  // reste de la cible est en dur (boucle locale, chemin fixe), mais une valeur
  // hors bornes n'aurait de toute façon aucun sens : la refuser ici évite qu'un
  // fichier corrompu fasse frapper un port arbitraire de la machine.
  if (!port || !Number.isInteger(port) || port < 1 || port > 65535) {
    return Promise.resolve("unreachable");
  }
  const fetchLivez = deps.fetchLivez ?? httpGetLivez;
  return fetchLivez(port).then((body): BootProbe => {
    if (body === null) return "unreachable";
    try {
      const j = JSON.parse(body) as { booted?: boolean; degraded?: boolean };
      // `degraded` n'a de sens qu'une fois le boot terminé : avant, il est
      // transitoirement vrai le temps que les serveurs montent.
      return j.booted ? Boolean(j.degraded) : "booting";
    } catch {
      return "unreachable";
    }
  });
}

/**
 * Re-sonde jusqu'à obtenir un verdict STABLE, ou jusqu'à l'échéance.
 *
 * Sans cette attente, la sonde tomberait dans la course entre l'ouverture des ports et
 * la fin du boot, et crierait « dégradé » sur une application parfaitement saine —
 * c'est-à-dire qu'elle deviendrait une alarme qu'on apprend à ignorer.
 *
 * @param port - port en clair du runtime.
 * @param settleMs - durée maximale d'attente d'un verdict.
 * @param deps - injection du client HTTP et de l'attente, pour éprouver sans réseau.
 * @returns le verdict, ou `null` s'il ne s'est pas stabilisé à temps.
 */
export async function waitBootVerdict(
  port: number | undefined,
  settleMs: number,
  deps: {
    readonly fetchLivez?: (port: number) => Promise<string | null>;
    readonly now?: () => number;
    readonly delay?: (ms: number) => Promise<void>;
    /** Interrompt l'attente (redémarrage, arrêt) — le verdict devient sans objet. */
    readonly aborted?: () => boolean;
  } = {},
): Promise<boolean | null> {
  const now = deps.now ?? ((): number => Date.now());
  const wait =
    deps.delay ??
    ((ms: number): Promise<void> =>
      new Promise((r) => {
        setTimeout(r, ms);
      }));
  const deadline = now() + settleMs;
  for (;;) {
    if (deps.aborted?.()) return null;
    const probe = await probeBootDegraded(port, deps);
    // Injoignable : on ne réessaie PAS. Ce n'est pas une réponse qui tarde, c'est
    // l'absence de canal — attendre la fenêtre entière ne ferait que retarder chaque
    // démarrage d'une application qui n'expose pas cette route en clair.
    if (probe === "unreachable") return null;
    if (probe !== "booting") return probe;
    if (now() >= deadline) return null;
    await wait(POLL_MS);
  }
}

/**
 * Extrait du journal d'un runtime les modules que le boot a IGNORÉS, avec leur motif.
 *
 * POURQUOI lire le journal plutôt que la route : `livez` ne nomme les modules qu'à un
 * appelant authentifié, et une sonde de démarrage n'a pas d'identité à présenter. Le
 * journal, lui, est le fichier qu'on vient d'écrire — il porte le message que le Kernel
 * a émis en écartant le module, motif compris. Le format lu est celui de
 * `Kernel.loadModulesFromManifest` ; le motif est ce qui suit le tiret cadratin.
 *
 * Fonction PURE : c'est ce qui la rend éprouvable sans démarrer quoi que ce soit.
 *
 * @param journal - contenu brut du journal (les couleurs sont tolérées).
 * @returns une ligne par module ignoré, `nom — motif`, sans doublon et dans l'ordre.
 */
export function extractSkippedModules(journal: string): string[] {
  const withoutColors = journal.replace(/\x1b\[[0-9;]*m/gu, "");
  const pattern =
    /MODULE LOAD: échec non bloquant \(fail-soft\) de "([^"]+)" — (.*)$/gmu;
  const vus = new Set<string>();
  for (const m of withoutColors.matchAll(pattern)) {
    vus.add(`${m[1]} — ${m[2].trim()}`);
  }
  return [...vus];
}

/** Ce qu'un runtime dit de sa DISPONIBILITÉ — « peut-il servir maintenant ? ». */
export interface IReadinessProbe {
  /** `true` = le pod peut servir (boot fini ET rien ne le retient). */
  readonly ready: boolean;
  /** Nombre de composants qui retiennent la mise en service (0 = aucun). */
  readonly blocked: number;
  /**
   * QUI retient, et pourquoi — `undefined` quand le détail n'est pas
   * disponible ou ne CONCORDE pas avec le compte que le runtime vient de
   * rendre.
   *
   * Le compte vient du runtime interrogé à l'instant ; le détail vient du
   * fichier que le serveur publie. **Deux sources doivent concorder pour qu'on
   * nomme** : un fichier en retard d'un cycle désignerait un contributeur déjà
   * libéré, et l'on chercherait une cause disparue — pire que de ne rien
   * nommer.
   */
  readonly blockedBy?: readonly { name: string; reason?: string }[];
}

/**
 * Demande au runtime s'il peut SERVIR — question distincte de « ses ports
 * répondent-ils ». Un pod dont le schéma de base est en retard écoute
 * parfaitement et ne sert rien : l'orchestrateur le tient hors du répartiteur de
 * charge, et un rapport qui n'annoncerait que « 2/2 ports UP » serait faux et
 * rassurant à tort — exactement le défaut que ce fichier existe pour éviter.
 *
 * Même canal que {@link probeBootDegraded} (le `livez` du plan d'administration,
 * en boucle locale) : une seule sonde, un seul endroit à corriger.
 *
 * @param port - port en clair du runtime (boucle locale).
 * @param deps - injection du client HTTP, pour éprouver sans réseau.
 * @returns le verdict, ou `null` si rien d'exploitable n'a été obtenu — une
 *   sonde muette ne certifie RIEN, elle se dit muette.
 */
export function probeReadiness(
  port: number | undefined,
  deps: {
    readonly fetchLivez?: (port: number) => Promise<string | null>;
  } = {},
): Promise<IReadinessProbe | null> {
  if (!port || !Number.isInteger(port) || port < 1 || port > 65535) {
    return Promise.resolve(null);
  }
  const fetchLivez = deps.fetchLivez ?? httpGetLivez;
  return fetchLivez(port).then((body): IReadinessProbe | null => {
    if (body === null) return null;
    try {
      const j = JSON.parse(body) as {
        ready?: boolean;
        readinessBlocked?: number;
      };
      // Un runtime d'une version antérieure ne connaît pas `readinessBlocked` :
      // son `ready` reste exploitable, le compte vaut alors 0.
      if (typeof j.ready !== "boolean") return null;
      return { ready: j.ready, blocked: j.readinessBlocked ?? 0 };
    } catch {
      return null;
    }
  });
}

/**
 * GET `livez` en boucle locale, en clair. Rend `null` sur tout échec — c'est une
 * observation best-effort, jamais un point de rupture du démarrage.
 *
 * @param port - port en clair du runtime.
 * @returns le corps de la réponse, ou `null`.
 */
function httpGetLivez(port: number): Promise<string | null> {
  return new Promise((resolve) => {
    let repondu = false;
    const conclure = (v: string | null): void => {
      if (!repondu) {
        repondu = true;
        resolve(v);
      }
    };
    const req = http.get(
      {
        host: "127.0.0.1",
        port,
        path: "/nodefony/kernel/api/livez",
        timeout: 1500,
      },
      (res) => {
        let data = "";
        res.setEncoding("utf8");
        res.on("data", (c) => (data += c));
        res.on("end", () => conclure(data));
      },
    );
    req.once("error", () => conclure(null));
    req.once("timeout", () => {
      req.destroy();
      conclure(null);
    });
  });
}
