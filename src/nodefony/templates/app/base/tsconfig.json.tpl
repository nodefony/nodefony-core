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
<% } %>    "tests/**/*.ts"
  ],
<% if (it.frontend === "angular") { %>  // Le frontend Angular a SON tsconfig (frontend/tsconfig.app.json, plugin AnalogJS).
<% } %><% if (it.frontend === "vue") { %>  // Les SFC .vue se typechecken avec vue-tsc (hors scope tsgo backend).
<% } %>  "exclude": ["node_modules", "dist"<% if (it.frontend === "angular" || it.frontend === "vue") { %>, "frontend"<% } %>]
}
