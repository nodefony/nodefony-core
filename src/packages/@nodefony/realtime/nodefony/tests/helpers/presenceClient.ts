// Le client de présence vit dans `testing/` : le kit de conformité publié s'en
// sert aussi. Une implémentation, deux consommateurs.
export {
  presenceClient,
  presenceView,
  type IPresenceClient,
} from "../../testing/presenceClient";
