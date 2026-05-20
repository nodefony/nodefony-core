import { bootstrapApplication } from "@angular/platform-browser";
import { provideZonelessChangeDetection } from "@angular/core";
import { AppComponent } from "./app/app.component";

// Zoneless (Angular 20+) : pas de zone.js, la détection de changement est
// pilotée par les signals → bundle plus léger, pas de polyfill.
bootstrapApplication(AppComponent, {
  providers: [provideZonelessChangeDetection()],
}).catch((err) => console.error(err));
