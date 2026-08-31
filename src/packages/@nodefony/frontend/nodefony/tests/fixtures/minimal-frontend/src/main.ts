document.getElementById("app")!.textContent = "fixture loaded";

// Témoin du MODE de build, lu sur le fichier RENDU (#137). Le remplacement de
// `import.meta.env.DEV` par une constante laisse une seule des deux branches
// dans le bundle : c'est la seule preuve qui porte sur ce qu'un utilisateur
// reçoit — la configuration passée à Vite, elle, était juste depuis le début.
if ((import.meta as { env?: { DEV?: boolean } }).env?.DEV) {
  console.log("NODEFONY_BUILD_DEV");
} else {
  console.log("NODEFONY_BUILD_PROD");
}
