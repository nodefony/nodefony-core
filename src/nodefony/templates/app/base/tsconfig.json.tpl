{
  "compilerOptions": {
    "target": "ES2024",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "types": ["node"],
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
<% } %><% if (it.frontend === "vue" || it.frontend === "angular") { %>    "frontend/src/**/*.ts",
<% } %>    "tests/**/*.ts"
  ],
<% if (it.frontend === "angular") { %>  // tsgo checke le TS du front ; les TEMPLATES Angular sont vérifiés par ngtsc
  // au build Vite (plugin AnalogJS, cf frontend/tsconfig.app.json strictTemplates).
<% } %><% if (it.frontend === "vue") { %>  // tsgo checke le TS du front (main.ts + shim env.d.ts) ; l'INTÉRIEUR des SFC
  // .vue relève de vue-tsc (hors scope tsgo backend).
<% } %>  "exclude": ["node_modules", "dist"]
}
