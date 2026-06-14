import {
  Service,
  Module,
  Container,
  Event,
  Severity,
  Msgid,
  Message,
  Pdu,
  logColor,
} from "nodefony";

import { VoterVote } from "../contracts/IAccessVoter";
import type { IAccessVoter } from "../contracts/IAccessVoter";
import type { IAuthorizationService } from "../contracts/IAuthorizationService";
import type { IToken } from "../contracts/IToken";
import { listVoterFactories } from "../src/voter/voterRegistry";

const serviceName = "authorization";

/**
 * Service d'autorisation Nodefony (niveau C, P6 J6) — décide d'un accès via un
 * jury de {@link IAccessVoter}.
 *
 * Stratégie **affirmative + DENY veto** : un seul `DENY` bloque (veto) ; sinon un
 * `GRANT` suffit ; **silence total** (tous `ABSTAIN`, ou aucun voter compétent)
 * → `DENY` (**Zero Trust** : fermé par défaut). Tout refus est audité (WARNING) ;
 * les accès accordés restent silencieux (pas de spam — l'audit d'octroi explicite
 * viendra avec `@AuditLog`, P6.14).
 *
 * Les voters sont découverts au boot via le `voterRegistry` (built-in `role` +
 * ceux des apps/plugins) — aucun nom en dur ici. Consommé par les décorateurs
 * (`@IsGranted`, J7) et le verrou de frame WS (« 1 garde = N transports »).
 *
 * Perf : aucune allocation par appel (`decide` itère les voters et teste
 * `supports()` en place) ; les voters sont instanciés UNE fois au boot.
 */
class Authorization extends Service implements IAuthorizationService {
  // Voters instanciés au boot — null tant qu'aucun build (defensive : si `decide`
  // est appelé avant `onBoot`, build lazy à la volée).
  #voters: IAccessVoter[] | null = null;

  constructor(public module: Module) {
    super(
      serviceName,
      module.container as Container,
      module.notificationsCenter as Event,
      module.options,
    );
    this.kernel?.once("onBoot", () => this.#build());
  }

  // Instancie tous les voters enregistrés (built-in + app/plugins) UNE fois.
  #build(): IAccessVoter[] {
    const list: IAccessVoter[] = [];
    const ctx = { container: this.container as Container };
    for (const [, factory] of listVoterFactories()) {
      list.push(factory(ctx));
    }
    this.#voters = list;
    this.log(`Authorization ready — ${list.length} voter(s)`, "DEBUG");
    return list;
  }

  /**
   * Le token a-t-il le droit `attribute` sur `subject` ? Affirmative + DENY veto,
   * défaut `DENY` (Zero Trust). Voir {@link IAuthorizationService.decide}.
   */
  async decide(
    token: IToken,
    attribute: string,
    subject?: unknown,
  ): Promise<boolean> {
    const voters = this.#voters ?? this.#build();
    let granted = false;
    let considered = 0;
    for (let i = 0; i < voters.length; i++) {
      const voter = voters[i]!;
      if (!voter.supports(attribute, subject)) continue;
      considered++;
      let vote: VoterVote;
      try {
        vote = await voter.vote(token, attribute, subject);
      } catch (error) {
        // Fail-closed (Zero Trust) : un voter qui throw (lookup down, bug) NE
        // DOIT NI accorder l'accès NI faire planter la requête en 500. On refuse
        // cette décision + log ERROR (signal ops complet) — même posture que le
        // firewall sur une erreur interne d'authentification.
        this.log(error, "ERROR");
        this.#auditDeny(token, attribute, subject, "error");
        return false;
      }
      if (vote === VoterVote.DENY) {
        this.#auditDeny(token, attribute, subject, "veto");
        return false; // un DENY suffit — court-circuit (pas la peine de finir le jury)
      }
      if (vote === VoterVote.GRANT) granted = true;
    }
    if (!granted) {
      this.#auditDeny(
        token,
        attribute,
        subject,
        considered === 0 ? "no-voter" : "abstain",
      );
    }
    return granted;
  }

  // Trace de refus (cold path : DENY only) — WARNING, sans stringify d'un sujet
  // arbitraire (descripteur léger). Source d'un futur stream d'audit (P6.14).
  #auditDeny(
    token: IToken,
    attribute: string,
    subject: unknown,
    reason: "veto" | "abstain" | "no-voter" | "error",
  ): void {
    // `getUserIdentifier()` (PAS `getUser()`) : commun à IToken (HTTP) ET au
    // token WS (`IRealtimeToken`, sans `getUser`). L'audit ne veut qu'un libellé
    // → le service authz reste transport-agnostique (« 1 garde = N transports »).
    const who = token.getUserIdentifier();
    const on = subject === undefined ? "" : ` on ${describeSubject(subject)}`;
    this.log(
      `access denied: "${who}" → "${attribute}"${on} (${reason})`,
      "WARNING",
    );
  }

  override log(
    pci: unknown,
    severity?: Severity,
    msgid?: Msgid,
    msg?: Message,
  ): Pdu {
    if (!msgid) {
      // Couleur gatée au boot (logColor) → msgid brut hors TTY (JSONL queryable).
      msgid = logColor.cyan("AUTHORIZATION");
    }
    return super.log(pci, severity, msgid, msg);
  }
}

/** Descripteur léger d'un sujet pour l'audit (jamais de JSON.stringify aveugle). */
function describeSubject(subject: unknown): string {
  if (typeof subject === "string") return subject;
  if (subject === null) return "null";
  const ctor = (subject as { constructor?: { name?: string } })?.constructor
    ?.name;
  return ctor ?? typeof subject;
}

export default Authorization;
export { Authorization };
