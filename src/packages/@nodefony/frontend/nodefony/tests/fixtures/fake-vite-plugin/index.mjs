// Plugin Vite FACTICE : rend ce qu'il a reçu, pour comparer ce que le build et
// le fichier du serveur de développement passent réellement à la fabrique.
export default function fakePlugin(...args) {
  return { name: "nf-fake-default", args };
}

export function named(...args) {
  return { name: "nf-fake-named", args };
}
