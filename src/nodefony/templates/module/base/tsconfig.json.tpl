{
  "compilerOptions": {
    "target": "ES2024",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ESNext", "DOM", "DOM.Iterable"],
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
    "rolldown.config.ts",
    "vitest.config.ts",
    "nodefony/**/*.ts",
<% if (it.frontend === "react") { %>    "frontend/src/**/*",
<% } %><% if (it.frontend === "vue" || it.frontend === "angular") { %>    "frontend/src/**/*.ts",
<% } %>    "tests/**/*.ts"
  ],
  "exclude": ["node_modules", "dist"]
}
