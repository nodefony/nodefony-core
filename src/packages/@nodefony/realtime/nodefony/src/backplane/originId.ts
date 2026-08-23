import { hostname } from "node:os";
import { randomUUID } from "node:crypto";

/**
 * Résout l'identifiant d'origine d'un backplane — l'étiquette que l'anti-écho
 * compare pour jeter les messages qui reviennent à leur émetteur.
 *
 * POURQUOI pas `String(process.pid)` (ex-défaut) : en conteneur, le namespace
 * PID est PAR conteneur → deux pods k8s peuvent tous deux être PID 1. Avec un
 * backplane cross-pod (Redis/Kafka), l'anti-écho confond alors les pods et
 * jette SILENCIEUSEMENT le fan-out légitime (dette 🔴 #2 du module).
 *
 * Résolution (du plus explicite au filet) :
 *  1. `NF_POD_NAME` (downward API k8s, opt-in opérateur) ;
 *  2. `os.hostname()` — en k8s = nom du pod (unique), en docker = id court du
 *     conteneur (unique), en bare-metal = nom de machine ;
 *  3. suffixe `:pid` TOUJOURS ajouté : distingue les workers d'un même host
 *     (cluster bare-metal `-w N` + driver redis = même hostname, pids ≠) ;
 *  4. hostname indisponible/vide (exotique) → `randomUUID()` (l'anti-écho n'a
 *     pas besoin de stabilité entre restarts, seulement d'unicité à l'instant t).
 *
 * Évalué à la CONSTRUCTION du backplane (boot) — 0 coût par message.
 */
export function resolveBackplaneOriginId(): string {
  let host = process.env.NF_POD_NAME;
  if (!host) {
    try {
      host = hostname();
    } catch {
      host = "";
    }
  }
  if (!host) {
    return randomUUID();
  }
  return `${host}:${process.pid}`;
}

export default resolveBackplaneOriginId;
