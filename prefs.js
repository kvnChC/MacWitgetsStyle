import Adw from "gi://Adw";
import Gdk from "gi://Gdk";
import Gio from "gi://Gio";
import GLib from "gi://GLib";
import Gtk from "gi://Gtk";
import Soup from "gi://Soup?version=3.0";
import { ExtensionPreferences } from "resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js";

const SCHEMA_ROOT    = "org.gnome.shell.extensions.mac-widgets";
const SCHEMA_BATTERY = "org.gnome.shell.extensions.mac-widgets.battery";
const SCHEMA_MUSIC   = "org.gnome.shell.extensions.mac-widgets.music";
const SCHEMA_WEATHER = "org.gnome.shell.extensions.mac-widgets.weather";

export default class MacWidgetsPrefs extends ExtensionPreferences {
  fillPreferencesWindow(window) {
    // Las settings raíz comparten edit-mode entre páginas
    this._rootSettings = this.getSettings(SCHEMA_ROOT);
    window.add(this._buildMetricsPage());
    window.add(this._buildBatteryPage());
    window.add(this._buildMusicPage());
    window.add(this._buildWeatherPage());
  }

  _editModeGroup() {
    const group = new Adw.PreferencesGroup({
      title: "Edición",
      description: "Activa para arrastrar widgets a su posición. Mientras esté ON, los widgets aparecen encima de las ventanas con borde celeste.",
    });
    const row = new Adw.SwitchRow({
      title: "Modo edición (mover widgets)",
      subtitle: "Arrástralos con el mouse y desactívalo al terminar",
    });
    this._rootSettings.bind("edit-mode", row, "active", Gio.SettingsBindFlags.DEFAULT);
    group.add(row);
    return group;
  }

  // ───────────── Métricas (root) ─────────────
  _buildMetricsPage() {
    const settings = this.getSettings(SCHEMA_ROOT);
    const page = new Adw.PreferencesPage({
      title: "Métricas",
      icon_name: "utilities-system-monitor-symbolic",
    });

    page.add(this._editModeGroup());
    page.add(this._enableGroup(settings, "Mostrar widget de métricas"));

    const appearance = new Adw.PreferencesGroup({ title: "Apariencia" });
    appearance.add(this._spinRow(settings, "opacity", "Opacidad del fondo", "0 = transparente, 100 = sólido", 0, 100));
    appearance.add(this._spinRow(settings, "cell-size", "Tamaño", "Diámetro de cada celda (px)", 32, 120));
    page.add(appearance);

    page.add(this._positionGroup(settings));
    return page;
  }

  // ───────────── Batería ─────────────
  _buildBatteryPage() {
    const settings = this.getSettings(SCHEMA_BATTERY);
    const page = new Adw.PreferencesPage({
      title: "Batería",
      icon_name: "battery-good-symbolic",
    });
    page.add(this._editModeGroup());
    page.add(this._enableGroup(settings, "Mostrar widget de batería"));

    const appearance = new Adw.PreferencesGroup({ title: "Apariencia" });
    appearance.add(this._spinRow(settings, "opacity", "Opacidad del fondo", "0 = transparente, 100 = sólido", 0, 100));
    page.add(appearance);

    page.add(this._positionGroup(settings));
    return page;
  }

  // ───────────── Música ─────────────
  _buildMusicPage() {
    const settings = this.getSettings(SCHEMA_MUSIC);
    const page = new Adw.PreferencesPage({
      title: "Música",
      icon_name: "audio-x-generic-symbolic",
    });
    page.add(this._editModeGroup());
    page.add(this._enableGroup(settings, "Mostrar widget de música"));

    const appearance = new Adw.PreferencesGroup({ title: "Apariencia" });
    appearance.add(this._spinRow(settings, "opacity", "Opacidad del fondo", "0 = transparente, 100 = sólido", 0, 100));
    page.add(appearance);

    const playerGroup = new Adw.PreferencesGroup({
      title: "Reproductor",
      description: "Solo info — usa las teclas multimedia (Fn+F7/F8/F9) para play/pausa/saltar",
    });

    const entry = new Adw.EntryRow({
      title: "Reproductor preferido",
      show_apply_button: true,
    });
    entry.set_text(settings.get_string("preferred-player"));
    entry.connect("apply", () => {
      settings.set_string("preferred-player", entry.get_text());
    });
    playerGroup.add(entry);

    const hint = new Adw.ActionRow({
      title: "Sugerencia",
      subtitle: 'Bus name parcial — ej. "spotify", "vlc", "firefox". Vacío = primer reproductor disponible.',
    });
    playerGroup.add(hint);

    page.add(playerGroup);
    page.add(this._positionGroup(settings));
    return page;
  }

