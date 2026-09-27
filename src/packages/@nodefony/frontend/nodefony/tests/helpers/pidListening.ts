import { execSync } from "node:child_process";

/**
 * Trouver QUI écoute sur un port — sur les trois systèmes.
 *
 * Ce helper existe séparément des bancs qui l'utilisent pour une raison précise :
 * un fichier de test qui en importe un autre EXÉCUTE ses suites. Le parsing ci-
 * dessous doit s'éprouver sans réveiller un superviseur Vite.
 */

/**
 * Le PID en écoute sur ce port, d'après `netstat -ano` — grammaire Windows.
 *
 * Fonction PURE, donc éprouvable depuis n'importe quel système : c'est le seul
 * moyen de vérifier cette branche sans machine Windows, et c'est exactement ce qui
 * manquait. La sonde du banc Vite n'utilisait que `lsof`, absent là-bas, et rendait
 * `null` — le test accusait alors le superviseur (« expected null to be a number »)
 * d'un défaut qui était celui de la mesure.
 *
 * Les états TCP ne sont pas localisés par `netstat` : `LISTENING` s'écrit ainsi
 * quelle que soit la langue du système. L'adresse locale se compare par sa FIN
 * (`:5173`), ce qui couvre IPv4 comme IPv6 (`[::]:5173`) sans confondre `:51730`.
 * Et l'état est lu, pas supposé : un CLIENT connecté au même port porte un autre
 * PID, et le retenir tuerait le mauvais process.
 *
 * @param sortie - la sortie brute de `netstat -ano`.
 * @param port - le port recherché.
 * @returns le PID du premier socket en écoute sur ce port, ou `null`.
 */
export function pidFromNetstat(sortie: string, port: number): number | null {
  const suffixe = `:${port}`;
  for (const ligne of sortie.split(/\r?\n/u)) {
    const mots = ligne.trim().split(/\s+/u);
    if (mots.length < 5 || !/^TCP$/iu.test(mots[0]!)) continue;
    if (mots[3] !== "LISTENING" || !mots[1]!.endsWith(suffixe)) continue;
    const pid = Number.parseInt(mots[4]!, 10);
    if (Number.isInteger(pid) && pid > 0) return pid;
  }
  return null;
}

/**
 * Le PID réel du process en écoute sur ce port (pas un parent `npx`).
 *
 * Deux grammaires, parce que l'outil diffère et non la question : `lsof` là où il
 * existe, `netstat -ano` sous Windows.
 *
 * @param port - le port en écoute.
 * @returns le PID, ou `null` si personne n'écoute.
 */
export function pidListeningOn(port: number): number | null {
  try {
    if (process.platform === "win32") {
      return pidFromNetstat(execSync("netstat -ano -p TCP").toString(), port);
    }
    const out = execSync(`lsof -ti:${port} -sTCP:LISTEN 2>/dev/null || true`)
      .toString()
      .trim();
    if (!out) return null;
    return Number.parseInt(out.split(/\s+/u)[0]!, 10);
  } catch {
    return null;
  }
}
