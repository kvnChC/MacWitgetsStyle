import Adw from "gi://Adw";
import Gdk from "gi://Gdk";
import Gio from "gi://Gio";
import GLib from "gi://GLib";
import Gtk from "gi://Gtk";
import Soup from "gi://Soup?version=3.0";
import { ExtensionPreferences } from "resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js";

const SCHEMA_ROOT     = "org.gnome.shell.extensions.mac-widgets";
const SCHEMA_BATTERY  = "org.gnome.shell.extensions.mac-widgets.battery";
const SCHEMA_MUSIC    = "org.gnome.shell.extensions.mac-widgets.music";
const SCHEMA_WEATHER  = "org.gnome.shell.extensions.mac-widgets.weather";
const SCHEMA_CLOCK    = "org.gnome.shell.extensions.mac-widgets.clock";
const SCHEMA_FORECAST = "org.gnome.shell.extensions.mac-widgets.forecast";
const SCHEMA_PROC     = "org.gnome.shell.extensions.mac-widgets.processes";

export default class MacWidgetsPrefs extends ExtensionPreferences {
  fillPreferencesWindow(window) {
    // Las settings raíz comparten edit-mode entre páginas
    this._rootSettings = this.getSettings(SCHEMA_ROOT);
    window.add(this._buildClockPage());
    window.add(this._buildMetricsPage());
    window.add(this._buildBatteryPage());
    window.add(this._buildMusicPage());
    window.add(this._buildWeatherPage());
    window.add(this._buildForecastPage());
    window.add(this._buildProcessesPage());
  }

  _editModeGroup() {
    const group = new Adw.PreferencesGroup({
      title: "Global",
      description: "Ajustes compartidos por todos los widgets.",
    });

    const row = new Adw.SwitchRow({
      title: "Modo edición (mover widgets)",
      subtitle: "Arrástralos con el mouse y desactívalo al terminar",
    });
    this._rootSettings.bind("edit-mode", row, "active", Gio.SettingsBindFlags.DEFAULT);
    group.add(row);

    const vibrancyRow = new Adw.SwitchRow({
      title: "Vibrancy (vidrio esmerilado)",
      subtitle: "Difumina lo que hay detrás de cada widget, estilo macOS",
    });
    this._rootSettings.bind("vibrancy", vibrancyRow, "active", Gio.SettingsBindFlags.DEFAULT);
    group.add(vibrancyRow);

    group.add(this._accentRow());

    return group;
  }

