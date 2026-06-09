import St from "gi://St";
import Clutter from "gi://Clutter";
import Soup from "gi://Soup?version=3.0";
import Gio from "gi://Gio";
import GLib from "gi://GLib";
import { BaseWidget } from "./base.js";
import { wmoIcon, wmoText } from "./wmo.js";

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
    this._surfaceRadius = 18;

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
    this._applySurface();
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
      this._applySurface();
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
    this._condLabel.set_text(wmoText(code));
    this._icon.set_icon_name(wmoIcon(code));
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

}
