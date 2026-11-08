import {
  Command,
  CliKernel,
  CONSOLE_DATA_RUN_PROFILE,
  type OptionsCommandInterface,
} from "nodefony";
import {
  Firewall,
  InvalidTargetError,
  KeycloakService,
  OAuth2RequestError,
  requestClientCredentialsToken,
  TokenService,
  type ISecurityConfig,
} from "@nodefony/security";
import { UserService } from "@nodefony/user";
import { defineDemoConfig } from "../config/defineModuleConfig";
import { PARTNER_AREA, PARTNER_PATH } from "../config/security";

/**
 * Le cycle de vie d'une commande (phase d'arrêt, `quietBoot`, sortie ou
 * journal, arguments) est commenté dans le gabarit de
 * `npx nodefony create command` — générer une commande neuve le montre. Ce
 * fichier ne commente que ce qui lui est propre : OBTENIR un jeton, et
 * l'utiliser.
 */
const options: OptionsCommandInterface = {
  // `--issuer nodefony` lit le compte porteur en base : sans base, la
  // commande n'a pas de sens, elle échoue donc franchement.
  runProfile: CONSOLE_DATA_RUN_PROFILE,
  showBanner: false,
  // Services prêts, AUCUN serveur ouvert : la commande APPELLE l'application
  // qui tourne déjà (`npm run dev`), elle n'en démarre pas une seconde.
  kernelEvent: "onReady",
  quietBoot: true,
  examples: [
    "nodefony demo:partner:call",
    "nodefony demo:partner:call --issuer keycloak --json",
  ],
};

/** Les deux émetteurs que la zone `demo-partner` accepte. */
const ISSUERS = ["nodefony", "keycloak"] as const;
type TIssuer = (typeof ISSUERS)[number];

/**
 * Le Keycloak où demander le jeton : l'émetteur du fournisseur OAuth
 * `keycloak` s'il est configuré, sinon l'émetteur de confiance de la zone
 * quand il est SEUL.
 *
 * Plusieurs émetteurs de confiance sans fournisseur : lequel est Keycloak ne
 * se devine pas — prendre le premier aurait demandé un jeton à un autre
 * serveur, avec le secret de celui-ci. `undefined`, et la commande le dit.
 */
function keycloakIssuer(
  config: ISecurityConfig,
): { issuer: string; discoveryUrl?: string | undefined } | undefined {
  // `Object.hasOwn` : le type vaut `… | undefined` que l'application active ou
  // non `noUncheckedIndexedAccess` — un accès indexé nu rendait le `?.` exigé
  // par l'un des réglages et refusé (« inutile ») par l'autre.
  const providers = config.oauth2.providers;
  const provider = Object.hasOwn(providers, "keycloak")
    ? providers["keycloak"]
    : undefined;
  if (provider?.issuer !== undefined) {
    return { issuer: provider.issuer, discoveryUrl: provider.discoveryUrl };
  }
  const issuers = config.resourceServer.issuers;
  return issuers.length === 1 ? issuers[0] : undefined;
}

/** `value` est-il l'un des émetteurs acceptés ? (la garde rend le type, sans l'affirmer) */
function isIssuer(value: string): value is TIssuer {
  return ISSUERS.some((issuer) => issuer === value);
}

/** Le client machine que le realm de développement déclare pour cette app. */
const MACHINE_CLIENT_ID = "<%= it.appName %>-machine";

/** Durée du jeton signé ici : le temps d'un appel, pas d'une session. */
const TOKEN_TTL_S = 300;

/** Une panne dite à l'utilisateur : ce qui s'est passé, et le geste qui répare. */
class CallFailure extends Error {
  constructor(
    message: string,
    readonly remedy: string,
  ) {
    super(message);
  }
}

/**
 * L'adresse de `whoami` : sous la ressource de la zone — l'adresse publique
 * de l'application, plus le chemin de l'API —, ou sous l'adresse donnée par
 * `--url` quand l'application appelée n'est pas celle-ci.
 */