  _accentRow() {
    const row = new Adw.ActionRow({
      title: "Color de acento",
      subtitle: "Anillos de métricas/batería y borde del modo edición",
    });

    const rgba = new Gdk.RGBA();
    rgba.parse(this._rootSettings.get_string("accent-color"));

    const button = new Gtk.ColorDialogButton({
      dialog: new Gtk.ColorDialog({ with_alpha: false }),
      rgba,
      valign: Gtk.Align.CENTER,
    });

    button.connect("notify::rgba", () => {
      const c = button.get_rgba();
      const hex =
        "#" +
        [c.red, c.green, c.blue]
          .map((x) => Math.round(x * 255).toString(16).padStart(2, "0"))
          .join("");
      this._rootSettings.set_string("accent-color", hex);
    });

    row.add_suffix(button);
    row.activatable_widget = button;
    return row;
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

    const controlsGroup = new Adw.PreferencesGroup({ title: "Controles" });
    const controlsRow = new Adw.SwitchRow({
      title: "Mostrar controles",
      subtitle: "Botones play/pausa/anterior/siguiente. El widget pasa a flotar sobre las ventanas.",
    });
    settings.bind("show-controls", controlsRow, "active", Gio.SettingsBindFlags.DEFAULT);
    controlsGroup.add(controlsRow);
    page.add(controlsGroup);

    const playerGroup = new Adw.PreferencesGroup({
      title: "Reproductor",
      description: "Usa las teclas multimedia o los controles del widget para play/pausa/saltar",
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

  // ───────────── Reloj ─────────────
  _buildClockPage() {
    const settings = this.getSettings(SCHEMA_CLOCK);
    const page = new Adw.PreferencesPage({
      title: "Reloj",
      icon_name: "preferences-system-time-symbolic",
    });

    page.add(this._editModeGroup());
    page.add(this._enableGroup(settings, "Mostrar widget de reloj"));

    const appearance = new Adw.PreferencesGroup({ title: "Apariencia" });
    appearance.add(this._spinRow(settings, "opacity", "Opacidad del fondo", "0 = transparente, 100 = sólido", 0, 100));
    page.add(appearance);

    const fmt = new Adw.PreferencesGroup({ title: "Formato" });

    const h24 = new Adw.SwitchRow({ title: "Formato 24 horas", subtitle: "Desactiva para AM/PM" });
    settings.bind("format-24h", h24, "active", Gio.SettingsBindFlags.DEFAULT);
    fmt.add(h24);

    const secs = new Adw.SwitchRow({ title: "Mostrar segundos" });
    settings.bind("show-seconds", secs, "active", Gio.SettingsBindFlags.DEFAULT);
    fmt.add(secs);

    const date = new Adw.SwitchRow({ title: "Mostrar fecha" });
    settings.bind("show-date", date, "active", Gio.SettingsBindFlags.DEFAULT);
    fmt.add(date);

    page.add(fmt);
    page.add(this._positionGroup(settings));
    return page;
  }

  // ───────────── Pronóstico ─────────────
  _buildForecastPage() {
    const settings = this.getSettings(SCHEMA_FORECAST);
    const page = new Adw.PreferencesPage({
      title: "Pronóstico",
      icon_name: "weather-few-clouds-symbolic",
    });

    page.add(this._editModeGroup());
    page.add(this._enableGroup(settings, "Mostrar widget de pronóstico"));

    const appearance = new Adw.PreferencesGroup({ title: "Apariencia" });
    appearance.add(this._spinRow(settings, "opacity", "Opacidad del fondo", "0 = transparente, 100 = sólido", 0, 100));
    appearance.add(this._spinRow(settings, "days", "Días", "Cuántos días mostrar", 3, 7));
    page.add(appearance);

    const info = new Adw.PreferencesGroup({
      title: "Ubicación",
      description: "Usa la misma ciudad y unidades configuradas en la página de Clima.",
    });
    page.add(info);

    page.add(this._positionGroup(settings));
    return page;
  }

  // ───────────── Top procesos ─────────────
  _buildProcessesPage() {
    const settings = this.getSettings(SCHEMA_PROC);
    const page = new Adw.PreferencesPage({
      title: "Procesos",
      icon_name: "utilities-system-monitor-symbolic",
    });

    page.add(this._editModeGroup());
    page.add(this._enableGroup(settings, "Mostrar widget de procesos"));

    const appearance = new Adw.PreferencesGroup({ title: "Apariencia" });
    appearance.add(this._spinRow(settings, "opacity", "Opacidad del fondo", "0 = transparente, 100 = sólido", 0, 100));
    appearance.add(this._spinRow(settings, "count", "Cuántos procesos", "Número de filas a mostrar", 3, 6));
    page.add(appearance);

    const sortGroup = new Adw.PreferencesGroup({ title: "Orden" });
    const sortList = new Gtk.StringList();
    sortList.append("CPU");
    sortList.append("Memoria");
    const sortRow = new Adw.ComboRow({ title: "Ordenar por", model: sortList });
    sortRow.set_selected(settings.get_string("sort-by") === "memory" ? 1 : 0);
    sortRow.connect("notify::selected", () => {
      settings.set_string("sort-by", sortRow.get_selected() === 1 ? "memory" : "cpu");
    });
    sortGroup.add(sortRow);
    page.add(sortGroup);

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
