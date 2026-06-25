import type { IAdminApi, IAdminRequest } from "nodefony";

/**
 * Banc d'idempotence (P6.8 — mutations par la socket) : un `IAdminApi` de TEST
 * exposant une mutation à **effet observable**.
 *
 * `POST /nodefony/test/api/idem-probe` incrémente un compteur process-wide et
 * renvoie sa valeur — ce qui permet de PROUVER, sur le serveur réel, que :
 *  - un rejeu (même `Idempotency-Key`) NE ré-incrémente PAS (réponse mémorisée) ;
 *  - une clé différente OU une autre identité ré-exécute (le compteur avance) ;
 *  - une mutation par socket SANS clé est refusée (400, politique WS).
 *
 * `public: true` : le firewall (zone data plane `nodefony-admin`) impose
 * l'AUTHENTIFICATION ; aucun rôle n'est requis → l'endpoint est atteignable par
 * `admin` ET `user`, ce qui permet de prouver le **scope par identité** du cache
 * (deux identités, même clé client → deux exécutions distinctes).
 *
 * DEV only (le module `test` n'est pas chargé en production).
 */
export function createTestAdminApi(): IAdminApi {
  let counter = 0;
  return {
    adminNamespace: "test",
    adminDescriptor: () => ({ label: "Test (banc idempotence)", order: 999 }),
    adminEndpoints: () => [
      {
        path: "idem-probe",
        method: "POST",
        public: true,
        summary:
          "Banc idempotence : incrémente un compteur et renvoie {count, echo, identity}.",
        // `body.delayMs` (borné 2 s) ouvre une fenêtre asynchrone → permet de
        // prouver le verrou *in-flight* (409) avec deux requêtes concurrentes.
        handler: async (req: IAdminRequest) => {
          const body = req.body as { delayMs?: unknown } | null;
          const delay =
            typeof body?.delayMs === "number"
              ? Math.min(Math.max(body.delayMs, 0), 2000)
              : 0;
          if (delay > 0) {
            await new Promise((resolve) => setTimeout(resolve, delay));
          }
          return {
            count: (counter += 1),
            echo: req.body ?? null,
            identity: identifierOf(req.user),
          };
        },
      },
    ],
  };
}

/** Identifiant lisible de l'IUser sans coupler le module au contrat `IUser`. */
function identifierOf(user: unknown): string | null {
  if (user && typeof user === "object") {
    const u = user as {
      username?: unknown;
      identifier?: unknown;
      id?: unknown;
    };
    for (const v of [u.username, u.identifier, u.id]) {
      if (typeof v === "string" && v) return v;
    }
  }
  return null;
}
