/**
 * Barrel des widgets — chaque module s'auto-enregistre dans le registry au chargement
 * (side-effect `registerWidget(...)`). Importer ce fichier une fois (depuis la page
 * `Workspace`) suffit à peupler le catalogue.
 */
import "./RuntimeWidget";
import "./SystemWidgets";
import "./OrmWidget";
import "./LogsWidget";
import "./LogsBackplaneWidget";
import "./RealtimeWidget";
import "./ClusterWidget";
import "./MoreWidgets";
import "./SupervisionWidgets";
import "./SupervisionDetailWidgets";
import "./SecurityWidgets";
import "./AccountWidgets";
