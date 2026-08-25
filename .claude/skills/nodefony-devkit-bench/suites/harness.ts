/**
 * Socle des trois suites de conformité — ce que le SCAFFOLD a câblé tient-il
 * les promesses du framework ?
 *
 * ## Ce que ces suites ne sont pas
 *
 * Elles n'éprouvent PAS le framework : `@nodefony/http`, le Router, l'ORM et le
 * firewall ont leurs propres suites dans le dépôt, et les rejouer ici ne dirait
 * rien de neuf. Elles éprouvent le CÂBLAGE produit par `create` — la couture
 * entre ce que le générateur écrit et ce que le framework attend. C'est la zone
 * où un défaut ne casse aucun test du dépôt et casse toutes les applications.
 *
 * ## Pourquoi elles vivent dans le skill et pas dans les gabarits
 *
 * Une suite livrée à l'utilisateur est une suite qu'il doit maintenir, et qui
 * parle de choses dont il se moque (« la commande générée porte-t-elle son
 * namespace ? »). Celles-ci sont INJECTÉES dans l'application témoin par
 * `verify-runtime.mjs`, jouées, puis jetées avec le décor.
 *
 * ## Un mot sur l'introspection
 *
 * L'étage d'intégration n'instancie pas de Kernel à la main : il passe par
 * `nodefony inspect <sujet> --json`, la porte publique du framework, qui boote
 * l'application COMPLÈTE sans ouvrir un seul port (profil console,
 * `servers: false`). C'est la commande du dépôt qui fait autorité — un harnais
 * maison qui construirait son propre Kernel mesurerait un boot qui n'existe
 * nulle part ailleurs, et divergerait en silence au premier changement de cycle
 * de vie.
 */
import { execFileSync } from "node:child_process";
import path from "node:path";

/** Le binaire du framework, tel que l'application l'a reçu de npm. */
const BIN = path.resolve("node_modules/nodefony/bin/nodefony");

/**
 * Interroge l'application sur elle-même, sans ouvrir de port.
 *
 * `stderr` est ÉCARTÉ délibérément : le journal de boot y passe, et le mélanger
 * au flux JSON produit un `SyntaxError` qui accuse le sujet demandé alors que
 * la sortie était juste. Piège vécu en écrivant ces suites.
 *
 * @param sujet - `routes`, `services`, `modules`, `config`…
 * @returns Le flux JSON désérialisé.
 * @throws Si la commande échoue ou si sa sortie n'est pas du JSON — dans les
 *         deux cas c'est le DÉCOR qui est en cause, et le message le dit.
 */
export function inspect<T>(sujet: string): T {
  let brut: string;
  try {
    brut = execFileSync(process.execPath, [BIN, "inspect", sujet, "--json"], {
      encoding: "utf8",
      timeout: 120_000,
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch (e) {
    // La cause est ATTACHÉE, jamais recopiée dans le message : `execFileSync`
    // porte le code de sortie et la sortie d'erreur du processus, et les
    // aplatir en chaîne perd tout ce qui sert à diagnostiquer.
    throw new Error(
      `\`nodefony inspect ${sujet} --json\` a échoué — l'application ne boote pas`,
      { cause: e },
    );
  }
  try {
    return JSON.parse(brut) as T;
  } catch {
    throw new Error(
      `\`nodefony inspect ${sujet}\` n'a pas rendu du JSON pur (${brut.length} octets) — ` +
        `un flux destiné à une machine ne se mélange pas au journal`,
    );
  }
}

/** Une route, telle que l'application la déclare. */
export interface RouteInspectee {
  name: string;
  path: string;
  methods: string[];
  controller: string;
  action: string;
  module: string;
  host: string | null;
  bypassFirewall: boolean;
}

/** Un service, tel que le conteneur l'a enregistré. */
export interface ServiceInspecte {
  name: string;
  module: string;
  class: string;
}

/** Un module chargé, tel que le Kernel l'a monté. */
export interface ModuleInspecte {
  name: string;
  version?: string;
  [k: string]: unknown;
}

/**
 * Les routes de l'application, indexées par chemin.
 *
 * Un même chemin porte plusieurs entrées (une par méthode) : c'est ce qui rend
 * un CRUD REST lisible, et ce qu'une indexation naïve écraserait.
 */
export function routesParChemin(
  routes: RouteInspectee[],
): Map<string, RouteInspectee[]> {
  const par = new Map<string, RouteInspectee[]>();
  for (const r of routes) {
    const liste = par.get(r.path);
    if (liste === undefined) par.set(r.path, [r]);
    else liste.push(r);
  }
  return par;
}
