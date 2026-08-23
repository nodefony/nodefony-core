import https from "node:https";

/**
 * globalSetup vitest — sonde la route PUBLIQUE liveness
 * (`GET /nodefony/kernel/api/livez`, ne révèle que `environment`) pour connaître
 * le mode du serveur testé, et le publie dans `process.env.NF_TEST_ENV`
 * (lu SYNCHRONE par `describe.skipIf(IS_PROD_TARGET)`).
 *
 * Posé dans le process principal AVANT le fork des workers (les suites tournent
 * en `fileParallelism:false`) → hérité par les workers. Un export explicite de
 * `NF_TEST_ENV` l'emporte (priorité au lanceur de la batterie prod).
 * Serveur down / route absente / réponse invalide → on laisse le défaut
 * (`development`) : aucun skip intempestif.
 */
export default async function probeServerEnv(): Promise<void> {
  if (process.env.NF_TEST_ENV) return; // valeur explicite > sonde

  const env = await new Promise<string | null>((resolve) => {
    const req = https.request(
      {
        hostname: "localhost",
        port: 5152,
        path: "/nodefony/kernel/api/livez",
        method: "GET",
        rejectUnauthorized: false,
        timeout: 3000,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => {
          let value: string | null = null;
          try {
            const body = JSON.parse(Buffer.concat(chunks).toString()) as {
              environment?: unknown;
            };
            if (typeof body.environment === "string") value = body.environment;
          } catch {
            /* réponse non-JSON → sonde inconclusive, `null` */
          }
          resolve(value);
        });
      },
    );
    req.on("error", () => resolve(null));
    req.on("timeout", () => {
      req.destroy();
      resolve(null);
    });
    req.end();
  });

  if (env) process.env.NF_TEST_ENV = env;
}
