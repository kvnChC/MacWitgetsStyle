import St from "gi://St";
import Clutter from "gi://Clutter";
import GLib from "gi://GLib";
import { BaseWidget } from "./base.js";

export class ClockWidget extends BaseWidget {
  constructor(extension) {
    super(extension, "org.gnome.shell.extensions.mac-widgets.clock");
  }

  _build() {
    this._surfaceRadius = 18;

    const card = new St.BoxLayout({
      style_class: "mac-card mac-clock",
      vertical: true,
      x_align: Clutter.ActorAlign.CENTER,
    });

    this._timeLabel = new St.Label({
      text: "--:--",
      style_class: "mac-clock-time",
      x_align: Clutter.ActorAlign.CENTER,
    });

    this._dateLabel = new St.Label({
      text: "",
      style_class: "mac-card-sub mac-clock-date",
      x_align: Clutter.ActorAlign.CENTER,
    });

    card.add_child(this._timeLabel);
    card.add_child(this._dateLabel);

    this._actor = card;
    this._applySurface();
  }

  _teardown() {
    this._timeLabel = null;
    this._dateLabel = null;
  }

  _start() {
    this._tick();
    // Alineamos al siguiente segundo y luego latimos cada segundo.
    this._timeout = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 1, () => {
      this._tick();
      return GLib.SOURCE_CONTINUE;
    });
  }

  _stop() {
    if (this._timeout) {
      GLib.source_remove(this._timeout);
      this._timeout = null;
    }
  }

  _handleSettingChange(key) {
    if (key === "opacity") this._applySurface();
    else this._tick(); // format-24h, show-seconds, show-date
  }

  _tick() {
    if (!this._timeLabel) return;
    const now = GLib.DateTime.new_now_local();

    const h24 = this._settings.get_boolean("format-24h");
    const secs = this._settings.get_boolean("show-seconds");
    let timeFmt = h24 ? "%H:%M" : "%I:%M";
    if (secs) timeFmt = h24 ? "%H:%M:%S" : "%I:%M:%S";
    if (!h24) timeFmt += " %p";

    this._timeLabel.set_text(now.format(timeFmt));

    const showDate = this._settings.get_boolean("show-date");
    this._dateLabel.visible = showDate;
    if (showDate) {
      // "lunes, 09 junio" — nombres localizados por el locale del sistema
      this._dateLabel.set_text(this._capitalize(now.format("%A, %d %B")));
    }
  }

  _capitalize(s) {
    return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
  }
}
