/**
 * Le realm Keycloak d'une application — construit, jamais recopié.
 *
 * Deux usages, UNE construction : la contribution du paquet à une application
 * neuve (`nodefony/keycloak/scaffold.ts`, jouée par `create app` après
 * l'installation) écrit son realm d'import, et `security:keycloak:realm` le
 * réécrit depuis la configuration EFFECTIVE d'une application qui tourne. Le
 * cœur n'en sait rien : Keycloak est l'affaire de ce paquet.
 *
 * Avant lui, deux realms écrits à la main — celui du dépôt et le gabarit de
 * l'application générée — répétaient ce que disait la configuration
 * (identifiant de client, URL de retour, audience). Ils avaient divergé : le
 * realm généré était né sans audience, et tout jeton y était refusé.
 *
 * Fonctions PURES : aucune lecture de disque, aucun environnement.
 *
 * @module
 */

/** Une valeur JSON — ce qu'un realm d'import peut contenir. */
export type TKeycloakJson =
  | string
  | number
  | boolean
  | null
  | TKeycloakJson[]
  | { [key: string]: TKeycloakJson };

/** Un objet JSON du realm (client, mapper, utilisateur…). */
export type TKeycloakObject = { [key: string]: TKeycloakJson };

/** Un rôle à déclarer dans le realm. */
export interface IKeycloakRoleInput {
  /** Nom du rôle CÔTÉ KEYCLOAK (la clé de `roleMapping`). */
  readonly name: string;
  /** Texte affiché dans la console Keycloak. */
  readonly description?: string;
}

/** Un compte de démonstration semé dans le realm de développement. */
export interface IKeycloakUserInput {
  /** Identifiant FIXÉ : laissé à Keycloak, il change à chaque réimport. */
  readonly id: string;
  readonly username: string;
  readonly email: string;
  readonly firstName: string;
  readonly lastName: string;
  /** Mot de passe de DÉVELOPPEMENT, public par nature. */
  readonly password: string;
  /** Rôles du client navigateur accordés à ce compte. */
  readonly clientRoles?: readonly string[];
}

/** Le client « machine » (compte de service, `client_credentials`). */
export interface IKeycloakMachineInput {
  readonly clientId: string;
  /** Secret de développement ; `null` = laissé à Keycloak (production). */
  readonly secret: string | null;
  readonly name?: string;
  readonly description?: string;
}

/** Tout ce que le realm dit de l'application. */
export interface IKeycloakRealmInput {
  /** Nom du realm — le dernier segment de l'émetteur (`…/realms/<nom>`). */
  readonly realm: string;
  /** Titre affiché sur la page de connexion. */
  readonly displayName?: string;
  /** Identifiant du client navigateur (`oauth2.providers.<p>.clientId`). */
  readonly clientId: string;
  /** Secret du client ; `null` = laissé à Keycloak (production). */
  readonly clientSecret: string | null;
  readonly clientName?: string;
  readonly clientDescription?: string;
  /** URL de retour EXACTES (RFC 9700 : comparaison au caractère près). */
  readonly redirectUris: readonly string[];
  /** Où Keycloak a le droit de renvoyer le navigateur après déconnexion. */
  readonly postLogoutRedirectUris: readonly string[];
  /** Point de déconnexion par canal arrière ; `null` = aucun. */
  readonly backchannelLogoutUrl: string | null;
  /**
   * Ressources pour lesquelles Keycloak émet des jetons à cette application :
   * un mapper d'audience par entrée, sur chaque client. Vide = aucun mapper,
   * et le jeton porte alors `aud: "account"`, que toute zone refuse.
   */
  readonly audiences: readonly string[];
  /** Rôles du client navigateur (`rolesSource: ["client"]`). */
  readonly clientRoles: readonly IKeycloakRoleInput[];
  /** Rôles du realm (`rolesSource: ["realm"]`). */
  readonly realmRoles: readonly IKeycloakRoleInput[];
  /** Client machine ; `null` = aucun. */
  readonly machine: IKeycloakMachineInput | null;
  /** Thèmes à déclarer ; absent = ceux de Keycloak. */
  readonly themes?: {
    readonly login?: string;
    readonly account?: string;
    readonly email?: string;
    readonly admin?: string;
  };
  /** Comptes de démonstration (développement seulement). */
  readonly users?: readonly IKeycloakUserInput[];
}

