import type { RealtimeIdentity } from "./RealtimeEventMap";

/**
 * Identité d'ADMISSION d'un abonné — ce que reçoit la règle `allow` d'un canal, la MÊME quelle que soit la livraison (socket, flux SSE, abonnement webhook) ; SERVEUR seulement, jamais réémise au client.
 *
 * Une donnée PLATE, jamais l'objet jeton : à l'émission d'un webhook il n'y a
 * pas de jeton, et une règle qui lirait ses méthodes rendrait trois verdicts
 * pour la même personne selon son mode de connexion (ADR-0021 §S10). Aucune
 * revendication de jeton n'y figure : une appartenance (organisation, salon)
 * se relit par `id`, auprès des services de l'application.
 *
 * Invariant que le framework garantit : anonyme ⇔ `authenticated === false`,
 * `id === null` et `issuer === null`. L'identité est gelée une fois, à
 * l'ouverture : une règle ne peut pas s'y ajouter un rôle.
 *
 * @remarks Produite par le framework, jamais construite par l'application :
 * l'authentificateur la remplit (`IRealtimeToken.getIdentity`), le flux SSE la
 * tire de l'utilisateur de la requête, le webhook la reconstruit par `id`.
 */
export interface ISubscriberIdentity extends RealtimeIdentity {
  /**
   * Émetteur (`iss`) du jeton VÉRIFIÉ qui a ouvert cette livraison ; `null`
   * quand aucun jeton n'est en jeu (session, clé d'API, anonyme).
   */
  readonly issuer: string | null;
  /**
   * `id` désigne un compte LOCAL que l'on peut relire ; `false` pour un
   * appelant machine sans compte (`<émetteur>#<sujet>`) et pour l'anonyme.
   */
  readonly account: boolean;
}

/**
 * Règle d'admission d'un canal écrite en CLASSE — la forme à prendre dès que la règle lit les données de l'application (une appartenance en base) : ses services lui arrivent par le constructeur.
 *
 * La classe étend `Service` et porte `@injectable` ; elle est résolue UNE fois,
 * au démarrage du noyau — une dépendance absente, une portée `request` ou une
 * méthode `allow` manquante y refusent le démarrage en nommant la classe et le
 * canal. Une seule instance sert tous les abonnés en même temps : elle ne garde
 * AUCUN état par abonné.
 */
export interface IChannelAdmission {
  /**
   * Admet-on `who` sur `channel` ? Demandé une fois, au `subscribe` ; la réponse est RETENUE sur la connexion.
   *
   * Contrat (ADR-0021 §S10 bis) :
   * - ses arguments, et rien d'autre — ni contexte de requête, ni session : à
   *   l'émission d'un webhook il n'y en a pas ;
   * - seul `=== true` admet ; une exception ou une promesse rejetée valent
   *   refus `forbidden` ; un délai dépassé rend `unavailable`, jamais une
   *   admission, et un verdict arrivé après le délai est ignoré ;
   * - il peut être appelé plus d'une fois pour un même abonné (rejeu à la
   *   reconnexion) : idempotent et sans effet de bord ;
   * - **prix assumé** : une réponse retenue ne se périme pas seule — un membre
   *   retiré reste abonné jusqu'à son éjection explicite.
   *
   * @param channel - nom exact du canal demandé.
   * @param who - identité d'admission gelée de l'abonné.
   * @returns `true` pour admettre ; toute autre valeur refuse.
   */
  allow(channel: string, who: ISubscriberIdentity): boolean | Promise<boolean>;
}

/**
 * Règle d'admission sous forme de FLÈCHE — pour une règle qui ne lit rien d'autre que ses arguments (`channel === \`user:${who.id}\``).
 *
 * Même contrat que {@link IChannelAdmission.allow}.
 */
export type ChannelAllowFunction = (
  channel: string,
  who: ISubscriberIdentity,
) => boolean | Promise<boolean>;

/**
 * Classe d'admission telle qu'elle se déclare dans une politique : un constructeur `@injectable` qui produit un {@link IChannelAdmission}.
 */
export type ChannelAdmissionClass = new (...args: never[]) => IChannelAdmission;

/**
 * Valeur du membre `allow` d'une politique de canal — une flèche OU une classe `@injectable`, distinguées par la métadonnée `@injectable`, jamais par le texte de la fonction.
 *
 * Déclarée au cœur pour que `@nodefony/realtime` et `@nodefony/security`, qui
 * ne s'importent pas, partagent UNE définition au lieu de deux miroirs.
 */
export type ChannelAllow = ChannelAllowFunction | ChannelAdmissionClass;

/**
 * Politique d'autorisation d'un canal temps réel — ce qu'il faut satisfaire pour s'y abonner (`subscribe`) ou y pousser (canal entrant), déclarée par `@RealtimeChannel(nom, politique)`.
 *
 * Déclaration UNIQUE, au cœur : `@nodefony/realtime` la transporte, `@nodefony/security`
 * la juge, et aucun des deux n'importe l'autre — deux copies dériveraient en
 * silence, chacune passant ses propres tests.
 *
 * Les champs se cumulent (ET) ; un champ absent ne contraint rien ; une
 * politique vide laisse le canal libre. Toute autre clé est REFUSÉE au
 * démarrage : une faute de frappe dans une règle de sécurité ne s'ignore pas.
 */
export interface IChannelPolicy {
  /** Exige une connexion authentifiée (jeton non anonyme). */
  readonly authenticated?: boolean | undefined;
  /** Un de ces rôles suffit (évalué AVEC la hiérarchie de rôles, côté sécurité). */
  readonly roles?: readonly string[] | undefined;
  /** Un de ces scopes suffit (axe API : JWT, clé d'API ; une session n'en porte pas). */
  readonly scopes?: readonly string[] | undefined;
  /**
   * Règle d'admission PAR ABONNÉ, demandée une fois au `subscribe` après les
   * exigences ci-dessus : une flèche qui ne lit que ses arguments, ou une
   * classe `@injectable` résolue au démarrage (contrat : {@link IChannelAdmission.allow}).
   */
  readonly allow?: ChannelAllow | undefined;
  /**
   * Un canal à `allow` refuse l'anonyme d'office ; `true` le lui présente
   * (`who.id === null`). Sans `allow`, la clé n'a pas de sens et est refusée.
   */
  readonly anonymous?: boolean | undefined;
}

/**
 * Les deux politiques qui s'appliquent à un nom de canal — celle de LECTURE et, quand elle en diffère, celle d'ÉCRITURE (ADR-0022 §6, décision 1 quater).
 *
 * `subscribe` exige `policy` ; une trame entrante (notification sur un canal
 * plein-duplex, requête d'action) exige `policy` ET `write`. Lu par
 * `@nodefony/security` à chaque trame jugée : une seule résolution rend les
 * deux, sans allocation.
 */
export interface IChannelPolicies {
  /** Politique de LECTURE (`@RealtimeChannel`) ; héritée de l'écriture quand seule celle-ci est déclarée. */
  readonly policy: IChannelPolicy;
  /** Politique d'ÉCRITURE DISTINCTE de la lecture (`@RealtimeInbound`, `@RealtimeAction`), ou `null` : la lecture suffit. */
  readonly write: IChannelPolicy | null;
}
