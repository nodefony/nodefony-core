// Décor commun des bancs de conformité : ils DÉSIGNENT le serveur de
// développement, ils ne le démarrent pas.

/**
 * Refuse de lancer un banc contre un serveur de développement qui ne répond pas.
 *
 * @throws {Error} serveur injoignable sur 5151, avec le geste qui le démarre
 */
export async function assertDevServer() {
  try {
    const res = await fetch("http://127.0.0.1:5151/livez");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  } catch (e) {
    throw new Error(
      `serveur de dev injoignable sur 5151 (${e instanceof Error ? e.message : String(e)}) — ` +
        "bash .claude/skills/nodefony-start-server/start.sh",
      { cause: e },
    );
  }
}
