import {
  AUTH_LOGIN_PATH,
  AUTH_LOGIN_TOTP_PATH,
  AUTH_LOGOUT_PATH,
  AUTH_ME_PATH,
  MFA_METHOD_TOTP,
  OAUTH2_PROVIDERS_PATH,
  WEBAUTHN_LOGIN_OPTIONS_PATH,
  WEBAUTHN_LOGIN_VERIFY_PATH,
  oauth2AuthorizePath,
} from "../../runtime/authRoutes";

/**
 * Étape du déroulé de connexion.
 *
 * - `identifier` : on attend le nom du compte ;
 * - `password` : le compte est saisi, on attend son mot de passe ;
 * - `mfa` : le mot de passe est bon, le serveur exige un second facteur ;
 * - `authenticated` : la session est ouverte.
 */
export type LoginStep = "identifier" | "password" | "mfa" | "authenticated";

// Seconds facteurs que ce client sait conduire (`submitMfaCode`).
const SUPPORTED_MFA: ReadonlySet<unknown> = new Set([MFA_METHOD_TOTP]);

/**
 * Nature d'un échec, classée pour que l'écran sache QUOI dire.
 *
 * - `credentials` : refus du serveur (401/403) — message uniforme relayé tel quel ;
 * - `throttled` : trop d'essais (429) — porte son échéance ;
 * - `network` : aucune réponse du serveur ;
 * - `server` : le serveur a répondu autrement (5xx, réponse inattendue — dont
 *   un défi de second facteur qui ne propose aucune méthode connue) ;
 * - `cancelled` : l'utilisateur a refermé l'invite de passkey ;
 * - `unsupported` : le navigateur ne sait pas faire ce qui est demandé.
 */
export type LoginErrorKind =
  | "credentials"
  | "throttled"
  | "network"
  | "server"
  | "cancelled"
  | "unsupported";

/** Identité rendue par le serveur une fois la session ouverte. */
export interface NodefonyLoginUser {
  readonly id: number | string;
  readonly username: string;
  readonly email?: string;
  readonly roles: readonly string[];
  readonly [field: string]: unknown;
}

/** Fournisseur de connexion, tel que le SERVEUR le présente. */
export interface NodefonyLoginProvider {
  readonly name: string;
  readonly label: string;
}

/** Échec classé de la dernière action. */
export interface NodefonyLoginError {
  readonly kind: LoginErrorKind;
  /**
   * Message du serveur, relayé TEL QUEL — en particulier le refus uniforme
   * d'un 401, qui ne doit jamais être reformulé : le préciser côté client
   * dirait à un inconnu si le compte existe. Vide quand il n'y en a pas.
   */
  readonly message: string;
  /** Statut HTTP, `null` quand le serveur n'a pas répondu. */
  readonly status: number | null;
  /** Fin du blocage (millisecondes depuis l'époque) — seulement pour `throttled`. */
  readonly retryAt: number | null;
}

/** Photographie du déroulé — un objet NEUF à chaque changement, jamais muté. */
export interface NodefonyLoginState {
  readonly step: LoginStep;
  /** Compte saisi (ou rendu par le serveur une fois connecté). */
  readonly identifier: string;
  /** Une requête est en vol : l'écran désactive ses boutons. */
  readonly pending: boolean;
  /** Identité de la session, `null` tant qu'elle n'est pas ouverte. */
  readonly user: NodefonyLoginUser | null;
  /**
   * Seconds facteurs proposés par le serveur à l'étape `mfa`, réduits à ceux
   * que ce client sait conduire (aujourd'hui `totp`).
   */
  readonly mfaMethods: readonly string[];
  readonly error: NodefonyLoginError | null;
  /** Fournisseurs configurés ; `null` tant que {@link NodefonyLogin.loadProviders} n'a pas répondu. */
  readonly providers: readonly NodefonyLoginProvider[] | null;
  /** Le navigateur sait-il signer avec une passkey ? Constaté, jamais supposé. */
  readonly passkeyAvailable: boolean;
}

/**
 * Ce qui signe un défi WebAuthn. Par défaut, l'API native du navigateur ;
 * injectable pour un test, ou pour une bibliothèque qui couvre les navigateurs
 * anciens.
 */
export interface NodefonyPasskeyAgent {
  /**
   * Fait signer le défi par l'authentificateur de l'utilisateur.
   *
   * @param options - options de requête WebAuthn en JSON, telles que les rend le serveur
   * @returns l'assertion en JSON, à renvoyer au serveur
   * @throws `NotAllowedError` (DOMException) quand l'utilisateur referme l'invite
   */
  sign(options: unknown): Promise<unknown>;
}

