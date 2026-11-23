// Compare deux relevés de supervisor-terminal-screen.mjs : scénario, étape, ligne, texte et attributs.
import fs from "node:fs";
const [a, b] = process.argv
  .slice(2)
  .map((f) => JSON.parse(fs.readFileSync(f, "utf8")));
let diffs = 0;
for (const name of Object.keys(a)) {
  a[name].forEach((sa, i) => {
    const sb = b[name][i];
    if (String(sa.cursor) !== String(sb.cursor)) {
      diffs++;
      console.log(`${name} / ${sa.step} : curseur ${sa.cursor} → ${sb.cursor}`);
    }
    sa.text.forEach((t, y) => {
      if (t !== sb.text[y]) {
        diffs++;
        console.log(
          `${name} / ${sa.step} / ligne ${y} TEXTE\n  - ${JSON.stringify(t)}\n  + ${JSON.stringify(sb.text[y])}`,
        );
      } else if (sa.attrs[y] !== sb.attrs[y]) {
        diffs++;
        console.log(
          `${name} / ${sa.step} / ligne ${y} ATTRIBUTS ${JSON.stringify(t)}\n  - ${sa.attrs[y]}\n  + ${sb.attrs[y]}`,
        );
      }
    });
  });
}
console.log(`${diffs} différence(s)`);
