import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { Service, Module } from "nodefony";
import type { LoginPageSkin } from "nodefony";
import { defineSecurityConfig } from "../config/defineModuleConfig";
import type { ISecurityConfig, ISecurityConfigInput } from "../config/config";
import { readIfPresentSync } from "../src/token/secretFile";
import {
  buildKeycloakRealm,
  mergeKeycloakRealm,
  renderKeycloakRealm,
  type IKeycloakMachineInput,
  type TKeycloakObject,
} from "../keycloak/keycloakRealm";
import {
  deriveKeycloakRealmInput,
  keycloakLoginTheme,
  KeycloakRealmError,
  type IAppServers,
} from "../keycloak/keycloakRealmInput";
import {
  KeycloakAdminClient,
  keycloakAdminTarget,
  type IKeycloakLoginThemeResult,
} from "../keycloak/keycloakAdmin";

const serviceName = "keycloak";

/** Où le compose d'une application importe ses realms (chemin natif). */
const IMPORT_DIR = path.join("docker", "keycloak", "import");

/** Ce qu'on demande au realm dérivé. */
export interface IKeycloakRealmRequest {
  /** Nom dans `oauth2.providers` (défaut `keycloak`). */
  readonly provider?: string | undefined;
  /** Fichier d'import, relatif à la racine de l'application ou absolu. */
  readonly file?: string | undefined;
  /** Client machine dont l'audience suit la config. */
  readonly machine?: string | undefined;
  /** Origine par laquelle Keycloak joint l'application (canal arrière). */
  readonly backchannelOrigin?: string | undefined;
}

/** Le realm que la configuration implique, confronté au fichier d'import. */
export interface IKeycloakRealmPlan {
  /** Fichier d'import visé (chemin natif absolu). */
  readonly file: string;
  /** Contenu actuel du fichier, `null` s'il n'existe pas. */
  readonly current: string | null;
  /** Le realm fusionné, tel qu'il serait écrit. */
  readonly text: string;
  /** Constats à DIRE (le realm reste écrivable). */
  readonly warnings: readonly string[];
  /** `true` si le fichier porte déjà exactement {@link text}. */
  readonly upToDate: boolean;
}

/**
 * Le fichier de realm par défaut : l'UNIQUE `.json` du dossier d'import, sinon
 * `realm.json` (le nom que `create app` écrit).
 */
function defaultRealmFile(root: string): string {
  const dir = path.join(root, IMPORT_DIR);
  let json: string[] = [];
  try {
    json = readdirSync(dir).filter((f) => f.endsWith(".json"));
  } catch {
    // Dossier absent : le chemin par défaut sera créé à l'écriture.
  }
  const only = json.length === 1 ? json[0] : undefined;
  return path.join(dir, only ?? "realm.json");
}

/** Un objet indexable, sans rien affirmer de son contenu. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Un objet JSON de realm. Le contenu vient de `JSON.parse` : seules des
 * valeurs JSON peuvent s'y trouver, la garde ne vérifie donc que la forme.
 */
function isKeycloakObject(value: unknown): value is TKeycloakObject {
  return isRecord(value);
}

/** Un port lu dans `servers.<nom>` de la config ; `null` si le serveur est coupé. */
function portOf(
  servers: unknown,
  name: "http" | "https",
  fallback: number,
): number | null {
  if (!isRecord(servers)) return fallback;
  const server = servers[name];
  if (server === false) return null;
  if (!isRecord(server)) return fallback;
  const port = Number(server.port);
  return Number.isInteger(port) && port > 0 ? port : fallback;
}

/**
 * Le client machine à tenir à jour : celui qu'on nomme, sinon le compte de
 * service que le realm existant déclare déjà (flux `client_credentials` seul).
 */
function machineClient(
  existing: TKeycloakObject | null,
  named: string | undefined,
): IKeycloakMachineInput | null {
  if (named !== undefined) return { clientId: named, secret: null };
  const clients = Array.isArray(existing?.clients) ? existing.clients : [];
  for (const client of clients) {
    if (typeof client !== "object" || client === null || Array.isArray(client))
      continue;
    if (
      client.serviceAccountsEnabled === true &&
      client.standardFlowEnabled !== true
    ) {
      if (typeof client.clientId === "string") {
        return { clientId: client.clientId, secret: null };
      }
    }
  }
  return null;
}

/**
 * Service `keycloak` — toutes les actions de Nodefony sur un serveur Keycloak,
 * en un point du conteneur.
 *
 * - **le realm** que la configuration implique : dérivé, fusionné avec le
 *   fichier d'import existant, comparé, écrit ({@link realmPlan},
 *   {@link writeRealm}) ;
 * - **l'API d'administration** d'un realm vivant ({@link admin}), et ce qui s'y
 *   fait : le thème de connexion qui suit `loginPage.skin`
 *   ({@link applyLoginTheme}).
 *
 * Les commandes `security:keycloak:*` et les routes de développement
 * l'appellent ; elles ne gardent que l'affichage. Seule la contribution de
 * scaffold (`create app`, `scaffold:sync`) appelle les fonctions pures en
 * direct : elle tourne SANS démarrer l'application, donc sans conteneur.
 *
 * Rien n'est construit au démarrage : la configuration est lue à l'appel, et
 * les clients d'administration (un par fournisseur, jeton gardé) au premier
 * usage.
 */
class KeycloakService extends Service {
  #clients: Map<string, KeycloakAdminClient> | null = null;