/** Le type du mapper qui ajoute une audience au jeton d'accès. */
const AUDIENCE_MAPPER = "oidc-audience-mapper";

/**
 * Le nom d'un mapper d'audience — stable, pour qu'une régénération réécrive
 * le même mapper au lieu d'en ajouter un.
 */
function audienceMapperName(realm: string, index: number): string {
  return index === 0
    ? `audience-${realm}-api`
    : `audience-${realm}-api-${index + 1}`;
}

function audienceMappers(input: IKeycloakRealmInput): TKeycloakObject[] {
  return input.audiences.map((audience, index) => ({
    name: audienceMapperName(input.realm, index),
    protocol: "openid-connect",
    protocolMapper: AUDIENCE_MAPPER,
    config: {
      "included.custom.audience": audience,
      "access.token.claim": "true",
      "id.token.claim": "false",
      "introspection.token.claim": "true",
    },
  }));
}

function roleObjects(roles: readonly IKeycloakRoleInput[]): TKeycloakObject[] {
  return roles.map((role) =>
    role.description === undefined
      ? { name: role.name }
      : { name: role.name, description: role.description },
  );
}

function browserClient(input: IKeycloakRealmInput): TKeycloakObject {
  const attributes: TKeycloakObject = {
    "pkce.code.challenge.method": "S256",
    "post.logout.redirect.uris": input.postLogoutRedirectUris.join("##"),
  };
  if (input.backchannelLogoutUrl !== null) {
    attributes["backchannel.logout.url"] = input.backchannelLogoutUrl;
    attributes["backchannel.logout.session.required"] = "true";
    attributes["backchannel.logout.revoke.offline.tokens"] = "false";
  }
  return {
    clientId: input.clientId,
    ...(input.clientName === undefined ? {} : { name: input.clientName }),
    ...(input.clientDescription === undefined
      ? {}
      : { description: input.clientDescription }),
    enabled: true,
    protocol: "openid-connect",
    publicClient: false,
    clientAuthenticatorType: "client-secret",
    ...(input.clientSecret === null ? {} : { secret: input.clientSecret }),
    standardFlowEnabled: true,
    implicitFlowEnabled: false,
    directAccessGrantsEnabled: false,
    serviceAccountsEnabled: false,
    // La déconnexion passe par le canal ARRIÈRE (serveur à serveur) : le
    // canal avant dépend d'une iframe que les navigateurs bloquent.
    frontchannelLogout: false,
    redirectUris: [...input.redirectUris],
    webOrigins: ["+"],
    attributes,
    protocolMappers: audienceMappers(input),
  };
}

function machineClient(
  input: IKeycloakRealmInput,
  machine: IKeycloakMachineInput,
): TKeycloakObject {
  return {
    clientId: machine.clientId,
    ...(machine.name === undefined ? {} : { name: machine.name }),
    ...(machine.description === undefined
      ? {}
      : { description: machine.description }),
    enabled: true,
    protocol: "openid-connect",
    publicClient: false,
    clientAuthenticatorType: "client-secret",
    ...(machine.secret === null ? {} : { secret: machine.secret }),
    standardFlowEnabled: false,
    implicitFlowEnabled: false,
    directAccessGrantsEnabled: false,
    serviceAccountsEnabled: true,
    protocolMappers: audienceMappers(input),
  };
}

/**
 * Le rôle composite que Keycloak donne à tout compte CRÉÉ dans le realm —
 * `manage-account`, `view-profile`, `offline_access`, `uma_authorization`.
 *
 * ⚠️ Un compte IMPORTÉ ne le reçoit pas : l'import n'accorde que les rôles
 * qu'il liste. Sans lui, la console du compte rend 401 sur le profil même de
 * l'utilisateur.
 *
 * @param realm - nom du realm
 * @returns le nom du rôle par défaut
 */
export function keycloakDefaultRole(realm: string): string {
  return `default-roles-${realm}`;
}

