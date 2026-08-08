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
<% } %><% if (it.publishable) { %>    "stripInternal": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "declaration": true,
    "declarationDir": "./dist/types"
<% } else { %>    "noEmit": true
<% } %>  },
  "include": [
    "index.ts",
    "rolldown.config.ts",
<% if (!it.publishable) { %>    "vitest.config.ts",
<% } %>    "nodefony/**/*.ts"<% if (it.frontend === "react") { %>,
    "frontend/src/**/*"<% } %><% if (it.frontend === "vue" || it.frontend === "angular" || it.frontend === "svelte") { %>,
    "frontend/src/**/*.ts"<% } %><% if (!it.publishable) { %>,
    "tests/**/*.ts"<% } %>
  ],
<% if (it.publishable) { %>  "exclude": [
    "node_modules",
    "dist",
    "tests/**",
    "**/*.test.ts",
    "vitest.config.ts"
  ]
<% } else { %>  "exclude": ["node_modules", "dist"]
<% } %>}
