/// <reference types="node" />
import { route, controller } from "@nodefony/framework";
import {
  RealtimeChannel,
  RealtimeController,
  RealtimeInbound,
} from "@nodefony/realtime";
import type { RealtimePublish } from "@nodefony/realtime";
import { Context } from "@nodefony/http";

/**
 * La diffusion du salon, tant qu'au moins une page écoute. `null` dès le départ
 * du dernier abonné : un pod sans spectateur ne retient rien.
 *
 * Hors de la classe, parce que le controller est instancié PAR CONNEXION alors
 * que le canal est unique pour le pod — c'est ce décalage qui permet à la
 * frappe d'une connexion d'atteindre toutes les autres. (Un champ `static #`
 * ferait le même travail, mais TypeScript refuse un identifiant privé statique
 * dans une classe décorée : TS18036.)
 */
let diffuser: RealtimePublish | null = null;

/**
 * Le canal temps réel COMMUN aux quatre vitrines de front (React, Vue, Angular,
 * Svelte) — un seul endpoint, un seul canal, quatre pages qui s'y branchent.
 *
 * Pourquoi un seul, et pas un par module de vitrine : c'est précisément ce que
 * ces quatre pages doivent démontrer. Le socle agnostique de `nodefony/client`
 * n'a de valeur que si le MÊME serveur, le MÊME canal et le MÊME câblage
 * donnent le même écran dans les quatre. Quatre endpoints donneraient quatre
 * démonstrations séparées — et une divergence pourrait s'y cacher.
 *
 * **Ce qu'il faut donner à VOIR** : ce qui rend cette socket intéressante n'est
 * pas qu'elle envoie des octets à l'heure, c'est que le serveur pousse la même
 * chose à TOUT LE MONDE. Ouvrir la vitrine Vue et la vitrine React côte à côte,
 * écrire dans l'une, voir arriver dans l'autre : la démonstration tient en deux
 * secondes et n'a besoin d'aucun commentaire.
 *
 * **Ce qu'il ne faut SURTOUT PAS faire**, et qui a été retiré d'ici : un
 * battement périodique. Une trame par seconde et par client, pour ne rien dire,
 * coûte du réseau et du processeur en permanence — et enseigne l'inverse de ce
 * que le framework défend. Une socket qui se tait quand il ne se passe rien
 * n'est pas une socket endormie : c'est une socket bien élevée. L'état de la
 * connexion suffit à prouver qu'elle est vivante, et il ne coûte aucune trame.
 *
 * L'adresse (`/api/live/realtime`) est celle qu'une application générée par
 * `nodefony create app --preset complete` monte chez elle : ce que le dépôt
 * montre est ce que l'utilisateur reçoit.
 *
 * Le canal est LIBRE (aucune politique) : une vitrine doit s'afficher sans
 * compte, et rien de ce qui y transite n'appartient à personne. Un canal de
 * plateforme (`nodefony:*`) a, lui, un plancher d'authentification irréductible.
 */
@controller("/api/live")
class LiveTickerController extends RealtimeController {
  constructor(context: Context) {
    super("LiveTickerController", context);
  }

  /**
   * L'endpoint WebSocket des quatre vitrines. `handleRealtime` fait tout le
   * protocole (welcome, abonnements, pont d'API) ; rien n'est écrit à la main.
   */
  @route("test-live-realtime", {
    path: "/realtime",
    requirements: { methods: ["WEBSOCKET"] },
  })
  async realtime(message: string | Buffer | null): Promise<void> {
    this.handleRealtime(message);
  }

  /**
   * Ouvre le **pont d'API** sur ce hub : la connexion expose `api.request`, qui
   * re-route un chemin vers la MÊME action de contrôleur que le GET REST.
   *
   * C'est le différenciateur que les quatre vitrines donnent à voir — « une
   * action, deux transports » — et il ne s'ouvre jamais tout seul : un hub sans
   * intention explicite n'ajoute aucune surface d'invocation. Le pont n'atteint
   * d'ailleurs que les routes qui déclarent `WEBSOCKET` dans leurs `methods` :
   * c'est l'action qui dit à quels transports elle répond, pas le pont qui se
   * sert.
   */
  protected override realtimeApiRequest(): boolean {
    return true;
  }

  /**
   * Le salon partagé — le canal que les quatre vitrines affichent. Le
   * fournisseur ne produit rien tout seul : il retient de quoi diffuser, et
   * c'est {@link dire} qui alimente. Le nettoyage rendu coupe la diffusion au
   * départ du dernier abonné.
   */
  @RealtimeChannel("live:salon")
  salon(_channel: string, publish: RealtimePublish): () => void {
    diffuser = publish;
    return () => {
      diffuser = null;
    };
  }

  /**
   * Ce qu'une page envoie, et que TOUTES reçoivent (canal FULL-DUPLEX entrant).
   *
   * `params` vient du navigateur : il n'est pas fiable. On borne la longueur et
   * on ne garde que ce qu'on sait typer — le reste est jeté sans réponse. Le
   * texte est rendu comme du TEXTE par les quatre frameworks de vue (aucune
   * page n'injecte de HTML), c'est ce qui rend le salon inoffensif.
   */
  @RealtimeInbound("live:dire")
  dire(params: unknown): void {
    const p = params as { texte?: unknown; front?: unknown } | null;
    const texte =
      typeof p?.texte === "string" ? p.texte.trim().slice(0, 140) : "";
    if (!texte) return;
    const front = typeof p?.front === "string" ? p.front.slice(0, 16) : "?";
    diffuser?.("live:salon", {
      texte,
      front,
      ts: Date.now(),
      pid: process.pid,
    });
  }
}

export default LiveTickerController;