function userObject(
  realm: string,
  clientId: string,
  user: IKeycloakUserInput,
): TKeycloakObject {
  return {
    id: user.id,
    username: user.username,
    enabled: true,
    email: user.email,
    emailVerified: true,
    firstName: user.firstName,
    lastName: user.lastName,
    credentials: [{ type: "password", value: user.password, temporary: false }],
    realmRoles: [keycloakDefaultRole(realm)],
    ...(user.clientRoles === undefined || user.clientRoles.length === 0
      ? {}
      : { clientRoles: { [clientId]: [...user.clientRoles] } }),
  };
}

/**
 * Construit le realm d'import complet d'une application.
 *
 * @param input - ce que la configuration de l'application dit du realm
 * @returns le realm, prêt à être sérialisé par {@link renderKeycloakRealm}
 */
export function buildKeycloakRealm(
  input: IKeycloakRealmInput,
): TKeycloakObject {
  const roles: TKeycloakObject = {};
  if (input.realmRoles.length > 0) roles.realm = roleObjects(input.realmRoles);
  if (input.clientRoles.length > 0) {
    roles.client = { [input.clientId]: roleObjects(input.clientRoles) };
  }
  const clients = [browserClient(input)];
  if (input.machine !== null) clients.push(machineClient(input, input.machine));
  return {
    realm: input.realm,
    displayName: input.displayName ?? input.realm,
    enabled: true,
    sslRequired: "external",
    registrationAllowed: false,
    loginWithEmailAllowed: true,
    ...(input.themes?.login === undefined
      ? {}
      : { loginTheme: input.themes.login }),
    ...(input.themes?.account === undefined
      ? {}
      : { accountTheme: input.themes.account }),
    ...(input.themes?.email === undefined
      ? {}
      : { emailTheme: input.themes.email }),
    ...(input.themes?.admin === undefined
      ? {}
      : { adminTheme: input.themes.admin }),
    internationalizationEnabled: true,
    supportedLocales: ["fr", "en"],
    defaultLocale: "fr",
    clients,
    ...(Object.keys(roles).length === 0 ? {} : { roles }),
    ...(input.users === undefined || input.users.length === 0
      ? {}
      : {
          users: input.users.map((u) =>
            userObject(input.realm, input.clientId, u),
          ),
        }),
    rememberMe: true,
  };
}

function isObject(value: TKeycloakJson | undefined): value is TKeycloakObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function objects(value: TKeycloakJson | undefined): TKeycloakObject[] {
  return Array.isArray(value) ? value.filter(isObject) : [];
}

/**
 * Les champs qu'un client hérite du realm existant quand il y figure : un nom,
 * un texte, un secret machine sont écrits par un humain, pas par la config.
 */
const CLIENT_KEPT = new Set(["name", "description"]);

function mergeClient(
  existing: TKeycloakObject,
  derived: TKeycloakObject,
  keepSecret: boolean,
): TKeycloakObject {
  const merged: TKeycloakObject = { ...existing };
  for (const [key, value] of Object.entries(derived)) {
    if (CLIENT_KEPT.has(key) && key in existing) continue;
    if (key === "secret" && keepSecret && key in existing) continue;
    if (
      key === "attributes" &&
      isObject(existing.attributes) &&
      isObject(value)
    ) {
      merged.attributes = { ...existing.attributes, ...value };
      continue;
    }
    if (key === "protocolMappers") {
      // L'audience APPARTIENT à la config : ses mappers sont tous réécrits.
      // Les autres (rôles, groupes, attributs posés dans la console) restent.
      const others = objects(existing.protocolMappers).filter(
        (m) => m.protocolMapper !== AUDIENCE_MAPPER,
      );
      merged.protocolMappers = [...others, ...objects(value)];
      continue;
    }
    merged[key] = value;
  }
  return merged;
}

function mergeRoles(
  existing: TKeycloakJson | undefined,
  derived: TKeycloakJson | undefined,
): TKeycloakObject[] {
  const kept = objects(existing);
  const names = new Set(kept.map((r) => r.name));
  return [...kept, ...objects(derived).filter((r) => !names.has(r.name))];
}

