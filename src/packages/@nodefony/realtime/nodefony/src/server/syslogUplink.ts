/**
 * Réception des journaux **remontés par un navigateur** : le pendant serveur du
 * transport client (`nodefony/client` → `installSyslogUplink`).
 *
 * Un canal entrant qui écrit dans le journal du pod est une **surface d'écriture**, et
 * c'est la seule chose qui compte pour sa conception. Trois bornes, non négociables :
 *
 * 1. **L'origine est FORCÉE.** Le `moduleName` que le client prétend n'est jamais repris :
 *    le `Pdu` réinjecté porte {@link BROWSER_ORIGIN}. Sans quoi une page pourrait se faire
 *    passer pour le noyau et fabriquer des pistes de diagnostic.
 * 2. **La taille et le débit sont bornés**, par connexion. Un onglet ouvert ne doit pas
 *    pouvoir noyer le journal d'exploitation — ni par un lot géant, ni par la répétition.
 * 3. **La sévérité est plafonnée.** Un client ne déclenche pas une alerte d'exploitation :
 *    tout ce qu'il envoie de plus grave que {@link MAX_CLIENT_SEVERITY} y est ramené.
 *
 * Ce que ces bornes ne couvrent PAS, et qu'il faut savoir en lisant le journal : le
 * `requestId` d'une entrée est **déclaré par le client**. On le valide en forme, jamais en
 * fond — un client peut donc rattacher ses lignes à une requête qui n'est pas la sienne.
 * L'impact est une piste de diagnostic polluée, jamais une élévation de droit ; et le
 * `moduleName` forcé dit au lecteur que la ligne vient d'un navigateur, donc qu'elle est
 * déclarative. C'est le prix d'une corrélation front↔back, et il s'énonce.
 */

import { Pdu, Syslog } from "nodefony";
import type { RealtimeInboundHandler } from "../../interfaces/IRealtimeController";

/**
 * Origine imposée à toute entrée venue d'un navigateur. C'est la valeur de confiance
 * du journal : elle vient du serveur, jamais du fil.
 */
export const BROWSER_ORIGIN = "browser";

/**
 * Sévérité la plus grave qu'un client puisse obtenir (3 = ERROR). Au-dessus vivent
 * CRITIC, ALERT et EMERGENCY — des niveaux d'exploitation qu'un onglet ne décide pas.
 */
export const MAX_CLIENT_SEVERITY = 3;

/** Les seules sévérités qu'une entrée cliente peut porter, une fois plafonnée. */
export type ClientSeverity = 3 | 4 | 5 | 6 | 7;

export interface SyslogUplinkHandlerOptions {
  /** Le journal du pod où réinjecter. */
  syslog: Syslog;
  /** Entrées retenues par lot. Défaut `50` ; le surplus est ignoré et compté. */
  maxEntriesPerBatch?: number;
  /** Entrées retenues par fenêtre et par connexion. Défaut `300`. */
  maxEntriesPerWindow?: number;
  /** Durée de la fenêtre de débit, en ms. Défaut `10000`. */
  windowMs?: number;
  /** Longueur maximale d'une chaîne acceptée. Défaut `4096`. */
  maxStringLength?: number;
  /** Longueur maximale d'un `requestId` accepté. Défaut `128`. */
  maxRequestIdLength?: number;
}

/** Une entrée telle qu'elle arrive du fil — donc **non fiable**, à valider champ par champ. */
interface IncomingEntry {
  severity?: unknown;
  moduleName?: unknown;
  msgid?: unknown;
  msg?: unknown;
  timeStamp?: unknown;
  requestId?: unknown;
  payload?: unknown;
}

/** Chaîne bornée, ou `undefined` si ce n'en est pas une. */
function str(v: unknown, max: number): string | undefined {
  if (typeof v !== "string") return undefined;
  return v.length <= max ? v : v.slice(0, max);
}

/**
 * `requestId` accepté seulement s'il ressemble à un identifiant : imprimable, sans
 * espace, borné. On ne vérifie pas qu'il EXISTE (ce serait une lecture par entrée sur le
 * chemin chaud) — seulement qu'il ne peut pas servir à injecter autre chose.
 */