  // ───────────── Clima ─────────────
  _buildWeatherPage() {
    const settings = this.getSettings(SCHEMA_WEATHER);
    const page = new Adw.PreferencesPage({
      title: "Clima",
      icon_name: "weather-clear-symbolic",
    });

    page.add(this._editModeGroup());
    page.add(this._enableGroup(settings, "Mostrar widget de clima"));

    const appearance = new Adw.PreferencesGroup({ title: "Apariencia" });
    appearance.add(this._spinRow(settings, "opacity", "Opacidad del fondo", "0 = transparente, 100 = sólido", 0, 100));
    page.add(appearance);

    // Ubicación
    const locGroup = new Adw.PreferencesGroup({ title: "Ubicación" });

    const cityRow = new Adw.EntryRow({
      title: "Ciudad",
      show_apply_button: true,
    });
    cityRow.set_text(settings.get_string("city"));
    cityRow.connect("apply", () => {
      const v = cityRow.get_text();
      if (v !== settings.get_string("city")) {
        settings.set_string("city", v);
        // invalidar coordenadas cacheadas para forzar geocoding
        settings.set_double("latitude", 0);
        settings.set_double("longitude", 0);
        settings.set_string("display-name", "");
      }
    });
    locGroup.add(cityRow);

    const unitsList = new Gtk.StringList();
    unitsList.append("Métrico (°C, km/h)");
    unitsList.append("Imperial (°F, mph)");
    const unitsRow = new Adw.ComboRow({
      title: "Unidades",
      model: unitsList,
    });
    unitsRow.set_selected(settings.get_string("units") === "imperial" ? 1 : 0);
    unitsRow.connect("notify::selected", () => {
      settings.set_string("units", unitsRow.get_selected() === 1 ? "imperial" : "metric");
    });
    locGroup.add(unitsRow);

    page.add(locGroup);

    // Información del proveedor
    const infoGroup = new Adw.PreferencesGroup({
      title: "Información del proveedor",
      description: "Open-Meteo (sin clave de API)",
    });
    infoGroup.add(this._infoRow("Base URL",   "https://api.open-meteo.com/v1/forecast"));
    infoGroup.add(this._infoRow("Rate Limit", "10 000 requests/day"));
    infoGroup.add(this._infoRow("API Key",    "No requerida"));
    infoGroup.add(this._infoRow("Parameters", "temperature_2m, relative_humidity_2m, weather_code, wind_speed_10m"));
    page.add(infoGroup);

    // Probar conexión
    const testGroup = new Adw.PreferencesGroup();
    const testRow = new Adw.ActionRow({
      title: "Probar conexión",
      subtitle: "Geocodifica la ciudad y consulta el clima actual",
    });

    const resultLabel = new Gtk.Label({
      label: "",
      css_classes: ["dim-label"],
      ellipsize: 3, // pango.EllipsizeMode.END
      xalign: 1,
    });
    const testButton = new Gtk.Button({
      label: "Probar",
      css_classes: ["suggested-action"],
      valign: Gtk.Align.CENTER,
    });
    testRow.add_suffix(resultLabel);
    testRow.add_suffix(testButton);
    testRow.activatable_widget = testButton;

    testButton.connect("clicked", () => {
      testButton.set_sensitive(false);
      resultLabel.set_label("Probando…");
      this._testWeather(settings, (ok, msg) => {
        testButton.set_sensitive(true);
        resultLabel.set_label((ok ? "✅ " : "❌ ") + msg);
        resultLabel.remove_css_class("dim-label");
        resultLabel.remove_css_class("error");
        resultLabel.remove_css_class("success");
        resultLabel.add_css_class(ok ? "success" : "error");
      });
    });

    testGroup.add(testRow);
    page.add(testGroup);

    page.add(this._positionGroup(settings));
    return page;
  }

  // ───────────── Helpers ─────────────

  _enableGroup(settings, label) {
    const group = new Adw.PreferencesGroup();
    const row = new Adw.SwitchRow({ title: label });
    settings.bind("enabled", row, "active", Gio.SettingsBindFlags.DEFAULT);
    group.add(row);
    return group;
  }

