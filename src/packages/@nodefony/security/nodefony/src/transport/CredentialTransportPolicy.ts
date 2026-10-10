import { InsecureTransportError } from "../../errors/InsecureTransportError";

/** Vue minimale du contexte : seul le scheme EFFECTIF compte. */
export interface ICredentialTransportContext {
  /**
   * Scheme vu par le client — `https` derrière un proxy de confiance qui
   * termine TLS (`trustProxy` + `X-Forwarded-Proto`), jamais le transport brut.
   */
  readonly scheme?: string;
}

/** Réglages de la politique, résolus UNE fois au boot du firewall. */
export interface ICredentialTransportPolicyOptions {
  /** `true` = un secret reçu hors TLS est refusé (production, sans échappement). */
  readonly enforce: boolean;
  /** Journal du premier refus (WARNING) — absent = silencieux. */
  readonly log?: (message: string) => void;
}

/**
 * Dit si un secret de connexion se refuse : en production, sans échappement
 * explicite. Seule source de la décision — le firewall la compose au boot.
 *
 * @param environment - environnement normalisé du kernel.
 * @param allowInsecureCredentials - échappement `security.allowInsecureCredentials`.
 */
export function shouldEnforceCredentialTransport(
  environment: string | undefined,
  allowInsecureCredentials: boolean,
): boolean {
  return environment === "production" && !allowInsecureCredentials;
}

/**
 * Refuse, avant toute vérification, un mot de passe ou un code de second
 * facteur reçu en clair. Une instance partagée au conteneur (`credentialTransport`)
 * sert TOUTES les portes qui reçoivent un secret : formulaire de session, second
 * facteur, Basic, émission de jeton — une porte oubliée serait le canal clair.
 *
 * La décision se prend sur le scheme EFFECTIF (`context.scheme`) : derrière un
 * proxy qui termine TLS et déclaré de confiance, il vaut `https` alors que le
 * pod écoute en HTTP. C'est le cas de la plupart des déploiements ; c'est donc
 * `trustProxy` que nomme le journal, pas « passez en HTTPS ».
 */
export class CredentialTransportPolicy {
  readonly enforce: boolean;
  readonly #log: ((message: string) => void) | null;
  // Un seul journal par process : un pod mal configuré refuse CHAQUE connexion,
  // et le détail par tentative vit déjà dans l'audit.
  #warned = false;

  constructor(options: ICredentialTransportPolicyOptions) {
    this.enforce = options.enforce;
    this.#log = options.log ?? null;
  }

  /**
   * Laisse passer un secret reçu sur TLS, ou n'importe lequel hors production.
   *
   * @param context - contexte de la requête qui porte le secret.
   * @param door - porte qui le reçoit, nommée dans le journal.
   * @throws InsecureTransportError (403) — secret reçu en clair en production.
   */
  assert(context: ICredentialTransportContext, door: string): void {
    if (!this.enforce) return;
    const scheme = context.scheme;
    if (scheme === "https" || scheme === "wss") return;
    if (!this.#warned && this.#log !== null) {
      this.#warned = true;
      this.#log(
        `Secret de connexion REFUSÉ (${door}) : la requête est arrivée en ` +
          `${scheme ?? "scheme inconnu"} en production. Derrière un proxy qui ` +
          `termine TLS, déclarez-le de confiance (\`trustProxy\`, config ` +
          `@nodefony/http) pour que \`X-Forwarded-Proto\` soit lu ; sinon ` +
          `servez l'application en HTTPS. Échappement explicite : ` +
          `\`security.allowInsecureCredentials\`. Les refus suivants ne sont ` +
          `plus journalisés ici (voir l'audit).`,
      );
    }
    throw new InsecureTransportError();
  }
}
