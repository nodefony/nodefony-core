import { Component<% if (it.hasSecurity) { %>, type OnInit<% } %> } from "@angular/core";
<% if (it.hasSecurity) { %>// La liaison Angular de la connexion : l'état de session en signal, la page de
// connexion servie par le framework (jamais un formulaire recopié ici).
import { injectNodefonyLogin } from "nodefony/angular";
import { loginPagePath } from "nodefony/client";
<% } %>import { NODEFONY_LOGO } from "../brand";
import "../showcase.css";
import "../accent.css";

/**
 * Page d'accueil de <%= it.appName %> — MINIMALE, et c'est voulu : c'est TA page.
 *
 * Elle dit quelle application répond<% if (it.hasSecurity) { %>, propose la connexion et nomme le
 * compte connecté<% } %>. Rien de plus : ce qui part ici part en PRODUCTION, vers
 * n'importe qui — ni mot de passe, ni version, ni lien vers la console
 * d'administration.
 *
 * Pour VOIR ce que le framework sait faire, installe la démo : elle se copie
 * dans l'application et se lit comme ton propre code.
 */
@Component({
  selector: "app-root",
  standalone: true,
  template: `
    <main class="nf-main">
      <img class="nf-fwlogo" [src]="logo" alt="" width="48" height="48" />
      <h1><%= it.appName %></h1>
<% if (it.hasSecurity) { %>      <div class="nf-card" role="status">
        @if (login.state().step === "authenticated" && login.state().user; as user) {
          <p>
            Connecté en tant que
            <span class="nf-session" data-open="">{{ user.identifier }}</span>
            <button type="button" class="nf-action" (click)="logout()">
              Se déconnecter
            </button>
          </p>
        } @else {
          <a class="nf-action" [href]="loginHref">Se connecter</a>
        }
      </div>
<% } else { %>      <p class="nf-dim">Ton application répond. Cette page est la tienne.</p>
<% } %>    </main>
  `,
})
export class AppComponent<% if (it.hasSecurity) { %> implements OnInit<% } %> {
  readonly logo = NODEFONY_LOGO;
<% if (it.hasSecurity) { %>  readonly login = injectNodefonyLogin();
  readonly loginHref = loginPagePath(location.pathname + location.search);

  /** Reprend la session existante (cookie de session, s'il y en a un). */
  ngOnInit(): void {
    void this.login.flow.me();
  }

  async logout(): Promise<void> {
    // Session venue d'un fournisseur : suivre son adresse ferme AUSSI la sienne.
    const providerLogout = await this.login.flow.logout();
    if (providerLogout !== null) window.location.assign(providerLogout);
  }
<% } %>}
