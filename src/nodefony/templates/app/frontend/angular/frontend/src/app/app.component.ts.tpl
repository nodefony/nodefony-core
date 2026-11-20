import { NgTemplateOutlet } from "@angular/common";
import { Component, type OnDestroy, type OnInit, signal } from "@angular/core";
<% if (it.complete) { %>// La liaison Angular de la connexion : l'état de session en signal, la page de
// connexion servie par le framework (jamais un formulaire recopié ici).
import { injectNodefonyLogin } from "nodefony/angular";
import { loginPagePath } from "nodefony/client";
<% } %>import { NODEFONY_LOGO } from "../brand";
import { DEV_HOME, type IHomeCard } from "../devHome";
import {
  applyDarkTheme,
  findDebugBar,
  findDemo,
  readDarkTheme,
  startPointerLight,
  type IDebugBarHandle,
} from "../homeEffects";
import "../showcase.css";
import "../accent.css";

/**
 * Page d'accueil de <%= it.appName %> — c'est TA page.
 *
 * Ce que voit tout visiteur : la marque, le thème<% if (it.complete) { %>, la session<% } %>, puis le nom
 * de l'application. Rien de plus en production : ni mot de passe, ni version,
 * ni lien vers la console d'administration.
 *
 * En DÉVELOPPEMENT seulement : la présentation du framework, les liens utiles
 * et où personnaliser la page. Ce contenu vit dans `devHome.ts`, qui vaut
 * `null` dans le build de production — c'est là qu'est la garde, pas ici :
 * Angular compile les textes de ce gabarit dans le bundle, affichés ou non.
 */