  _spinRow(settings, key, title, subtitle, lower, upper) {
    const row = new Adw.SpinRow({
      title,
      subtitle,
      adjustment: new Gtk.Adjustment({
        lower, upper, step_increment: 1, page_increment: 5,
      }),
    });
    settings.bind(key, row, "value", Gio.SettingsBindFlags.DEFAULT);
    return row;
  }

  _positionGroup(settings) {
    const group = new Adw.PreferencesGroup({ title: "Posición" });

    const centerRow = new Adw.SwitchRow({
      title: "Centrar horizontalmente",
      subtitle: "Ignora la posición X",
    });
    settings.bind("center-horizontally", centerRow, "active", Gio.SettingsBindFlags.DEFAULT);
    group.add(centerRow);

    const xRow = this._spinRow(settings, "position-x", "Posición X", "px desde el borde izquierdo", 0, 10000);
    settings.bind("center-horizontally", xRow, "sensitive",
      Gio.SettingsBindFlags.GET | Gio.SettingsBindFlags.INVERT_BOOLEAN);
    group.add(xRow);

    const yRow = this._spinRow(settings, "position-y", "Posición Y", "px desde el borde superior", 0, 10000);
    group.add(yRow);

    // Monitor selector
    const monRow = this._monitorRow(settings);
    group.add(monRow);

    return group;
  }

  _monitorRow(settings) {
    const list = new Gtk.StringList();
    list.append("Primario (automático)");
    const display = Gdk.Display.get_default();
    const monitors = display ? display.get_monitors() : null;
    const count = monitors ? monitors.get_n_items() : 0;
    for (let i = 0; i < count; i++) {
      const m = monitors.get_item(i);
      const g = m.get_geometry();
      const conn = m.get_connector() || `Monitor ${i + 1}`;
      list.append(`${conn} — ${g.width}×${g.height}`);
    }

    const row = new Adw.ComboRow({ title: "Mostrar en", model: list });
    const initial = settings.get_int("monitor");
    row.set_selected(initial < 0 ? 0 : Math.min(initial + 1, count));
    row.connect("notify::selected", () => {
      const sel = row.get_selected();
      settings.set_int("monitor", sel === 0 ? -1 : sel - 1);
    });
    return row;
  }

  _infoRow(title, value) {
    const row = new Adw.ActionRow({ title, subtitle: value });
    row.add_css_class("property");
    return row;
  }

  // ───────────── Probar conexión (clima) ─────────────

  _testWeather(settings, callback) {
    const city = settings.get_string("city");
    if (!city) { callback(false, "Sin ciudad configurada"); return; }

    const session = new Soup.Session();
    session.user_agent = "mac-widgets-gnome-extension/1.0";

    // 1) Geocoding
    const geoUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=es&format=json`;
    this._httpJson(session, geoUrl, (json) => {
      if (!json || !json.results || json.results.length === 0) {
        callback(false, `Ciudad "${city}" no encontrada`);
        return;
      }
      const r = json.results[0];
      const parts = [r.name, r.admin1, r.country].filter(Boolean);
      const displayName = parts.join(", ");

      // Cache geo result
      settings.set_double("latitude",  r.latitude);
      settings.set_double("longitude", r.longitude);
      settings.set_string("display-name", displayName);

      // 2) Forecast
      const units = settings.get_string("units");
      const tUnit = units === "imperial" ? "fahrenheit" : "celsius";
      const tSym  = units === "imperial" ? "°F" : "°C";
      const forecastUrl =
        `https://api.open-meteo.com/v1/forecast?latitude=${r.latitude}&longitude=${r.longitude}` +
        `&current=temperature_2m,weather_code&temperature_unit=${tUnit}&timezone=auto`;

      this._httpJson(session, forecastUrl, (json2) => {
        if (!json2 || !json2.current) {
          callback(false, "Sin datos de clima");
          return;
        }
        const t = Math.round(json2.current.temperature_2m);
        callback(true, `${t}${tSym} en ${displayName}`);
      });
    });
  }

  _httpJson(session, url, callback) {
    const msg = Soup.Message.new("GET", url);
    session.send_and_read_async(
      msg, GLib.PRIORITY_DEFAULT, null,
      (s, res) => {
        try {
          const bytes = s.send_and_read_finish(res);
          if (msg.get_status() !== Soup.Status.OK) {
            callback(null);
            return;
          }
          const text = new TextDecoder().decode(bytes.get_data());
          callback(JSON.parse(text));
        } catch (e) {
          callback(null);
        }
      }
    );
  }
}