  constructor(public module: Module) {
    super(
      serviceName,
      module.container ?? undefined,
      module.notificationsCenter,
      module.options,
    );
  }

  /**
   * La configuration de sécurité VALIDÉE, relue à chaque appel (chemin froid).
   *
   * @returns la configuration
   */
  config(): ISecurityConfig {
    return defineSecurityConfig(this.options as ISecurityConfigInput);
  }

  /**
   * Le realm que la configuration implique, fusionné avec le fichier d'import.
   *
   * Le realm d'import répète ce que la config dit déjà (client, URL de retour,
   * audiences, rôles de `roleMapping`) : écrit à la main, il diverge. Ce plan
   * le DÉRIVE, puis le fusionne pour que ce qu'un humain a ajouté survive
   * (comptes, titres, secret machine, mappers posés dans la console).
   *
   * @param request - fournisseur, fichier, client machine, canal arrière
   * @returns le fichier, son contenu, le realm à écrire et les constats
   * @throws {KeycloakRealmError} Fournisseur absent ou mal décrit, fichier qui
   *   n'est pas un realm
   */
  realmPlan(request: IKeycloakRealmRequest = {}): IKeycloakRealmPlan {
    const root = this.kernel?.path ?? process.cwd();
    const file =
      request.file === undefined
        ? defaultRealmFile(root)
        : path.resolve(root, request.file);
    const current = readIfPresentSync(file);
    let existing: TKeycloakObject | null = null;
    if (current !== null) {
      const parsed: unknown = JSON.parse(current);
      if (!isKeycloakObject(parsed)) {
        throw new KeycloakRealmError(
          `${file} n'est pas un realm (objet JSON attendu)`,
        );
      }
      existing = parsed;
    }
    const kernelOptions: unknown = this.kernel?.options;
    const servers = isRecord(kernelOptions) ? kernelOptions.servers : undefined;
    const appServers: IAppServers = {
      httpPort: portOf(servers, "http", 5151),
      httpsPort: portOf(servers, "https", 5152),
    };
    const derivation = deriveKeycloakRealmInput({
      providerName: request.provider ?? "keycloak",
      config: this.config(),
      servers: appServers,
      production: this.kernel?.environment === "production",
      machine: machineClient(existing, request.machine),
      currentLoginTheme:
        typeof existing?.loginTheme === "string" ? existing.loginTheme : null,
      ...(request.backchannelOrigin === undefined
        ? {}
        : { backchannelOrigin: request.backchannelOrigin }),
    });
    const derived = buildKeycloakRealm(derivation.input);
    const realm =
      existing === null ? derived : mergeKeycloakRealm(existing, derived);
    const text = renderKeycloakRealm(realm);
    return {
      file,
      current,
      text,
      warnings: derivation.warnings,
      upToDate: current === text,
    };
  }

  /**
   * Écrit le realm d'un plan — rien si le fichier est déjà à jour.
   *
   * ⚠️ Keycloak n'importe un realm qu'à sa CRÉATION : un realm déjà présent ne
   * relit pas ce fichier ({@link applyLoginTheme} pour le thème, import
   * partiel dans la console pour le reste).
   *
   * @param plan - le rendu de {@link realmPlan}
   * @returns `true` si le fichier a été écrit
   */
  writeRealm(plan: IKeycloakRealmPlan): boolean {
    if (plan.upToDate) return false;
    mkdirSync(path.dirname(plan.file), { recursive: true });
    writeFileSync(plan.file, plan.text);
    return true;
  }

  /**
   * Le client de l'API d'administration d'un fournisseur Keycloak.
   *
   * @param providerName - nom dans `oauth2.providers` (défaut `keycloak`)
   * @returns le client, construit au premier appel puis gardé (jeton réutilisé)
   * @throws {KeycloakAdminError} Hors développement, fournisseur absent, sans
   *   émetteur ou sans compte d'administration
   */
  admin(providerName = "keycloak"): KeycloakAdminClient {
    const cached = this.#clients?.get(providerName);
    if (cached !== undefined) return cached;
    const client = new KeycloakAdminClient({
      ...keycloakAdminTarget(this.config(), providerName),
      environment: this.kernel?.environment ?? "production",
    });
    this.#clients ??= new Map();
    this.#clients.set(providerName, client);
    return client;
  }

  /**
   * Le thème de connexion qu'un habillage demande à Keycloak.
   *
   * @param skin - habillage ; défaut : `loginPage.skin` de la configuration
   * @returns `nodefony` ou `nodefony-<habillage>`
   */
  expectedLoginTheme(skin?: LoginPageSkin): string {
    return keycloakLoginTheme(skin ?? this.config().loginPage.skin);
  }

  /**
   * Pose sur le realm VIVANT le thème de connexion d'un habillage.
   *
   * @param options - fournisseur (défaut `keycloak`) et habillage (défaut :
   *   `loginPage.skin` ; un aperçu de `/login` passe le sien)
   * @returns le thème d'avant, celui demandé, et ce qui a été fait
   * @throws {KeycloakAdminError} Hors développement, compte absent ou refusé,
   *   Keycloak injoignable
   */
  applyLoginTheme(
    options: { provider?: string; skin?: LoginPageSkin } = {},
  ): Promise<IKeycloakLoginThemeResult> {
    return this.admin(options.provider).applyLoginTheme(
      options.skin ?? this.config().loginPage.skin,
    );
  }
}

export { KeycloakService };
export default KeycloakService;