/** Réglages de {@link NodefonyLogin} — tous facultatifs. */
export interface NodefonyLoginOptions {
  /** Origine du serveur ; vide = même origine que la page. */
  readonly baseUrl?: string;
  /** Compte prérempli (le dernier utilisé, mémorisé par l'application). */
  readonly identifier?: string;
  /** `fetch` à employer ; défaut : celui du navigateur. */
  readonly fetch?: typeof fetch;
  /** Navigation pleine page vers un fournisseur ; défaut : `location.assign`. */
  readonly navigate?: (url: string) => void;
  /** Signataire de passkey ; défaut : l'API WebAuthn native, si elle est complète. */
  readonly passkey?: NodefonyPasskeyAgent | null;
  /** Horloge (ms) ; défaut : `Date.now`. */
  readonly now?: () => number;
  /** Attente appliquée quand un 429 ne dit pas combien de temps (secondes). */
  readonly defaultRetryAfterS?: number;
}

const DEFAULT_RETRY_AFTER_S = 30;

/** Réponse HTTP réduite à ce que le déroulé lit. */
interface IReply {
  readonly status: number;
  readonly body: unknown;
  readonly retryAfterS: number | null;
}

/** Le serveur n'a pas répondu — distinct d'une réponse d'erreur. */
class NetworkFailure extends Error {}

/** Le serveur Nodefony enveloppe parfois sa réponse dans `{ result }`. */
function unwrap(payload: unknown): unknown {
  if (payload !== null && typeof payload === "object" && "result" in payload) {
    return payload.result;
  }
  return payload;
}

/** Lit une propriété d'une réponse JSON dont on ne connaît pas la forme. */
function field(body: unknown, key: string): unknown {
  if (body === null || typeof body !== "object") return undefined;
  const value: unknown = Reflect.get(body, key);
  return value;
}

function positiveSeconds(value: unknown): number | null {
  const n = typeof value === "string" ? Number(value) : value;
  return typeof n === "number" && Number.isFinite(n) && n > 0
    ? Math.ceil(n)
    : null;
}

/**
 * Délai d'un 429 : l'en-tête `Retry-After` (RFC 9110 §10.2.3) d'abord, puis le
 * corps — `retryAfter` à la racine ou sous `error`, les deux formes servies.
 */
function retryAfterOf(reply: IReply): number | null {
  const error = field(reply.body, "error");
  return (
    reply.retryAfterS ??
    positiveSeconds(field(reply.body, "retryAfter")) ??
    positiveSeconds(field(error, "retryAfter"))
  );
}

function serverMessage(body: unknown): string {
  const error = field(body, "error");
  if (typeof error === "string") return error;
  const nested = field(error, "message");
  if (typeof nested === "string") return nested;
  const message = field(body, "message");
  return typeof message === "string" ? message : "";
}

/**
 * L'identité rendue par le serveur a-t-elle la forme promise ? Vérifiée, pas
 * supposée : une réponse sans `username` ni `roles` n'ouvre pas l'état
 * `authenticated`, elle est classée comme une réponse inattendue.
 */
function isLoginUser(value: unknown): value is NodefonyLoginUser {
  const id = field(value, "id");
  return (
    (typeof id === "string" || typeof id === "number") &&
    typeof field(value, "username") === "string" &&
    Array.isArray(field(value, "roles"))
  );
}

function asUser(body: unknown): NodefonyLoginUser | null {
  const user = field(body, "user");
  return isLoginUser(user) ? user : null;
}

function asProviders(value: unknown): readonly NodefonyLoginProvider[] {
  const list = field(value, "providers");
  if (!Array.isArray(list)) return [];
  return list.flatMap((p: unknown) => {
    const name = field(p, "name");
    if (typeof name !== "string" || name === "") return [];
    const label = field(p, "label");
    return [{ name, label: typeof label === "string" ? label : name }];
  });
}

/**
 * Signataire WebAuthn natif, rendu SEULEMENT si le navigateur porte les trois
 * pièces : `PublicKeyCredential.parseRequestOptionsFromJSON`,
 * `navigator.credentials.get` et l'assertion sérialisable (`toJSON`, vérifiée
 * à l'usage). Une capacité se constate : en déduire la présence de la seule
 * existence de `PublicKeyCredential` laisserait un bouton qui échoue au clic
 * sur les navigateurs qui ont l'objet sans l'interface JSON.
 */
