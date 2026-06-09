import St from "gi://St";
import Clutter from "gi://Clutter";
import Soup from "gi://Soup?version=3.0";
import Gio from "gi://Gio";
import GLib from "gi://GLib";
import { BaseWidget } from "./base.js";
import { wmoIcon } from "./wmo.js";

const REFRESH_SECONDS = 30 * 60; // 30 min
const GEO_URL = "https://geocoding-api.open-meteo.com/v1/search";
const FORECAST_URL = "https://api.open-meteo.com/v1/forecast";
const USER_AGENT = "mac-widgets-gnome-extension/1.0";
const WEATHER_SCHEMA = "org.gnome.shell.extensions.mac-widgets.weather";

export class ForecastWidget extends BaseWidget {
  constructor(extension) {
    super(extension, "org.gnome.shell.extensions.mac-widgets.forecast");
    // Compartimos ciudad/coordenadas/unidades con el widget de clima.
    this._weather = extension.getSettings(WEATHER_SCHEMA);
    this._session = null;
  }

  _build() {
    this._surfaceRadius = 18;

    const card = new St.BoxLayout({
      style_class: "mac-card mac-forecast",
      vertical: true,
      x_align: Clutter.ActorAlign.CENTER,
    });

    this._statusLabel = new St.Label({
      text: "Cargando…",
      style_class: "mac-card-sub",
      x_align: Clutter.ActorAlign.CENTER,
    });

    this._daysBox = new St.BoxLayout({
      style_class: "mac-forecast-days",
      vertical: false,
    });

    card.add_child(this._statusLabel);
    card.add_child(this._daysBox);

    this._actor = card;
    this._applySurface();
  }

  _teardown() {
    this._statusLabel = null;
    this._daysBox = null;
  }

  _start() {
    this._session = new Soup.Session();
    this._session.user_agent = USER_AGENT;
    this._cancellable = new Gio.Cancellable();

    this._refresh();
    this._timeout = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, REFRESH_SECONDS, () => {
      this._refresh();
      return GLib.SOURCE_CONTINUE;
    });
  }

  _stop() {
    if (this._timeout) { GLib.source_remove(this._timeout); this._timeout = null; }
    if (this._cancellable) { this._cancellable.cancel(); this._cancellable = null; }
    if (this._session) { this._session.abort(); this._session = null; }
  }

  _handleSettingChange(key) {
    if (key === "opacity") this._applySurface();
    if (key === "days") this._refresh();
  }

  _refresh() {
    const lat = this._weather.get_double("latitude");
    const lon = this._weather.get_double("longitude");
    if (lat === 0 && lon === 0) {
      this._geocodeThenFetch();
    } else {
      this._fetchForecast(lat, lon);
    }
  }

  _geocodeThenFetch() {
    const city = this._weather.get_string("city");
    if (!city) { this._setStatus("Sin ciudad configurada"); return; }
    const url = `${GEO_URL}?name=${encodeURIComponent(city)}&count=1&language=es&format=json`;
    this._httpJson(url, (json) => {
      if (!json || !json.results || json.results.length === 0) {
        this._setStatus("Ciudad no encontrada");
        return;
      }
      const r = json.results[0];
      this._fetchForecast(r.latitude, r.longitude);
    });
  }

  _fetchForecast(lat, lon) {
    const units = this._weather.get_string("units");
    const tempUnit = units === "imperial" ? "fahrenheit" : "celsius";
    const days = this._settings.get_int("days");

    const url =
      `${FORECAST_URL}?latitude=${lat}&longitude=${lon}` +
      `&daily=weather_code,temperature_2m_max,temperature_2m_min` +
      `&temperature_unit=${tempUnit}&timezone=auto&forecast_days=${days}`;

    this._httpJson(url, (json) => {
      if (!json || !json.daily || !json.daily.time) {
        this._setStatus("Sin datos");
        return;
      }
      this._render(json.daily);
    });
  }

  _render(daily) {
    if (!this._daysBox) return;
    this._statusLabel.visible = false;
    this._daysBox.destroy_all_children();

    const n = daily.time.length;
    for (let i = 0; i < n; i++) {
      const col = new St.BoxLayout({
        style_class: "mac-forecast-day",
        vertical: true,
        x_align: Clutter.ActorAlign.CENTER,
      });

      const day = new St.Label({
        text: i === 0 ? "Hoy" : this._weekday(daily.time[i]),
        style_class: "mac-forecast-dow",
        x_align: Clutter.ActorAlign.CENTER,
      });

      const icon = new St.Icon({
        icon_name: wmoIcon(daily.weather_code[i]),
        icon_size: 22,
        style_class: "mac-cell-icon",
        x_align: Clutter.ActorAlign.CENTER,
      });

      const max = Math.round(daily.temperature_2m_max[i]);
      const min = Math.round(daily.temperature_2m_min[i]);
      const temps = new St.Label({
        text: `${max}°`,
        style_class: "mac-forecast-max",
        x_align: Clutter.ActorAlign.CENTER,
      });
      const tmin = new St.Label({
        text: `${min}°`,
        style_class: "mac-forecast-min",
        x_align: Clutter.ActorAlign.CENTER,
      });

      col.add_child(day);
      col.add_child(icon);
      col.add_child(temps);
      col.add_child(tmin);
      this._daysBox.add_child(col);
    }
  }

  _setStatus(msg) {
    if (!this._statusLabel) return;
    this._statusLabel.visible = true;
    this._statusLabel.set_text(msg);
    if (this._daysBox) this._daysBox.destroy_all_children();
  }

  _weekday(isoDate) {
    // isoDate = "YYYY-MM-DD"
    const [y, m, d] = isoDate.split("-").map(Number);
    const dt = GLib.DateTime.new_local(y, m, d, 12, 0, 0);
    return dt ? this._capitalize(dt.format("%a")) : isoDate;
  }

  _capitalize(s) {
    return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
  }

  _httpJson(url, callback) {
    if (!this._session) { callback(null); return; }
    const msg = Soup.Message.new("GET", url);
    this._session.send_and_read_async(
      msg, GLib.PRIORITY_DEFAULT, this._cancellable,
      (session, res) => {
        try {
          const bytes = session.send_and_read_finish(res);
          if (msg.get_status() !== Soup.Status.OK) { callback(null); return; }
          callback(JSON.parse(new TextDecoder().decode(bytes.get_data())));
        } catch (e) {
          callback(null);
        }
      }
    );
  }
}