@Component({
  selector: "app-root",
  standalone: true,
  imports: [NgTemplateOutlet],
  template: `
    <header class="nf-topbar">
      <a class="nf-brand" href="/">
        <img [src]="logo" alt="" width="30" height="30" />
        <span><%= it.appName %></span>
        @if (dev) {
          <span class="nf-tag">développement</span>
        }
      </a>
      @if (dev) {
        <nav class="nf-topnav" aria-label="Liens de développement">
          @if (dev.console) {
            <a [href]="dev.console.href">{{ dev.console.label }}</a>
            <span class="nf-topnav-sep" aria-hidden="true"></span>
          }
          @for (link of dev.external; track link.href) {
            <a class="nf-ext" [href]="link.href">{{ link.label }}</a>
          }
        </nav>
      }
      <div class="nf-topbar-tools">
        <div class="nf-tools" role="group" aria-label="Affichage">
          <button
            type="button"
            class="nf-tool"
            [attr.aria-pressed]="dark()"
            aria-label="Thème sombre"
            title="Thème sombre"
            (click)="toggleTheme()"
          >
            @if (dark()) {
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                aria-hidden="true"
              >
                <circle cx="12" cy="12" r="4" />
                <path
                  d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"
                />
              </svg>
            } @else {
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                aria-hidden="true"
              >
                <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
              </svg>
            }
          </button>
          @if (bar()) {
            <button
              type="button"
              class="nf-tool"
              [attr.aria-pressed]="!barVisible()"
              aria-label="Cacher la barre de debug"
              title="Cacher la barre de debug"
              (click)="toggleBar()"
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                aria-hidden="true"
              >
                <path d="M8 2l1.9 1.9M16 2l-1.9 1.9" />
                <rect x="7" y="6" width="10" height="14" rx="5" />
                <path
                  d="M12 10v10M3 13h4M17 13h4M4 7l3 2M20 7l-3 2M4 19l3-2M20 19l-3-2"
                />
              </svg>
            </button>
          }
        </div>
<% if (it.complete) { %>        @if (
          login.state().step === "authenticated" && login.state().user;
          as user
        ) {
          <span class="nf-account">
            <span class="nf-session">{{ user.identifier }}</span>
            <button type="button" class="nf-account-out" (click)="logout()">
              Se déconnecter
            </button>
          </span>
        } @else {
          <a class="nf-login" [href]="loginHref">Se connecter</a>
        }
<% } %>      </div>
    </header>

    <main class="nf-main">
      <div class="nf-hero">
        <img class="nf-hero-logo" [src]="logo" alt="" width="80" height="80" />
        @if (dev) {
          <h1>{{ dev.hero.title }}</h1>
          <p class="nf-sub">{{ dev.hero.sub }}</p>
          <p class="nf-sig">{{ dev.hero.sig }}</p>
          <div class="nf-badges">
            <span class="nf-badge nf-agentic">{{ dev.hero.lead }}</span>
            <span class="nf-badge nf-front">
              <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path [attr.d]="dev.front.logo" />
              </svg>
              {{ dev.front.name }} {{ dev.front.version }}
            </span>
            @for (badge of dev.hero.badges; track badge) {
              <span class="nf-badge">{{ badge }}</span>
            }
          </div>
          <div
            class="nf-install"
            role="img"
            [attr.aria-label]="
              'Commande d\\'installation : ' +
              dev.hero.install.command +
              ' ' +
              dev.hero.install.arg
            "
          >
            <span class="nf-p">$</span>
            <span
              >{{ dev.hero.install.command }}
              <b>{{ dev.hero.install.arg }}</b></span
            >
          </div>
          @if (demo; as demoHref) {
            <div class="nf-cta">
              <a class="nf-btn nf-primary" [href]="demoHref">{{
                dev.demoLabel
              }}</a>
            </div>
          } @else {
            <p class="nf-learn">
              {{ dev.learn.label }} : <code>{{ dev.learn.command }}</code> —
              {{ dev.learn.note }}
            </p>
          }
        } @else {
          <h1><%= it.appName %></h1>
        }
      </div>

      @for (section of dev?.sections ?? []; track section.id) {
        <section
          [class]="section.band ? 'nf-section nf-band' : 'nf-section'"
          [attr.aria-labelledby]="section.id + '-title'"
        >
          <div class="nf-sec-head">
            <p class="nf-kicker">{{ section.kicker }}</p>
            <h2 [id]="section.id + '-title'">{{ section.title }}</h2>
            <p>{{ section.intro }}</p>
          </div>
          <div class="nf-grid">
            @for (card of section.cards; track card.title) {
              @if (card.href !== null) {
                <a [class]="cardClass(card)" [href]="card.href">
                  <ng-container
                    *ngTemplateOutlet="cardBody; context: { $implicit: card }"
                  ></ng-container>
                </a>
              } @else {
                <div [class]="cardClass(card)">
                  <ng-container
                    *ngTemplateOutlet="cardBody; context: { $implicit: card }"
                  ></ng-container>
                </div>
              }
            }
          </div>
          @if (section.note) {
            <p class="nf-note">{{ section.note }}</p>
          }
        </section>
      }
    </main>

    <ng-template #cardBody let-card>
      <h3>{{ card.title }}</h3>
      @if (card.creds) {
        <p class="nf-creds">
          <code>{{ card.creds.user }}</code>
          @if (card.creds.password !== null) {
            / <code>{{ card.creds.password }}</code>
          }
        </p>
      }
      <p>
        @for (part of card.text; track $index) {
          @if (part.code) {
            <code>{{ part.text }}</code>
          } @else {
            <ng-container>{{ part.text }}</ng-container>
          }
        }
      </p>
      @if (card.go) {
        <span class="nf-go">{{ card.go }}</span>
      }
      @if (card.skins) {
        <form class="nf-skins" [action]="card.skins.action" method="get">
          <select name="skin" aria-label="Habillage de la page de connexion">
            @for (skin of card.skins.options; track skin) {
              <option [value]="skin" [selected]="skin === card.skins.selected">
                {{ skin }}
              </option>
            }
          </select>
          <button type="submit">Voir</button>
        </form>
      }
    </ng-template>
  `,
})
export class AppComponent implements OnInit, OnDestroy {
  readonly logo = NODEFONY_LOGO;
  readonly dev = DEV_HOME;
  /** Thème clair/sombre : suit le système, un clic l'impose, retenu par ce navigateur. */
  readonly dark = signal(readDarkTheme());
  /** UN bouton pour la barre de debug : la cacher ou la montrer. */
  readonly bar = signal<IDebugBarHandle | null>(null);
  readonly barVisible = signal(true);
  /** La démo est-elle chargée ? Le serveur le dit dans la page (développement). */
  readonly demo = DEV_HOME === null ? null : findDemo();
<% if (it.complete) { %>  readonly login = injectNodefonyLogin();
  readonly loginHref = loginPagePath(location.pathname + location.search);
<% } %>  #stopLight: (() => void) | null = null;
  #frame = 0;

  ngOnInit(): void {
    applyDarkTheme(this.dark(), false);
<% if (it.complete) { %>    // Reprend la session existante (cookie de session, s'il y en a un).
    void this.login.flow.me();
<% } %>    this.#stopLight = startPointerLight(".nf-card");
    if (this.dev === null) return;
    // La barre est injectée à côté de la page : sa poignée arrive après le rendu.
    this.#frame = requestAnimationFrame(() => {
      const found = findDebugBar();
      this.bar.set(found);
      if (found !== null) this.barVisible.set(found.isVisible());
    });
  }

  ngOnDestroy(): void {
    this.#stopLight?.();
    cancelAnimationFrame(this.#frame);
  }

  toggleTheme(): void {
    this.dark.update((dark) => !dark);
    applyDarkTheme(this.dark());
  }

  toggleBar(): void {
    const bar = this.bar();
    if (bar === null) return;
    this.barVisible.update((visible) => !visible);
    bar.setVisible(this.barVisible());
  }

  cardClass(card: IHomeCard): string {
    return card.tone === "safe" ? "nf-card nf-safe" : "nf-card";
  }
<% if (it.complete) { %>
  async logout(): Promise<void> {
    // Session venue d'un fournisseur : suivre son adresse ferme AUSSI la sienne.
    const providerLogout = await this.login.flow.logout();
    if (providerLogout !== null) window.location.assign(providerLogout);
  }
<% } %>}
