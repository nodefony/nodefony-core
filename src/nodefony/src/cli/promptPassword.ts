import readline from "node:readline/promises";
import { Writable } from "node:stream";

/**
 * Demande un secret sans jamais l'ÉCHOTER — mot de passe, phrase de passe.
 *
 * La frappe passe par un `readline` dont la sortie est un flux MUET : la
 * question s'écrit directement sur la sortie standard, les caractères tapés ne
 * s'affichent nulle part et ne peuvent donc pas se retrouver dans une capture
 * d'écran, un partage de terminal ou un journal de session.
 *
 * Vit au cœur, et pas dans la commande qui en avait besoin la première : deux
 * copies d'un prompt de secret finissent par différer sur ce qui compte — l'une
 * oublie de couper l'écho, l'autre de refermer l'interface, et le terminal reste
 * muet après coup.
 *
 * ⚠️ **Sans terminal, cette fonction n'a pas de sens** : un pipeline resterait
 * suspendu sur une question que personne ne lit. L'appelant doit constater le
 * TTY avant (cf `Command.askArgument`) et proposer une option de ligne de
 * commande pour les scripts.
 *
 * @param question - invite écrite telle quelle (ajouter les deux points et l'espace)
 * @returns ce qui a été tapé, sans le retour à la ligne
 */
export async function askPasswordMasked(question: string): Promise<string> {
  const muted = new Writable({
    write(_chunk, _enc, cb) {
      cb();
    },
  });
  const rl = readline.createInterface({
    input: process.stdin,
    output: muted,
    terminal: true,
  });
  process.stdout.write(question);
  try {
    const answer = await rl.question("");
    // Le retour à la ligne que l'écho aurait produit : sans lui, la sortie
    // suivante s'imprime au bout de l'invite.
    process.stdout.write("\n");
    return answer;
  } finally {
    rl.close();
  }
}
