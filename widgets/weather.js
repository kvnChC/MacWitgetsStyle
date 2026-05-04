import St from "gi://St";
import Clutter from "gi://Clutter";
import Soup from "gi://Soup?version=3.0";
import Gio from "gi://Gio";
import GLib from "gi://GLib";
import { BaseWidget } from "./base.js";

const REFRESH_SECONDS = 15 * 60; // 15 min
const GEO_URL = "https://geocoding-api.open-meteo.com/v1/search";
const FORECAST_URL = "https://api.open-meteo.com/v1/forecast";
const USER_AGENT = "mac-widgets-gnome-extension/1.0";

export class WeatherWidget extends BaseWidget {
  constructor(extension) {
    super(extension, "org.gnome.shell.extensions.mac-widgets.weather");
    this._session = null;
  }

  _build() {
    const card = new St.BoxLayout({
      style_class: "mac-card",
      vertical: true,
      x_align: Clutter.ActorAlign.CENTER,
    });

    this._icon = new St.Icon({
      icon_name: "weather-clear-symbolic",
      icon_size: 36,
      style_class: "mac-cell-icon",
      x_align: Clutter.ActorAlign.CENTER,
    });

    this._tempLabel = new St.Label({
      text: "—",
      style_class: "mac-card-value mac-weather-temp",
      x_align: Clutter.ActorAlign.CENTER,
    });

    this._condLabel = new St.Label({
      text: "Cargando…",
      style_class: "mac-card-sub",
      x_align: Clutter.ActorAlign.CENTER,
    });

    this._cityLabel = new St.Label({
      text:
        this._settings.get_string("display-name") ||
        this._settings.get_string("city"),
      style_class: "mac-card-sub mac-weather-city",
      x_align: Clutter.ActorAlign.CENTER,
    });

    card.add_child(this._icon);
    card.add_child(this._tempLabel);
    card.add_child(this._condLabel);
    card.add_child(this._cityLabel);

    this._actor = card;
    this._applyOpacity();
  }

  _applyOpacity() {
    if (!this._actor) return;
    const alpha = this._settings.get_int("opacity") / 100;
    this._actor.set_style(`background-color: rgba(30, 30, 30, ${alpha});`);
  }

  _teardown() {
    this._icon = null;
    this._tempLabel = null;
    this._condLabel = null;
    this._cityLabel = null;
  }

  _start() {
    this._session = new Soup.Session();
    this._session.user_agent = USER_AGENT;
    this._cancellable = new Gio.Cancellable();

    this._refresh();
    this._timeout = GLib.timeout_add_seconds(
      GLib.PRIORITY_DEFAULT,
      REFRESH_SECONDS,
      () => {
        this._refresh();
        return GLib.SOURCE_CONTINUE;
      },
    );
  }

  _stop() {
    if (this._timeout) {
      GLib.source_remove(this._timeout);
      this._timeout = null;
    }
    if (this._cancellable) {
      this._cancellable.cancel();
      this._cancellable = null;
    }
    if (this._session) {
      this._session.abort();
      this._session = null;
    }
  }

  _handleSettingChange(key) {
    if (key === "city" || key === "units") {
      this._refresh();
    }
    if (key === "display-name" && this._cityLabel) {
      this._cityLabel.set_text(
        this._settings.get_string("display-name") ||
          this._settings.get_string("city"),
      );
    }
    if (key === "opacity") {
      this._applyOpacity();
    }
  }

  _refresh() {
    const lat = this._settings.get_double("latitude");
    const lon = this._settings.get_double("longitude");

    if (lat === 0 && lon === 0) {
      this._geocodeThenFetch();
    } else {
      this._fetchForecast(lat, lon);
    }
  }

  _geocodeThenFetch() {
    const city = this._settings.get_string("city");
    if (!city) {
      this._setError("Sin ciudad configurada");
      return;
    }
    this._geocode(city, (result) => {
      if (!result) {
        this._setError("Ciudad no encontrada");
        return;
      }
      this._settings.set_double("latitude", result.lat);
      this._settings.set_double("longitude", result.lon);
      this._settings.set_string("display-name", result.displayName);
      this._fetchForecast(result.lat, result.lon);
    });
  }