function safeRequestId(v: unknown, max: number): string | undefined {
  if (typeof v !== "string" || v.length === 0 || v.length > max)
    return undefined;
  for (let i = 0; i < v.length; i += 1) {
    const c = v.charCodeAt(i);
    // Imprimable ASCII, hors espace : couvre UUID, ULID, hex, base64url.
    if (c <= 0x20 || c >= 0x7f) return undefined;
  }
  return v;
}

/**
 * Sévérité ramenée dans les bornes : un entier RFC 5424 valide, jamais plus grave que
 * {@link MAX_CLIENT_SEVERITY}. Tout ce qui n'est pas un nombre exploitable devient
 * `ERROR` — une entrée arrivée jusqu'ici a été jugée digne d'être envoyée.
 */
function clampSeverity(v: unknown): ClientSeverity {
  if (typeof v !== "number" || !Number.isInteger(v)) return MAX_CLIENT_SEVERITY;
  // Énuméré plutôt que borné puis converti : le type `Severity` du cœur est une
  // union de littéraux, et une assertion nous ferait perdre exactement la garantie
  // que ce plafond existe pour donner.
  if (v <= 3) return 3;
  if (v === 4) return 4;
  if (v === 5) return 5;
  if (v === 6) return 6;
  return 7;
}

/**
 * Fabrique le handler du canal montant des journaux.
 *
 * **Un handler par connexion** : `RealtimeController.realtimeInbound()` est invoqué au
 * handshake, donc le compteur de débit qu'il capture est per-connexion — ce qui est le
 * seul découpage utile (borner globalement laisserait un onglet bavard museler tous les
 * autres).
 *
 * @param opts - journal cible et bornes.
 * @returns le handler à déclarer dans `realtimeInbound()`.
 */
export function createSyslogUplinkHandler(
  opts: SyslogUplinkHandlerOptions,
): RealtimeInboundHandler {
  const {
    syslog,
    maxEntriesPerBatch = 50,
    maxEntriesPerWindow = 300,
    windowMs = 10000,
    maxStringLength = 4096,
    maxRequestIdLength = 128,
  } = opts;

  // État de débit de CETTE connexion. Deux nombres, pas de minuteur : la fenêtre est
  // recalculée à la lecture, donc rien ne tourne quand personne ne pousse.
  let windowStart = 0;
  let windowCount = 0;

  return function onSyslogUplink(params: unknown): void {
    if (params === null || typeof params !== "object") return;
    const batch = params as { pageId?: unknown; entries?: unknown };
    const entries = batch.entries;
    if (!Array.isArray(entries) || entries.length === 0) return;

    const pageId = safeRequestId(batch.pageId, maxRequestIdLength);
    if (pageId === undefined) return; // un lot sans page identifiable n'est pas exploitable

    const now = Date.now();
    if (now - windowStart > windowMs) {
      windowStart = now;
      windowCount = 0;
    }

    const limit = Math.min(entries.length, maxEntriesPerBatch);
    for (let i = 0; i < limit; i += 1) {
      if (windowCount >= maxEntriesPerWindow) return; // débit dépassé : on cesse, en silence
      windowCount += 1;

      const raw = entries[i] as IncomingEntry | null;
      if (raw === null || typeof raw !== "object") continue;

      const severity = clampSeverity(raw.severity);
      const msgid = str(raw.msgid, 64) ?? "";
      const msg = str(raw.msg, maxStringLength) ?? "";
      const timeStamp =
        typeof raw.timeStamp === "number" && Number.isFinite(raw.timeStamp)
          ? raw.timeStamp
          : now;

      // Origine FORCÉE : `raw.moduleName` est délibérément ignoré. Le Pdu est construit
      // ici plutôt que délégué à `syslog.log(payload, …)`, parce que `log()` prend le
      // `moduleName` de SES réglages — il n'y a pas d'autre façon de le fixer.
      const pdu = new Pdu(
        raw.payload,
        severity,
        BROWSER_ORIGIN,
        msgid,
        msg,
        timeStamp,
      );
      // Corrélation : ce que le client dit savoir, validé en forme seulement. À défaut,
      // le `pageId` regroupe au moins les lignes d'un même onglet.
      pdu.requestId =
        safeRequestId(raw.requestId, maxRequestIdLength) ?? pageId;
      syslog.log(pdu);
    }
  };
}
