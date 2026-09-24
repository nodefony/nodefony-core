{
  "compilerOptions": {
    "target": "ES2024",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    // ESNext (pas le défaut du target) : les déclarations des paquets
    // nodefony exposent des APIs ES2025+ (RegExp.escape…) — même choix que
    // les tsconfigs du framework. En mode --link comme depuis npm, l'app lit
    // les `.d.ts` publiés (condition `types`), jamais les sources du checkout.
    "lib": ["ESNext", "DOM", "DOM.Iterable"],
<% if (it.front) { %>    // `vite/client` déclare ce que Vite sait importer et que TypeScript ignore :
    // les feuilles de style, les images, `import.meta.env`. Sans lui, un
    // `import "./styles.css"` fait échouer `npm run typecheck` (TS2882) alors
    // que la page se construit et s'affiche parfaitement.
    "types": ["node", "vite/client"],
<% } else { %>    "types": ["node"],
<% } %>
    "rootDir": "./",
    "outDir": "./dist",
    "strict": true,
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "forceConsistentCasingInFileNames": true,
<% if (it.frontend === "react") { %>    "jsx": "react-jsx",
<% } %>    "noEmit": true
  },
  "include": [
    "index.ts",
    "env.ts",
    "nodefony.config.ts",
    "rolldown.config.ts",
    "vitest.config.ts",
    "nodefony/**/*.ts",
<% if (it.frontend === "react") { %>    "frontend/src/**/*",
<% } %><% if (it.frontend === "vue" || it.frontend === "angular" || it.frontend === "svelte") { %>    "frontend/src/**/*.ts",
<% } %>    "tests/**/*.ts"
  ],
<% if (it.frontend === "angular") { %>  // tsgo checke le TS du front ; les TEMPLATES Angular sont vérifiés par ngtsc
  // au build Vite (plugin AnalogJS, cf frontend/tsconfig.app.json strictTemplates).
<% } %><% if (it.frontend === "vue") { %>  // tsgo checke le TS du front (main.ts + shim env.d.ts) ; l'INTÉRIEUR des SFC
  // .vue relève de vue-tsc (hors scope tsgo backend).
<% } %><% if (it.frontend === "svelte") { %>  // tsgo checke le TS du front (main.ts + shim env.d.ts) ; l'INTÉRIEUR des
  // .svelte relève de svelte-check (hors scope tsgo backend).
<% } %>  "exclude": ["node_modules", "dist"]
}