function whoamiUrl(resource: string, base: string | undefined): URL {
  const root =
    base === undefined ? resource : `${base.replace(/\/+$/u, "")}${PARTNER_PATH}`;
  return new URL(`${root}/whoami`);
}

/** Le premier code d'erreur système (`ECONNREFUSED`, certificat…) d'une chaîne de causes. */
function systemCode(error: unknown): string | null {
  const known =
    /\b(ECONNREFUSED|ENOTFOUND|ETIMEDOUT|SELF_SIGNED_CERT_IN_CHAIN|DEPTH_ZERO_SELF_SIGNED_CERT|UNABLE_TO_VERIFY_LEAF_SIGNATURE|UNABLE_TO_GET_ISSUER_CERT_LOCALLY|ERR_TLS_CERT_ALTNAME_INVALID)\b/u;
  let current: unknown = error;
  for (let depth = 0; current instanceof Error && depth < 5; depth++) {
    const code: unknown = "code" in current ? current.code : undefined;
    if (typeof code === "string" && known.test(code)) return code;
    // La découverte de l'émetteur range le code DANS son message.
    const inMessage = known.exec(current.message);
    if (inMessage) return inMessage[0];
    current = current.cause;
  }
  return null;
}

/**
 * Traduit une panne RÉSEAU en geste : un serveur éteint et un certificat
 * refusé produisent tous deux `fetch failed`, mais ne se réparent pas pareil.
 */
function networkFailure(
  error: unknown,
  target: string,
  start: string,
): CallFailure {
  const code = systemCode(error);
  if (code === "ECONNREFUSED") {
    return new CallFailure(
      `${target} ne répond pas (connexion refusée).`,
      start,
    );
  }
  if (code !== null && /CERT|SIGNATURE|TLS/u.test(code)) {
    return new CallFailure(
      `${target} : certificat refusé (${code}).`,
      // L'autorité de DÉVELOPPEMENT est reconnue d'office ; celle-ci est une
      // autre (autorité d'entreprise, Keycloak interne).
      "déclare l'autorité qui l'a signé dans .env, puis relance :\n" +
        "    NF_TLS_CA_FILE=<chemin du fichier PEM de l'autorité>",
    );
  }
  return new CallFailure(
    `${target} injoignable : ${error instanceof Error ? error.message : String(error)}`,
    start,
  );
}

/**
 * Nom de la commande — cité par `demos.ts` ; le test du module vérifie que
 * le renvoi désigne bien cette commande.
 */
export const PARTNER_CALL_COMMAND = "demo:partner:call";

/**
 * `nodefony demo:partner:call` — obtient un jeton d'accès, puis appelle
 * `GET /demo/api/partner/whoami` comme le ferait un PROGRAMME partenaire.
 *
 * Deux émetteurs, deux façons d'obtenir le jeton :
 *  • `--issuer nodefony` (défaut) — l'application SIGNE elle-même le jeton
 *    d'un de ses comptes (`--as`, défaut `admin`), par le service
 *    `tokenService` : sans mot de passe, puisque la commande tourne DANS
 *    l'application. Aucun serveur d'identité requis.
 *  • `--issuer keycloak` — le client machine `<%= it.appName %>-machine` obtient un jeton
 *    EN SON NOM par le flux `client_credentials` (RFC 6749 §4.4) : aucun
 *    utilisateur, aucun navigateur. C'est la voie d'un vrai partenaire, qui
 *    n'a pas accès aux clés de l'application.
 *
 * Dans les deux cas, le jeton vise la `resource` de la zone `demo-partner`,
 * lue dans la config VALIDÉE du pare-feu (déjà rendue absolue contre
 * `jwt.issuer`) : c'est l'audience que la zone exige, et un jeton délivré pour
 * une autre est refusé. La commande ne lit aucune variable d'environnement :
 * tout ce qu'elle sait vient de la configuration des modules.
 */
