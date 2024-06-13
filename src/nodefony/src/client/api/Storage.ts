import Service from "../../Service";
import Container from "../../Container";
import { extend, isUndefined } from "../../Tools";

interface Stockage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(clé: string): void;
}

const defaultStorage = {
  storage: {
    type: "session", // local
    tokenName: "token",
    refreshTokenNane: "refresh-token",
  },
};

class Storage extends Service {
  storage: Stockage = window.localStorage;
  tokenName: string = "token";
  refreshTokenNane: string = "refresh-token";
  constructor(name: string, options = {}, service?: Service) {
    if (service) {
      super(
        name,
        (service.container as Container) || null,
        false,
        extend(true, {}, defaultStorage, options)
      );
    } else {
      super(name, undefined, false, extend(true, {}, defaultStorage, options));
    }
    if (this.options.storage.type === "local") {
      this.storage = window.localStorage;
    } else {
      this.storage = window.sessionStorage;
    }
    this.tokenName = `${this.options.storage.tokenName}`;
    this.refreshTokenNane = `${this.options.storage.refreshTokenNane}`;
  }

  get token() {
    return this.storage.getItem(this.tokenName) || null;
  }
  set token(value) {
    const val = isUndefined(value);
    if (val) {
      return;
    }
    this.storage.setItem(this.tokenName, value as string);
  }

  get refreshToken() {
    return this.storage.getItem(this.refreshTokenNane) || null;
  }
  set refreshToken(value) {
    if (value) this.storage.setItem(this.refreshTokenNane, value);
  }

  clearToken(refresh = false) {
    if (refresh) {
      this.storage.removeItem(this.refreshTokenNane);
      //delete this.refreshToken;
    }
    this.storage.removeItem(this.tokenName);
    //delete this.token;
  }
}

export default Storage;