  _geocode(city, callback) {
    const url = `${GEO_URL}?name=${encodeURIComponent(city)}&count=1&language=es&format=json`;
    this._httpJson(url, (json) => {
      if (!json || !json.results || json.results.length === 0) {
        callback(null);
        return;
      }
      const r = json.results[0];
      const parts = [r.name, r.admin1, r.country].filter(Boolean);
      callback({
        lat: r.latitude,
        lon: r.longitude,
        displayName: parts.join(", "),
      });
    });
  }

  _fetchForecast(lat, lon) {
    const units = this._settings.get_string("units");
    const tempUnit = units === "imperial" ? "fahrenheit" : "celsius";
    const windUnit = units === "imperial" ? "mph" : "kmh";

    const url =
      `${FORECAST_URL}?latitude=${lat}&longitude=${lon}` +
      `&current=temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m` +
      `&temperature_unit=${tempUnit}&wind_speed_unit=${windUnit}&timezone=auto`;

    this._httpJson(url, (json) => {
      if (!json || !json.current) {
        this._setError("Sin datos");
        return;
      }
      this._render(json.current, units);
    });
  }

  _render(current, units) {
    if (!this._tempLabel) return;
    const tSym = units === "imperial" ? "°F" : "°C";
    const t = Math.round(current.temperature_2m);
    const code = current.weather_code;

    this._tempLabel.set_text(`${t}${tSym}`);
    this._condLabel.set_text(this._wmoText(code));
    this._icon.set_icon_name(this._wmoIcon(code));
  }

  _setError(msg) {
    if (!this._tempLabel) return;
    this._tempLabel.set_text("—");
    this._condLabel.set_text(msg);
  }

  _httpJson(url, callback) {
    if (!this._session) {
      callback(null);
      return;
    }
    const msg = Soup.Message.new("GET", url);
    this._session.send_and_read_async(
      msg,
      GLib.PRIORITY_DEFAULT,
      this._cancellable,
      (session, res) => {
        try {
          const bytes = session.send_and_read_finish(res);
          if (msg.get_status() !== Soup.Status.OK) {
            callback(null);
            return;
          }
          const text = new TextDecoder().decode(bytes.get_data());
          callback(JSON.parse(text));
        } catch (e) {
          callback(null);
        }
      },
    );
  }

  _wmoIcon(code) {
    if (code === 0) return "weather-clear-symbolic";
    if (code <= 2) return "weather-few-clouds-symbolic";
    if (code === 3) return "weather-overcast-symbolic";
    if (code <= 48) return "weather-fog-symbolic";
    if (code <= 57) return "weather-showers-scattered-symbolic";
    if (code <= 67) return "weather-showers-symbolic";
    if (code <= 77) return "weather-snow-symbolic";
    if (code <= 82) return "weather-showers-symbolic";
    if (code <= 86) return "weather-snow-symbolic";
    if (code >= 95) return "weather-storm-symbolic";
    return "weather-clear-symbolic";
  }

  _wmoText(code) {
    const map = {
      0: "Despejado",
      1: "Mayormente despejado",
      2: "Parcialmente nublado",
      3: "Nublado",
      45: "Niebla",
      48: "Niebla con escarcha",
      51: "Llovizna ligera",
      53: "Llovizna",
      55: "Llovizna intensa",
      56: "Llovizna helada",
      57: "Llovizna helada intensa",
      61: "Lluvia ligera",
      63: "Lluvia",
      65: "Lluvia intensa",
      66: "Lluvia helada",
      67: "Lluvia helada intensa",
      71: "Nieve ligera",
      73: "Nieve",
      75: "Nieve intensa",
      77: "Granos de nieve",
      80: "Aguacero ligero",
      81: "Aguacero",
      82: "Aguacero intenso",
      85: "Aguanieve",
      86: "Aguanieve intensa",
      95: "Tormenta",
      96: "Tormenta con granizo",
      99: "Tormenta intensa",
    };
    return map[code] ?? `Código ${code}`;
  }
}
