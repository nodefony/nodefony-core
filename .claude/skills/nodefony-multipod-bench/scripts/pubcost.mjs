/** Coût de publication pur : 100 publish/appel, médiane sur N appels. */
const port = process.argv[2] ?? "5171";
const runs = Number(process.argv[3] ?? 9);
const samples = [];
for (let i = 0; i < runs; i++) {
  const r = await (
    await fetch(`http://127.0.0.1:${port}/api/chat/burst`)
  ).json();
  samples.push(r.elapsedMs);
  await new Promise((r) => setTimeout(r, 200));
}
samples.sort((a, b) => a - b);
console.log(
  JSON.stringify({
    runs,
    elapsedMsParRafaleDe100: samples,
    médiane: samples[Math.floor(runs / 2)],
  }),
);
