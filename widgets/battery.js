import St from "gi://St";
import Clutter from "gi://Clutter";
import GLib from "gi://GLib";
import Gio from "gi://Gio";
import { BaseWidget, rampColor, RAMP_AMBER, RAMP_RED, RAMP_GREEN } from "./base.js";

const POLL_SECONDS = 5;
const RING_SIZE = 64;
const RING_WIDTH = 5;
const ICON_SIZE = 24;

export class BatteryWidget extends BaseWidget {
  constructor(extension) {
    super(extension, "org.gnome.shell.extensions.mac-widgets.battery");
    this._batteryPath = this._findBattery();
  }

  _build() {
    if (!this._batteryPath) {
      this._actor = null;
      return; // silent no-op (desktop sin batería)
    }

    this._surfaceRadius = 18;

    const card = new St.BoxLayout({
      style_class: "mac-card",
      vertical: true,
      x_align: Clutter.ActorAlign.CENTER,
    });

    const head = new St.Widget({
      layout_manager: new Clutter.BinLayout(),
      width: RING_SIZE,
      height: RING_SIZE,
    });

    this._drawing = new St.DrawingArea({ width: RING_SIZE, height: RING_SIZE });

    this._icon = new St.Icon({
      icon_name: "battery-good-symbolic",
      icon_size: ICON_SIZE,
      style_class: "mac-cell-icon",
      x_align: Clutter.ActorAlign.CENTER,
      y_align: Clutter.ActorAlign.CENTER,
    });

    head.add_child(this._drawing);
    head.add_child(this._icon);

    this._percentLabel = new St.Label({
      text: "—",
      style_class: "mac-card-value",
      x_align: Clutter.ActorAlign.CENTER,
    });

    this._statusLabel = new St.Label({
      text: "",
      style_class: "mac-card-sub",
      x_align: Clutter.ActorAlign.CENTER,
    });

    card.add_child(head);
    card.add_child(this._percentLabel);
    card.add_child(this._statusLabel);

    this._actor = card;
    this._capacity = 0;
    this._charging = false;

    this._drawing.connect("repaint", (area) => this._drawRing(area));
    this._applySurface();
  }

  _handleSettingChange(key) {
    if (key === "opacity") this._applySurface();
  }

  _teardown() {
    this._drawing = null;
    this._icon = null;
    this._percentLabel = null;
    this._statusLabel = null;
  }

  _start() {
    this._tick();
    this._timeout = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, POLL_SECONDS, () => {
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

  _tick() {
    if (!this._batteryPath || !this._actor) return;

    const cap = this._readInt(`${this._batteryPath}/capacity`);
    const status = this._readString(`${this._batteryPath}/status`);

    if (cap === null) return;

    this._capacity = cap;
    this._charging = status === "Charging" || status === "Full";

    this._percentLabel.set_text(`${cap}%`);
    this._statusLabel.set_text(this._humanStatus(status));
    this._icon.set_icon_name(this._iconFor(cap, this._charging));
    this._drawing.queue_repaint();
  }

  _drawRing(area) {
    const cr = area.get_context();
    const w = area.width;
    const cx = w / 2;
    const cy = area.height / 2;
    const radius = (w - RING_WIDTH) / 2;

    cr.setSourceRGBA(1, 1, 1, 0.07);
    cr.arc(cx, cy, radius - RING_WIDTH / 2, 0, 2 * Math.PI);
    cr.fill();

    cr.setSourceRGBA(1, 1, 1, 0.13);
    cr.setLineWidth(RING_WIDTH);
    cr.arc(cx, cy, radius, 0, 2 * Math.PI);
    cr.stroke();

    const p = Math.max(0, Math.min(100, this._capacity)) / 100;
    if (p > 0) {
      const [r, g, b] = this._color(this._capacity, this._charging);
      cr.setSourceRGBA(r, g, b, 1);
      cr.setLineWidth(RING_WIDTH);
      cr.setLineCap(1);
      cr.arc(cx, cy, radius, -Math.PI / 2, -Math.PI / 2 + p * 2 * Math.PI);
      cr.stroke();
    }

    cr.$dispose();
  }

  _color(cap, charging) {
    if (charging) return RAMP_GREEN;
    // Rampa inversa: rojo (vacío) → ámbar → acento (lleno)
    return rampColor(cap / 100, [[0, RAMP_RED], [0.5, RAMP_AMBER], [1, this._accentRgb()]]);
  }

  _iconFor(cap, charging) {
    const level =
      cap < 10 ? "empty"
      : cap < 30 ? "caution"
      : cap < 60 ? "low"
      : cap < 90 ? "good"
      : "full";
    return charging
      ? `battery-${level}-charging-symbolic`
      : `battery-${level}-symbolic`;
  }

  _humanStatus(status) {
    switch (status) {
      case "Charging":     return "Cargando";
      case "Discharging":  return "Descargando";
      case "Full":         return "Llena";
      case "Not charging": return "Sin cargar";
      default:             return status || "";
    }
  }

  _findBattery() {
    try {
      const dir = Gio.File.new_for_path("/sys/class/power_supply");
      const enumr = dir.enumerate_children("standard::name", Gio.FileQueryInfoFlags.NONE, null);
      let info;
      while ((info = enumr.next_file(null)) !== null) {
        const name = info.get_name();
        const path = `/sys/class/power_supply/${name}`;
        // Identificar por type (Battery), no por el nombre: cubre BAT0/BAT1/CMB0/etc.
        // y excluye UPS y la fuente de alimentación (Mains).
        if (
          this._readString(`${path}/type`) === "Battery" &&
          this._readInt(`${path}/capacity`) !== null
        ) {
          return path;
        }
      }
    } catch (e) {}
    return null;
  }

  _readString(path) {
    try {
      const [ok, out] = GLib.file_get_contents(path);
      if (!ok) return null;
      return out.toString().trim();
    } catch (e) { return null; }
  }

  _readInt(path) {
    const s = this._readString(path);
    if (s === null) return null;
    const n = parseInt(s, 10);
    return isNaN(n) ? null : n;
  }
}
