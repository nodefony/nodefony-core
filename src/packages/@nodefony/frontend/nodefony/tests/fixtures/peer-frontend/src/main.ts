// Racine d'une SECONDE application, distincte de `minimal-frontend` : deux
// applications Nodefony ne partagent pas leur racine, donc pas leur
// `vite.config.generated.mjs`. Sans elle, la 2ᵉ instance du banc de décalage
// réécrivait le config que la 1ʳᵉ surveille et la faisait redémarrer (#427).
document.getElementById("app")!.textContent = "peer fixture loaded";