/**
 * Fond un realm dérivé de la config dans le realm d'import existant.
 *
 * Ce que la configuration DIT est réécrit : nom du realm, thèmes déclarés,
 * client navigateur (flux, URL de retour, audience, déconnexion), client
 * machine (flux, audience). Ce qu'un humain a écrit SURVIT : comptes,
 * titre, noms et textes des clients, secret machine, rôles déjà déclarés,
 * mappers qui ne sont pas d'audience, clients et clés inconnus. Régénérer
 * ne détruit donc rien de ce que la console a ajouté.
 *
 * @param existing - le realm lu sur disque (JSON quelconque)
 * @param derived - le realm construit par {@link buildKeycloakRealm}
 * @returns le realm fusionné
 * @throws Si `existing` n'est pas un objet JSON
 */
export function mergeKeycloakRealm(
  existing: TKeycloakJson,
  derived: TKeycloakObject,
): TKeycloakObject {
  if (!isObject(existing)) {
    throw new TypeError("le realm existant n'est pas un objet JSON");
  }
  const merged: TKeycloakObject = { ...existing };
  // Les clés de premier niveau que la config ne porte pas sont des DÉFAUTS :
  // posées si absentes, jamais réécrites.
  for (const [key, value] of Object.entries(derived)) {
    if (!(key in merged)) merged[key] = value;
  }
  merged.realm = derived.realm ?? merged.realm ?? null;
  for (const key of [
    "loginTheme",
    "accountTheme",
    "emailTheme",
    "adminTheme",
  ]) {
    const theme = derived[key];
    if (theme !== undefined) merged[key] = theme;
  }
  const derivedClients = objects(derived.clients);
  const existingClients = objects(existing.clients);
  const browserId = derivedClients[0]?.clientId;
  const clients = existingClients.map((client) => {
    const match = derivedClients.find((d) => d.clientId === client.clientId);
    if (match === undefined) return client;
    return mergeClient(client, match, match.clientId !== browserId);
  });
  for (const client of derivedClients) {
    if (!existingClients.some((c) => c.clientId === client.clientId)) {
      clients.push(client);
    }
  }
  merged.clients = clients;
  if (isObject(derived.roles)) {
    const roles: TKeycloakObject = isObject(existing.roles)
      ? { ...existing.roles }
      : {};
    if (derived.roles.realm !== undefined) {
      roles.realm = mergeRoles(roles.realm, derived.roles.realm);
    }
    if (isObject(derived.roles.client)) {
      const byClient: TKeycloakObject = isObject(roles.client)
        ? { ...roles.client }
        : {};
      for (const [clientId, list] of Object.entries(derived.roles.client)) {
        byClient[clientId] = mergeRoles(byClient[clientId], list);
      }
      roles.client = byClient;
    }
    merged.roles = roles;
  }
  return merged;
}

/** Largeur au-delà de laquelle un tableau se déplie (celle de prettier). */
const PRINT_WIDTH = 80;

function renderValue(
  value: TKeycloakJson,
  indent: string,
  lead: number,
): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  const inner = `${indent}  `;
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    // Un tableau de valeurs simples tient sur une ligne s'il y entre — la
    // forme qu'un formateur lui donne, sans quoi chaque régénération
    // produirait un diff de pure mise en page sur un fichier versionné.
    if (value.every((v) => v === null || typeof v !== "object")) {
      const flat = `[${value.map((v) => JSON.stringify(v)).join(", ")}]`;
      if (lead + flat.length + 1 <= PRINT_WIDTH) return flat;
    }
    const items = value.map(
      (v) => `${inner}${renderValue(v, inner, inner.length)}`,
    );
    return `[\n${items.join(",\n")}\n${indent}]`;
  }
  const entries = Object.entries(value);
  if (entries.length === 0) return "{}";
  const lines = entries.map(([key, v]) => {
    const head = `${inner}${JSON.stringify(key)}: `;
    return `${head}${renderValue(v, inner, head.length)}`;
  });
  return `{\n${lines.join(",\n")}\n${indent}}`;
}

/**
 * Sérialise un realm comme le dépôt l'écrit : deux espaces, tableaux de
 * valeurs simples sur une ligne quand ils tiennent en 80 colonnes, fin de
 * ligne — la forme que prettier donne au fichier versionné.
 *
 * @param realm - le realm à écrire
 * @returns le texte du fichier d'import
 */
export function renderKeycloakRealm(realm: TKeycloakObject): string {
  return `${renderValue(realm, "", 0)}\n`;
}