function nativePasskeyAgent(): NodefonyPasskeyAgent | null {
  const scope = globalThis as {
    PublicKeyCredential?: { parseRequestOptionsFromJSON?: unknown };
    navigator?: { credentials?: { get?: unknown } };
  };
  const parse = scope.PublicKeyCredential?.parseRequestOptionsFromJSON;
  const credentials = scope.navigator?.credentials;
  const get = credentials?.get;
  if (typeof parse !== "function" || typeof get !== "function") return null;
  return {
    async sign(options: unknown): Promise<unknown> {
      const publicKey: unknown = parse.call(scope.PublicKeyCredential, options);
      const credential: unknown = await get.call(credentials, { publicKey });
      const toJSON = field(credential, "toJSON");
      if (typeof toJSON !== "function") {
        throw new TypeError("assertion WebAuthn non sérialisable");
      }
      return toJSON.call(credential);
    },
  };
}

function isCancellation(error: unknown): boolean {
  const name = field(error, "name");
  return name === "NotAllowedError" || name === "AbortError";
}

/**
 * Le **déroulé de connexion** côté navigateur : une machine à états PURE, sans
 * DOM ni framework d'affichage, branchée sur les routes de session du
 * framework. Le pendant de `NodefonySocket` et de `NodefonySse` pour
 * l'authentification.
 *
 * Le design appartient entièrement à l'application, qui lit l'état
 * ({@link NodefonyLogin.getState}, {@link NodefonyLogin.subscribe}) et appelle
 * les actions ; la classe porte les RÈGLES : enchaînement identifiant → mot de
 * passe → second facteur, blocage après trop d'essais, classement des échecs,
 * fournisseurs externes, passkey. Elle ne redirige jamais après la connexion :
 * elle rend l'état `authenticated`, et c'est l'appelant qui navigue.
 *
 * Les liaisons `nodefony/{react,vue,svelte,angular}` ne font que relayer son
 * état ({@link observeLogin}) — aucune règle n'y est réécrite.
 *
 * @example
 * ```ts
 * const login = new NodefonyLogin();
 * login.subscribe((s) => render(s));
 * await login.login("admin", "secret");
 * if (login.getState().step === "mfa") await login.submitMfaCode("123456");
 * ```
 */
export class NodefonyLogin {
  readonly #base: string;
  readonly #fetch: typeof fetch;
  readonly #now: () => number;
  readonly #navigate: (url: string) => void;
  readonly #passkey: NodefonyPasskeyAgent | null;
  readonly #defaultRetryAfterS: number;
  #state: NodefonyLoginState;
  #listeners: ((s: NodefonyLoginState) => void)[] | null = null;
  #providersRequest: Promise<readonly NodefonyLoginProvider[]> | null = null;

