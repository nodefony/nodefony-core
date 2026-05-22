/**
 * Notice temps réel normalisée — Core isomorphe Nodefony.
 *
 * Format **unique** d'un retour à porter à l'attention de l'utilisateur, quelle
 * que soit sa source (transport temps réel, appel data plane, push serveur). Le
 * centre de notifications d'une app (Studio : snackbar Mantine) consomme ce format
 * sans connaître l'origine → réutilisable par TOUTE app (`import … from "nodefony"`).
 */

/** Sévérité d'affichage — alignée sur les niveaux snackbar usuels. */
export type NoticeLevel = "success" | "info" | "warning" | "error";

/** Notice normalisée prête à afficher (snackbar / centre de notifications). */
export interface NodefonyNotice {
  /** Sévérité d'affichage. */
  level: NoticeLevel;
  /** Titre court (gras), optionnel. */
  title?: string;
  /** Message lisible (déjà localisé FR). */
  message: string;
  /** Origine — `realtime` (transport WS), `api` (data plane HTTP), `server` (push). */
  source: "realtime" | "api" | "server";
  /** Code corrélé : close code WS, status HTTP ou code d'erreur JSON-RPC. */
  code?: number;
  /** Timestamp (ms epoch) de production. */
  ts: number;
}

/**
 * Traduit un **code de fermeture WebSocket** (RFC 6455 §7.4) en {@link NodefonyNotice}
 * — pendant CLIENT du `toWsCloseCode` serveur (`@nodefony/http`). Pur, sans état,
 * donc trivialement testable et réutilisable.
 *
 * Retourne `null` pour une fermeture **propre** (1000) ou **attendue** (1001 going
 * away = restart serveur, le reconnect rétablit) : pas de bruit inutile.
 *
 * @param code - code de fermeture reçu (`CloseEvent.code`).
 * @param reason - description optionnelle (`CloseEvent.reason`), ajoutée au message.
 * @returns une notice à afficher, ou `null` si la fermeture ne mérite aucune alerte.
 */
export function closeCodeToNotice(
  code: number | undefined,
  reason?: string,
): NodefonyNotice | null {
  // Fermetures sans alerte : normale (1000) et going-away propre (1001).
  if (code === 1000 || code === 1001) return null;

  let level: NoticeLevel = "warning";
  let message: string;
  switch (code) {
    case 1002:
      level = "error";
      message = "Erreur de protocole temps réel";
      break;
    case 1003:
      level = "error";
      message = "Données temps réel non supportées";
      break;
    case 1006:
      // Fermeture anormale : pas de frame de close reçue (perte réseau, crash).
      message = "Connexion temps réel perdue";
      break;
    case 1007:
      level = "error";
      message = "Trame temps réel invalide";
      break;
    case 1008:
      // Policy violation côté serveur = 401/403 mappés (toWsCloseCode).
      level = "error";
      message = "Accès temps réel refusé";
      break;
    case 1009:
      message = "Message temps réel trop volumineux";
      break;
    case 1010:
      level = "error";
      message = "Extension temps réel requise manquante";
      break;
    case 1011:
      level = "error";
      message = "Erreur serveur temps réel";
      break;
    case 4004:
      // Code privé Nodefony (toWsCloseCode) : 4xx applicatif (404…).
      level = "error";
      message = "Ressource temps réel introuvable";
      break;
    default:
      message =
        typeof code === "number"
          ? `Connexion temps réel fermée (code ${code})`
          : "Connexion temps réel fermée";
  }

  const trimmed = reason?.trim();
  return {
    level,
    title: "Temps réel",
    message: trimmed ? `${message} : ${trimmed}` : message,
    source: "realtime",
    code,
    ts: Date.now(),
  };
}