class PartnerCallCommand extends Command {
  constructor(cli: CliKernel) {
    super(
      PARTNER_CALL_COMMAND,
      "appelle l'API partenaire avec un jeton d'accès",
      cli,
      options,
    );
    this.addOption("-i, --issuer <issuer>", "nodefony (défaut) ou keycloak", [
      ...ISSUERS,
    ]);
    this.addOption(
      "-a, --as <account>",
      "compte porteur du jeton nodefony (défaut admin)",
    );
    this.addOption("-u, --url <base>", "adresse de l'application appelée");
    this.addOption("-j, --json", "sortie JSON (scriptable)");
  }

  override async generate(opts: {
    issuer?: string;
    as?: string;
    url?: string;
    json?: boolean;
  }): Promise<this> {
    const issuer = opts.issuer ?? "nodefony";
    if (!isIssuer(issuer)) {
      return this.#fail(
        new CallFailure(
          `émetteur « ${issuer} » inconnu.`,
          `--issuer ${ISSUERS.join(" | ")}`,
        ),
      );
    }
    try {
      const resource = this.#partnerResource();
      const url = whoamiUrl(resource, opts.url);
      const accessToken =
        issuer === "keycloak"
          ? await this.#keycloakToken(resource)
          : await this.#nodefonyToken(opts.as ?? "admin", resource);
      const answer = await this.#call(url, accessToken, issuer);
      // La SORTIE va sur la sortie standard ; le journal ne raconte que le reste.
      process.stdout.write(
        opts.json
          ? `${JSON.stringify(answer)}\n`
          : `${answer.status} ${url.href}\n` +
              `${JSON.stringify(answer.body, null, 2)}\n`,
      );
      // Un statut d'échec reste un échec pour qui enchaîne la commande.
      if (answer.status >= 400) process.exitCode = 1;
    } catch (error) {
      if (error instanceof CallFailure) return this.#fail(error);
      throw error;
    }
    return this;
  }

  /** La ressource de la zone, telle que le pare-feu l'a validée. */
  #partnerResource(): string {
    const firewall = this.kernel?.container?.get("firewall");
    const resource =
      firewall instanceof Firewall
        ? firewall.getArea(PARTNER_AREA)?.resource
        : undefined;
    if (resource === undefined) {
      throw new CallFailure(
        `zone « ${PARTNER_AREA} » introuvable dans le pare-feu.`,
        "le module demo et @nodefony/security sont-ils chargés ? " +
          "npx nodefony inspect modules",
      );
    }
    return resource;
  }

  /** Jeton signé par CETTE application, pour un de ses comptes. */
  async #nodefonyToken(identifier: string, resource: string): Promise<string> {
    // Un service s'atteint par sa CLÉ de conteneur, jamais par sa classe.
    const tokens = this.kernel?.container?.get("tokenService");
    const users = this.kernel?.container?.get("users");
    if (
      !(tokens instanceof TokenService) ||
      !tokens.isEnabled() ||
      !(users instanceof UserService)
    ) {
      throw new CallFailure(
        "cette application n'émet pas de jetons (service tokenService ou users absent).",
        "vérifie le bloc `jwt` de nodefony/config/security.ts",
      );
    }
    const user = await users.findByIdentifier(identifier);
    if (!user) {
      throw new CallFailure(
        `compte « ${identifier} » introuvable.`,
        `npx nodefony security:user:add ${identifier}   (ou --as <compte existant>)`,
      );
    }
    try {
      const issued = await tokens.issueTokens(user, [], resource, TOKEN_TTL_S);
      return issued.access_token;
    } catch (error) {
      if (error instanceof InvalidTargetError) {
        throw new CallFailure(
          `l'application refuse d'émettre un jeton pour ${resource}.`,
          `la zone « ${PARTNER_AREA} » porte-t-elle cette resource ? npx nodefony inspect config`,
        );
      }
      throw error;
    }
  }

  /** Jeton obtenu chez Keycloak par le client machine, sans utilisateur. */
  async #keycloakToken(resource: string): Promise<string> {
    // Le Keycloak que l'application déclare (sa config security, posée
    // quand NF_KEYCLOAK_ISSUER l'est), et le secret que la config de la démo
    // lit dans NF_KEYCLOAK_MACHINE_SECRET.
    const keycloak = this.kernel?.container?.get("keycloak");
    const trusted =
      keycloak instanceof KeycloakService
        ? keycloakIssuer(keycloak.config())
        : undefined;
    const secret = defineDemoConfig(
      this.kernel?.getModule("demo")?.options,
    ).machineSecret;
    if (trusted === undefined || secret === undefined) {
      const missing = [
        ...(trusted ? [] : ["NF_KEYCLOAK_ISSUER"]),
        ...(secret ? [] : ["NF_KEYCLOAK_MACHINE_SECRET"]),
      ];
      throw new CallFailure(
        `variable(s) absente(s) : ${missing.join(", ")}.`,
        "pose-les dans .env (une app générée avec --demo les y écrit, actives)",
      );
    }
    const issuer = trusted.issuer;
    try {
      // Le point de jeton est DÉCOUVERT depuis l'émetteur (RFC 8414) : jamais
      // une URL recopiée, qui survivrait au déménagement du realm.
      const tokens = await requestClientCredentialsToken({
        issuer,
        // Adresse INTERNE où lire les métadonnées (cluster), si elle diffère.
        discoveryUrl: trusted.discoveryUrl,
        clientId: MACHINE_CLIENT_ID,
        clientSecret: secret,
        resource,
        timeoutMs: 5000,
      });
      return tokens.accessToken();
    } catch (error) {
      if (error instanceof OAuth2RequestError) {
        throw new CallFailure(
          `Keycloak refuse le client ${MACHINE_CLIENT_ID} (${error.code}).`,
          "vérifie NF_KEYCLOAK_MACHINE_SECRET dans .env (console Keycloak, " +
            `client ${MACHINE_CLIENT_ID}, onglet « Credentials »)`,
        );
      }
      throw networkFailure(
        error,
        `Keycloak (${issuer})`,
        "docker compose --profile keycloak up -d keycloak",
      );
    }
  }

  /** Présente le jeton à l'API, comme le ferait le partenaire. */
  async #call(
    url: URL,
    accessToken: string,
    issuer: TIssuer,
  ): Promise<{ status: number; body: unknown }> {
    let response: Response;
    try {
      response = await fetch(url, {
        headers: {
          authorization: `Bearer ${accessToken}`,
          accept: "application/json",
        },
        signal: AbortSignal.timeout(5000),
      });
    } catch (error) {
      throw networkFailure(
        error,
        `L'application (${url.origin})`,
        "npm run dev",
      );
    }
    const body: unknown = await response.json().catch(() => null);
    if (response.status === 401) {
      // Le refus ne dit pas pourquoi, et c'est voulu : un attaquant n'a pas à
      // apprendre ce qui manque à son jeton. La cause la plus fréquente, elle,
      // dépend de l'émetteur.
      throw new CallFailure(
        `jeton refusé (401) par ${url.origin}.`,
        issuer === "keycloak"
          ? "le jeton ne porte pas l'audience de la zone : écris-la dans le realm,\n" +
              `    npx nodefony security:keycloak:realm --write --machine ${MACHINE_CLIENT_ID}\n` +
              "  puis importe-le (console Keycloak → Realm settings → Partial import)"
          : "l'application qui tourne a-t-elle la même configuration ? relance `npm run dev`",
      );
    }
    if (response.status === 503) {
      throw new CallFailure(
        `${url.origin} n'a pas pu vérifier le jeton (503).`,
        "le SERVEUR joint-il Keycloak ? son diagnostic le dit :\n" +
          "    npx nodefony security:oauth:doctor",
      );
    }
    return { status: response.status, body };
  }

  /** Dit la panne et son geste sur la sortie d'erreur, et sort en 1. */
  #fail(failure: CallFailure): this {
    process.stderr.write(`✖ ${failure.message}\n  → ${failure.remedy}\n`);
    process.exitCode = 1;
    return this;
  }
}

export default PartnerCallCommand;
