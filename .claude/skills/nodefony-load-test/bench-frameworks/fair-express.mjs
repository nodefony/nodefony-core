/**
 * Pose sur une application Express le travail par requête de Nodefony
 * (`fair-common.mjs`) — partagé par tous les camps `express-fair*` (#489).
 *
 * L'ETag est COUPÉ : `res.json` hache le corps pour le poser, Nodefony n'en
 * pose pas. Le laisser faisait travailler le camp témoin PLUS que Nodefony.
 */
import cors from "cors";
import helmet from "helmet";
import { HELMET_OPTIONS, als, perRequest } from "./fair-common.mjs";

/**
 * @param app - application Express, avant la déclaration des routes
 * @param port - port d'écoute, pour la liste blanche CORS
 */
export function installExpressFair(app, port) {
  app.set("env", "production");
  app.set("etag", false);
  app.disable("x-powered-by");
  app.use(helmet(HELMET_OPTIONS));
  app.use(cors({ origin: [`http://127.0.0.1:${port}`] }));
  app.use((req, res, next) => {
    const work = perRequest(req.method, req.path, req.headers);
    res.set(work.headers);
    if (work.status) return res.status(work.status).end();
    als.run(work.store, next);
  });
}