  /**
   * @param options - réglages facultatifs (origine, compte prérempli, injections de test)
   */
  constructor(options: NodefonyLoginOptions = {}) {
    this.#base = options.baseUrl ?? "";
    this.#fetch =
      options.fetch ?? ((input, init) => globalThis.fetch(input, init));
    this.#now = options.now ?? Date.now;
    this.#navigate =
      options.navigate ??
      ((url: string): void => {
        globalThis.location.assign(url);
      });
    this.#passkey =
      options.passkey === undefined ? nativePasskeyAgent() : options.passkey;
    this.#defaultRetryAfterS =
      options.defaultRetryAfterS ?? DEFAULT_RETRY_AFTER_S;
    const identifier = (options.identifier ?? "").trim();
    this.#state = {
      step: identifier === "" ? "identifier" : "password",
      identifier,
      pending: false,
      user: null,
      mfaMethods: [],
      error: null,
      providers: null,
      passkeyAvailable: this.#passkey !== null,
    };
  }

  /**
   * État courant — le même objet tant que rien n'a changé.
   *
   * Lié à l'instance : se passe tel quel en rappel (`useSyncExternalStore`).
   */
  readonly getState = (): NodefonyLoginState => this.#state;

  /**
   * Écoute les changements d'état. Lié à l'instance, comme {@link getState}.
   *
   * @returns la fonction qui retire l'écouteur
   */
  readonly subscribe = (
    listener: (state: NodefonyLoginState) => void,
  ): (() => void) => {
    (this.#listeners ??= []).push(listener);
    return () => {
      if (this.#listeners === null) return;
      const index = this.#listeners.indexOf(listener);
      if (index !== -1) this.#listeners.splice(index, 1);
      if (this.#listeners.length === 0) this.#listeners = null;
    };
  };

  /** Valide le compte saisi et passe à l'étape `password`. */
  submitIdentifier(identifier: string): void {
    const value = identifier.trim();
    if (value === "") return;
    this.#set({ step: "password", identifier: value, error: null });
  }

  /** Envoie le mot de passe du compte saisi. */
  submitPassword(password: string): Promise<NodefonyLoginState> {
    const username = this.#state.identifier;
    if (username === "") return Promise.resolve(this.#state);
    return this.#run(async () => {
      const reply = await this.#request("POST", AUTH_LOGIN_PATH, {
        username,
        password,
      });
      if (reply.status === 202 && field(reply.body, "mfaRequired") === true) {
        // Défi : liste OUVERTE. On ne retient que ce qu'on sait conduire ;
        // rien de connu = réponse inattendue, jamais un écran de code inutile.
        const methods = field(reply.body, "methods");
        const usable = Array.isArray(methods)
          ? methods.filter((m): m is string => SUPPORTED_MFA.has(m))
          : [];
        if (usable.length === 0) {
          return this.#set({
            pending: false,
            error: {
              kind: "server",
              message: "",
              status: reply.status,
              retryAt: null,
            },
          });
        }
        return this.#set({ step: "mfa", pending: false, mfaMethods: usable });
      }
      return this.#settle(reply);
    });
  }

  /** Raccourci des formulaires d'un seul écran : compte et mot de passe d'un coup. */
  login(identifier: string, password: string): Promise<NodefonyLoginState> {
    this.submitIdentifier(identifier);
    return this.submitPassword(password);
  }

  /** Envoie le code du second facteur (TOTP ou code de récupération). */
  submitMfaCode(code: string): Promise<NodefonyLoginState> {
    if (this.#state.step !== "mfa") return Promise.resolve(this.#state);
    return this.#run(async () =>
      this.#settle(
        await this.#request("POST", AUTH_LOGIN_TOTP_PATH, {
          // Les espaces d'un code recopié ne doivent pas le faire refuser.
          code: code.replace(/\s+/gu, ""),
        }),
      ),
    );
  }

  /** Connexion par passkey, sans identifiant ni mot de passe. */
  loginWithPasskey(): Promise<NodefonyLoginState> {
    const passkey = this.#passkey;
    if (passkey === null) {
      return Promise.resolve(
        this.#set({
          error: {
            kind: "unsupported",
            message: "",
            status: null,
            retryAt: null,
          },
        }),
      );
    }
    return this.#run(async () => {
      const challenge = await this.#request(
        "POST",
        WEBAUTHN_LOGIN_OPTIONS_PATH,
        {},
      );
      if (challenge.status !== 200) return this.#failure(challenge);
      const assertion = await passkey.sign(challenge.body);
      return this.#settle(
        await this.#request("POST", WEBAUTHN_LOGIN_VERIFY_PATH, {
          response: assertion,
        }),
      );
    });
  }

  /** Charge la liste des fournisseurs (une requête, rejouée seulement après échec). */
  loadProviders(): Promise<readonly NodefonyLoginProvider[]> {
    return (this.#providersRequest ??= this.#request(
      "GET",
      OAUTH2_PROVIDERS_PATH,
    ).then(
      (reply) => {
        if (reply.status !== 200) {
          this.#providersRequest = null;
          return [];
        }
        const providers = asProviders(reply.body);
        this.#set({ providers });
        return providers;
      },
      () => {
        this.#providersRequest = null;
        return [];
      },
    ));
  }

  /**
   * Part chez un fournisseur, en navigation PLEINE PAGE — jamais par `fetch` :
   * le navigateur doit suivre les redirections et revenir avec le cookie de
   * session posé au retour.
   *
   * @param name - nom du fournisseur, tel que le rend {@link loadProviders}
   * @param from - page où revenir une fois connecté ; le serveur n'accepte
   *   qu'un chemin local, et retombe sinon sur sa redirection de succès
   */
  startProvider(name: string, from?: string): void {
    this.#navigate(`${this.#base}${oauth2AuthorizePath(name, from)}`);
  }

  /** Reprend une session existante ; `null` quand il n'y en a pas. */
  async me(): Promise<NodefonyLoginUser | null> {
    try {
      const reply = await this.#request("GET", AUTH_ME_PATH);
      const user = reply.status === 200 ? asUser(reply.body) : null;
      if (user !== null) this.#authenticated(user);
      return user;
    } catch {
      return null;
    }
  }

  /**
   * Ferme la session et revient à l'étape `identifier`.
   *
   * @returns l'adresse de déconnexion du fournisseur quand la session venait de
   *   lui (à suivre pour fermer AUSSI sa session), `null` sinon
   */
  async logout(): Promise<string | null> {
    let logoutUrl: string | null = null;
    try {
      const reply = await this.#request("POST", AUTH_LOGOUT_PATH);
      const url = field(reply.body, "logoutUrl");
      logoutUrl = typeof url === "string" && url !== "" ? url : null;
    } catch {
      // Serveur injoignable : l'écran revient quand même à l'identifiant —
      // la session, si elle vit encore, sera reprise par `me()`.
      logoutUrl = null;
    } finally {
      this.#set({
        step: "identifier",
        pending: false,
        user: null,
        mfaMethods: [],
        error: null,
      });
    }
    return logoutUrl;
  }

  /** Revient à l'étape `identifier`, en gardant le compte saisi. */
  back(): void {
    if (this.#state.pending) return;
    this.#set({ step: "identifier", mfaMethods: [], error: null });
  }

  #set(patch: Partial<NodefonyLoginState>): NodefonyLoginState {
    this.#state = { ...this.#state, ...patch };
    const listeners = this.#listeners;
    if (listeners !== null) {
      // Copie : un écouteur peut se désabonner pendant la notification, et
      // retirer un élément du tableau parcouru ferait sauter son voisin.
      for (const listener of listeners.slice()) listener(this.#state);
    }
    return this.#state;
  }

  async #request(
    method: "GET" | "POST",
    path: string,
    body?: unknown,
  ): Promise<IReply> {
    let response: Response;
    try {
      response = await this.#fetch(`${this.#base}${path}`, {
        method,
        credentials: "same-origin",
        headers:
          body === undefined
            ? { accept: "application/json" }
            : {
                accept: "application/json",
                "content-type": "application/json",
              },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch (error) {
      throw new NetworkFailure(
        error instanceof Error ? error.message : String(error),
      );
    }
    let parsed: unknown = null;
    try {
      parsed = unwrap(await response.json());
    } catch {
      parsed = null;
    }
    return {
      status: response.status,
      body: parsed,
      retryAfterS: positiveSeconds(response.headers.get("retry-after")),
    };
  }

  /** Une réponse qui DOIT porter une identité : session ouverte, ou échec classé. */
  #settle(reply: IReply): NodefonyLoginState {
    const user = reply.status === 200 ? asUser(reply.body) : null;
    return user === null ? this.#failure(reply) : this.#authenticated(user);
  }

  #authenticated(user: NodefonyLoginUser): NodefonyLoginState {
    return this.#set({
      step: "authenticated",
      identifier: user.username,
      pending: false,
      user,
      mfaMethods: [],
      error: null,
    });
  }

  #failure(reply: IReply | null, error?: unknown): NodefonyLoginState {
    if (reply === null) {
      return this.#set({
        pending: false,
        error: isCancellation(error)
          ? { kind: "cancelled", message: "", status: null, retryAt: null }
          : {
              kind: error instanceof NetworkFailure ? "network" : "server",
              message: error instanceof Error ? error.message : "",
              status: null,
              retryAt: null,
            },
      });
    }
    if (reply.status === 429) {
      const seconds = retryAfterOf(reply) ?? this.#defaultRetryAfterS;
      return this.#set({
        pending: false,
        error: {
          kind: "throttled",
          message: serverMessage(reply.body),
          status: 429,
          retryAt: this.#now() + seconds * 1000,
        },
      });
    }
    return this.#set({
      pending: false,
      error: {
        kind:
          reply.status === 401 || reply.status === 403
            ? "credentials"
            : "server",
        message: serverMessage(reply.body),
        status: reply.status,
        retryAt: null,
      },
    });
  }

  /** Un blocage encore en cours refuse l'action sans requête. */
  #throttled(): boolean {
    const retryAt = this.#state.error?.retryAt ?? null;
    return retryAt !== null && this.#now() < retryAt;
  }

  /** Mène une action réseau : refus si déjà en vol ou bloqué, puis classement. */
  async #run(
    action: () => Promise<NodefonyLoginState>,
  ): Promise<NodefonyLoginState> {
    if (this.#state.pending || this.#throttled()) return this.#state;
    this.#set({ pending: true, error: null });
    try {
      return await action();
    } catch (error) {
      return this.#failure(null, error);
    }
  }
}

/**
 * Relaie l'état d'un {@link NodefonyLogin} vers un rappel : une fois tout de
 * suite, puis à chaque changement. C'est le seul point d'attache des liaisons
 * `nodefony/{react,vue,svelte,angular}` — même forme que `observeSse`.
 *
 * @param login - le déroulé de connexion
 * @param onChange - reçoit chaque nouvel état
 * @returns la fonction qui libère l'abonnement
 */
export function observeLogin(
  login: NodefonyLogin,
  onChange: (state: NodefonyLoginState) => void,
): () => void {
  const release = login.subscribe(onChange);
  onChange(login.getState());
  return release;
}
