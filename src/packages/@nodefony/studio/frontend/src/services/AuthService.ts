/**
 * AuthService — ce qui reste à Studio des appels d'identité.
 *
 * La CONNEXION (mot de passe, second facteur, passkey, fournisseurs, reprise
 * de session, déconnexion) passe par le déroulé partagé `NodefonyLogin`
 * (`nodefony/client`), que porte `AuthStore` : une seule implémentation des
 * règles, la même que celle des pages générées. Il ne reste ici que
 * l'enregistrement d'une passkey — un geste du PROFIL, pas de la connexion —
 * et la sonde de vie.
 */
import { startRegistration } from "@simplewebauthn/browser";
import type { PublicKeyCredentialCreationOptionsJSON } from "@simplewebauthn/browser";
import type { ApiClient } from "./ApiClient";

export interface AuthUser {
  id: number | string;
  identifier: string;
  email?: string;
  roles: string[];
  currentRole?: string;
}

const WEBAUTHN_BASE = "/nodefony/security/api/webauthn";

export class AuthService {
  constructor(private readonly api: ApiClient) {}

  /**
   * Enregistre un nouveau passkey pour l'utilisateur **déjà connecté** (lie une
   * empreinte/clé matérielle à son compte). `startRegistration()` déclenche la
   * création de la paire de clés dans l'authenticator (Touch ID, clé FIDO…).
   *
   * @returns l'identifiant (base64url) du credential créé.
   * @throws ApiError 401 — non connecté, ou vérification échouée.
   */
  async registerPasskey(): Promise<string> {
    const optionsJSON =
      await this.api.postAbsolute<PublicKeyCredentialCreationOptionsJSON>(
        `${WEBAUTHN_BASE}/register/options`,
        {},
      );
    const attestation = await startRegistration({ optionsJSON });
    const { credentialId } = await this.api.postAbsolute<{
      verified: boolean;
      credentialId: string;
    }>(`${WEBAUTHN_BASE}/register/verify`, { response: attestation });
    return credentialId;
  }

  async ping(): Promise<{ status: string; uptime: number; pid: number }> {
    return this.api.get("/health");
  }
}
