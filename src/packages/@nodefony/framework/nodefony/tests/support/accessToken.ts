/// <reference types="node" />
import https from "node:https";

/** Mot de passe des comptes semés de l'application de dev (`admin`, `user`). */
const PASSWORD = "secret-de-dev-42";

/**
 * Password grant (RFC 6749 §5.1) sur le serveur de dev (5152) → jeton d'accès
 * JWT du compte. Bancs gRPC : refus (D5), contexte et révocation (D6).
 *
 * @param username - compte semé (`admin`, `user`).
 * @returns le jeton d'accès.
 * @throws quand le serveur ne rend pas de jeton.
 */
export function accessToken(username: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const data = Buffer.from(JSON.stringify({ username, password: PASSWORD }));
    const req = https.request(
      {
        hostname: "127.0.0.1",
        port: 5152,
        path: "/nodefony/security/api/token",
        method: "POST",
        rejectUnauthorized: false,
        headers: {
          "content-type": "application/json",
          "content-length": String(data.length),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => {
          const body: unknown = JSON.parse(Buffer.concat(chunks).toString());
          const token =
            typeof body === "object" && body !== null && "access_token" in body
              ? body.access_token
              : undefined;
          if (typeof token === "string") resolve(token);
          else reject(new Error(`jeton refusé pour ${username}`));
        });
      },
    );
    req.on("error", reject);
    req.end(data);
  });
}
