#!/usr/bin/env node
/**
 * check-shell-syntax — un script shell qui ne se PARSE pas meurt à l'exécution,
 * au milieu de son travail, jamais au moment où on l'écrit.
 *
 * Bash lit un script au fil de l'eau : une faute de syntaxe à la ligne 1 804
 * laisse tourner les 1 803 premières, puis arrête tout. Le cas vécu : une
 * apostrophe (« l'app ») dans un COMMENTAIRE JavaScript, à l'intérieur d'un
 * `node -e '…'`, fermait la chaîne entre apostrophes du shell. Le smoke de
 * release a bâti seize tarballs, installé l'application, puis s'est arrêté sur
 * « syntax error near unexpected token » — et le scénario qu'il devait éprouver
 * n'a jamais tourné. Aucun lint ne lit un `.sh`, aucun test ne l'exécute avant
 * qu'on en ait besoin.
 *
 * `bash -n` parse sans rien exécuter : il coûte quelques millisecondes et
 * attrape toute la famille (guillemet orphelin, `fi` manquant, heredoc ouvert).
 *
 * **Capacité constatée, jamais déduite** : sans `bash` (un Windows sans Git
 * Bash), le contrôle se DIT non fait et ne bloque pas — il ne prétend pas
 * avoir vérifié.
 *
 * @usage    node scripts/gates/check-shell-syntax.mjs           # tous les .sh SUIVIS
 * @usage    node scripts/gates/check-shell-syntax.mjs --staged  # ceux de l'index (pre-commit)
 * @output   chaque script fautif avec l'erreur de bash ; sortie 1 si un seul l'est
 */
import { execFileSync, spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

/** Scripts contrôlés : ceux que bash exécute. */
const SHELL_SCRIPT = /\.(?:sh|bash)$/i;

/**
 * Parse chaque script avec `bash -n` et rend les fautifs.
 *
 * @param files - chemins des scripts à contrôler.
 * @param bash - exécutable bash (injecté pour les tests).
 * @returns `supported: false` si bash ne répond pas ; sinon la liste des fautes.
 */
export function checkShellSyntax(files, bash = "bash") {
  const probe = spawnSync(bash, ["--version"], { encoding: "utf8" });
  if (probe.error || probe.status !== 0) {
    return { supported: false, checked: 0, failures: [] };
  }
  const failures = [];
  for (const file of files) {
    const run = spawnSync(bash, ["-n", file], { encoding: "utf8" });
    if (run.status !== 0) {
      failures.push({ file, error: (run.stderr || "").trim() });
    }
  }
  return { supported: true, checked: files.length, failures };
}

function listScripts(staged) {
  const args = staged
    ? ["diff", "--cached", "--name-only", "--diff-filter=ACMR"]
    : ["ls-files"];
  const out = execFileSync("git", [...args, "-z"], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return out.split("\0").filter((f) => f && SHELL_SCRIPT.test(f));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const files = listScripts(process.argv.includes("--staged"));
  if (files.length === 0) process.exit(0);
  const verdict = checkShellSyntax(files);
  if (!verdict.supported) {
    process.stdout.write(
      `⚠ bash introuvable : syntaxe de ${files.length} script(s) shell NON contrôlée.\n`,
    );
    process.exit(0);
  }
  if (verdict.failures.length === 0) {
    process.stdout.write(
      `✓ ${verdict.checked} script(s) shell se parsent (bash -n).\n`,
    );
    process.exit(0);
  }
  process.stderr.write(
    `\n❌ ${verdict.failures.length} script(s) shell ne se parsent pas — ils mourront en cours d'exécution :\n\n`,
  );
  for (const { file, error } of verdict.failures) {
    process.stderr.write(
      `   ${file}\n      ${error.split("\n").join("\n      ")}\n`,
    );
  }
  process.stderr.write(
    `\n   Piège fréquent : une apostrophe dans un \`node -e '…'\` (même dans un commentaire) ferme la chaîne.\n` +
      `   Rejouer : bash -n <script>\n\n`,
  );
  process.exit(1);
}
