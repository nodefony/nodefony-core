/**
 * Un process qui sert l'application, réduit à ce qui décide de sa clé de
 * signature : il construit son keystore depuis son ENVIRONNEMENT, comme le fait
 * un pod ou un worker de `nodefony cluster`.
 *
 * Lancé par `jwtKeystore.test.ts` dans un process À PART : deux instances dans
 * le même process ne prouveraient pas qu'aucun état n'est partagé ailleurs que
 * par la variable.
 *
 * Mode `sign` → `{ kid, jwt }` sur la sortie standard ; mode `jwks` → le JWKS
 * public. Rien d'autre n'est écrit : le parent lit un JSON pur.
 */
import process from "node:process";
import { SignJWT } from "jose";
import { JwtKeystore } from "../../nodefony/src/token/JwtKeystore";

const keystore = new JwtKeystore(
  { keySetJson: process.env.NF_JWT_KEYSET },
  () => {},
);

if (process.argv[2] === "sign") {
  const { key, kid, alg } = await keystore.getSigningKey();
  const jwt = await new SignJWT({ sub: "alice" })
    .setProtectedHeader({ alg, kid })
    .sign(key);
  process.stdout.write(JSON.stringify({ kid, jwt }));
} else {
  process.stdout.write(JSON.stringify(await keystore.getPublicJWKS()));
}
