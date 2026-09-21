import { Controller, controller, Post, Body } from "@nodefony/framework";
import { Context } from "@nodefony/http";
import { totpCode, base32Decode } from "@nodefony/security";

/**
 * Sonde des briques durables **qu'aucune route du framework n'atteint** —
 * second facteur (TOTP) et endpoints de webhooks.
 *
 * 🔴 POURQUOI CE FICHIER EXISTE. Une passe d'intégration complète laissait
 * `totp_secrets`, `webauthn_credentials` et `webhook_endpoints` à **zéro
 * ligne**, quel que soit le backend. Le data plane n'expose, pour le 2FA, que
 * des lectures (`GET totp/list`, `GET users/{id}/totp`) : la brique est
 * complète, éprouvée par ses bancs, et **inatteignable par HTTP**. Une
 * capacité qu'on ne peut pas joindre n'existe pas du point de vue de qui
 * mesure — et la preuve « une application tourne sur ce backend » s'arrêtait
 * donc à cinq briques sur huit.
 *
 * ⚠️ Ce n'est PAS un trou propre à MongoDB : sans route, la passe par défaut
 * (Drizzle) ne les écrivait pas davantage. Cette sonde sert les deux.
 *
 * Ce qu'elle est, et ce qu'elle n'est pas. C'est un banc : elle appelle les
 * services comme le ferait un véritable flux d'enrôlement, pour que la donnée
 * soit RÉELLEMENT écrite par le store sélectionné au boot. Ce n'est pas la
 * surface publique — un vrai enrôlement 2FA exige un flux de reprise
 * d'authentification (vérification du mot de passe, protection contre le
 * rejeu, codes de récupération montrés une fois), qui appartient au framework
 * et non à un module de test. Le module `test` n'étant jamais chargé en
 * production (`policy: "dev"`), ces routes n'existent pas là-bas.
 *
 * WebAuthn reste hors de portée : y écrire exige de forger une attestation
 * d'authentificateur, ce qu'une route ne peut pas simuler honnêtement.
 */

/** Ce que la sonde rend d'un cycle 2FA — assez pour l'affirmer, rien de secret. */
interface TotpProbeResult {
  /** Identifiant de l'utilisateur éprouvé. */
  userId: string;
  /** L'enrôlement a-t-il été confirmé (donc ÉCRIT par le store) ? */
  activated: boolean;
  /** Nombre de codes de récupération rendus à l'activation. */
  recoveryCodes: number;
  /** État relu APRÈS écriture — c'est lui qui prouve la persistance. */
  enabled: boolean;
}

/** Ce que la sonde rend d'un enregistrement de webhook. */
interface WebhookProbeResult {
  /** Identifiant de l'endpoint créé. */
  id: string;
  /** URL enregistrée. */
  url: string;
}

/** Contrat minimal du service 2FA — ce que la sonde lui demande, et rien de plus. */
interface ITotpProbeService {
  isEnabled(): boolean;
  beginEnrollment(
    userId: string,
    account: string,
  ): Promise<{ secretBase32: string }>;
  confirmEnrollment(
    userId: string,
    code: string,
  ): Promise<{ recoveryCodes: string[] }>;
  status(userId: string): Promise<{ enabled: boolean }>;
}

/**
 * Contrat minimal du service de webhooks.
 *
 * ⚠️ `register` rend `{ endpoint, secret }`, **pas** l'endpoint à plat : écrit
 * de mémoire, ce contrat rendait un corps vide sous un `200` parfaitement vert.
 * Le secret n'est jamais relu ici — il n'a rien à faire dans une réponse de banc.
 */
interface IWebhookProbeService {
  register(input: {
    url: string;
    events: readonly string[];
    description?: string | null;
  }): Promise<{ endpoint: { id: string; url: string } }>;
}

@controller("/nodefony/test/durable")
class DurableBrickProbeController extends Controller {
  constructor(context: Context) {
    super("DurableBrickProbeController", context);
  }

  /**
   * Déroule un enrôlement 2FA COMPLET et laisse le secret en base.
   *
   * Le code est calculé ici, depuis le secret que l'enrôlement vient de rendre
   * — c'est exactement ce que fait une application d'authentification, et c'est
   * la seule façon d'obtenir une écriture réelle sans clavier humain.
   *
   * @param body - `{ userId }` — l'identifiant à enrôler.
   * @returns l'état relu après écriture.
   * @throws 503 quand le 2FA est désactivé par la configuration.
   */
  @Post("/totp")
  async totp(@Body() body: { userId?: string }): Promise<TotpProbeResult> {
    const totp = this.kernel?.get("totp") as ITotpProbeService | undefined;
    if (!totp?.isEnabled()) {
      this.context!.response!.setStatusCode(503);
      return {
        userId: "",
        activated: false,
        recoveryCodes: 0,
        enabled: false,
      };
    }
    const userId = body?.userId ?? `probe-${Date.now()}`;
    const { secretBase32 } = await totp.beginEnrollment(
      userId,
      `${userId}@nodefony.test`,
    );
    // Le secret ne quitte PAS le serveur : seul le code en sort, et il expire.
    const code = totpCode(base32Decode(secretBase32));
    const { recoveryCodes } = await totp.confirmEnrollment(userId, code);
    // Relecture APRÈS écriture : c'est elle qui distingue « la fabrique a
    // répondu » de « la donnée est dans la base ».
    const { enabled } = await totp.status(userId);
    return {
      userId,
      activated: true,
      recoveryCodes: recoveryCodes.length,
      enabled,
    };
  }

  /**
   * Enregistre un endpoint de webhook, et laisse la ligne en base.
   *
   * L'URL vise le récepteur local du module test : le garde anti-SSRF la
   * refuserait autrement, et on mesurerait ce refus au lieu de l'écriture.
   *
   * @param body - `{ url?, events? }` — cible et actions souscrites.
   * @returns l'endpoint créé (jamais son secret).
   * @throws 503 quand le service de webhooks n'est pas prêt.
   */
  @Post("/webhook")
  async webhook(
    @Body() body: { url?: string; events?: string[] },
  ): Promise<WebhookProbeResult> {
    const webhooks = this.kernel?.get("webhooks") as
      IWebhookProbeService | undefined;
    if (!webhooks) {
      this.context!.response!.setStatusCode(503);
      return { id: "", url: "" };
    }
    const { endpoint } = await webhooks.register({
      url: body?.url ?? "http://127.0.0.1:5152/nodefony/test/webhooks/sink",
      events: body?.events ?? ["*"],
      description: "sonde de brique durable (module test)",
    });
    return { id: endpoint.id, url: endpoint.url };
  }
}

export default DurableBrickProbeController;
