import St from "gi://St";
import Clutter from "gi://Clutter";
import GLib from "gi://GLib";
import Gio from "gi://Gio";
import { BaseWidget, rampColor, RAMP_AMBER, RAMP_RED } from "./base.js";

const UPDATE_SECONDS = 2;
const TEMP_RING_MAX = 100;
// Iconos que empaquetamos en icons/ porque no están en Adwaita (tema base
// de todas las distros): el de CPU es solo de Yaru y temperature falta a veces.
const BUNDLED_ICONS = new Set(["cpu-symbolic", "temperature-symbolic"]);
// nvidia-smi es caro de arrancar; lo consultamos 1 de cada N ticks (≈8 s).
// El backend AMD lee un archivo y se actualiza en cada tick.
const NVIDIA_EVERY = 4;

export class MetricsWidget extends BaseWidget {
  constructor(extension) {
    super(extension, "org.gnome.shell.extensions.mac-widgets");
    this._gpuPending = false;
    this._tempPath = this._findCpuTempPath();
    this._gpuBackend = this._detectGpuBackend();
  }

  _build() {
    this._surfaceRadius = 32; // forma "pill"
    this._cellSize = this._settings.get_int("cell-size");
    this._ringWidth = Math.max(2, Math.round(this._cellSize / 14));
    this._iconSize = Math.round(this._cellSize * 0.4);

    // Rampa continua: acento (bajo/ok) → ámbar → rojo (alto)
    this._metricStops = [[0, this._accentRgb()], [0.55, RAMP_AMBER], [1, RAMP_RED]];

    const pill = new St.BoxLayout({
      style_class: "mac-pill",
      vertical: false,
    });

    const order = ["cpu", "ram", "disk", "temp"];
    if (this._gpuBackend) order.push("gpu");

    const defs = {
      cpu:  ["cpu-symbolic", "%"],
      ram:  ["media-flash-symbolic", "%"],
      disk: ["drive-harddisk-symbolic", "%"],
      temp: ["temperature-symbolic", "°C"],
      gpu:  ["video-display-symbolic", "%"],
    };

    this._cells = {};
    for (let key of order) {
      const [icon, suffix] = defs[key];
      this._cells[key] = this._makeCell(icon, suffix);
      pill.add_child(this._cells[key].container);
    }

    this._actor = pill;
    this._applySurface();
  }

  _teardown() {
    this._cells = null;
  }

  _start() {
    this._prevTotal = 0;
    this._prevIdle = 0;
    this._tickCount = 0;
    this._tick();
    this._timeout = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, UPDATE_SECONDS, () => {
      this._tick();
      return GLib.SOURCE_CONTINUE;
    });
  }

  _stop() {
    if (this._timeout) {
      GLib.source_remove(this._timeout);
      this._timeout = null;
    }
    if (this._gpuCancel) {
      this._gpuCancel.cancel();
      this._gpuCancel = null;
    }
  }

  _handleSettingChange(key) {
    if (key === "cell-size") {
      this._deactivate();
      this._activate();
    } else if (key === "opacity") {
      this._applySurface();
    }
  }

  _makeIcon(iconName) {
    const props = {
      icon_size: this._iconSize,
      style_class: "mac-cell-icon",
      x_align: Clutter.ActorAlign.CENTER,
      y_align: Clutter.ActorAlign.CENTER,
    };
    if (BUNDLED_ICONS.has(iconName)) {
      const file = Gio.File.new_for_path(
        GLib.build_filenamev([this._ext.path, "icons", `${iconName}.svg`])
      );
      props.gicon = new Gio.FileIcon({ file });
    } else {
      props.icon_name = iconName;
    }
    return new St.Icon(props);
  }

  _makeCell(iconName, suffix = "%") {
    const size = this._cellSize;
    const ringWidth = this._ringWidth;

    let container = new St.BoxLayout({
      style_class: "mac-cell",
      vertical: true,
      x_align: Clutter.ActorAlign.CENTER,
    });

    let head = new St.Widget({
      layout_manager: new Clutter.BinLayout(),
      width: size,
      height: size,
    });

    let drawing = new St.DrawingArea({ width: size, height: size });

    let icon = this._makeIcon(iconName);

    head.add_child(drawing);
    head.add_child(icon);

    let label = new St.Label({
      text: `0${suffix}`,
      style_class: "mac-cell-label",
      x_align: Clutter.ActorAlign.CENTER,
    });

    container.add_child(head);
    container.add_child(label);

    let cell = { container, drawing, label, icon, value: 0, suffix };

    drawing.connect("repaint", (area) => {
      let cr = area.get_context();
      let w = area.width;
      let cx = w / 2;
      let cy = area.height / 2;
      let radius = (w - ringWidth) / 2;

      cr.setSourceRGBA(1, 1, 1, 0.07);
      cr.arc(cx, cy, radius - ringWidth / 2, 0, 2 * Math.PI);
      cr.fill();

      cr.setSourceRGBA(1, 1, 1, 0.13);
      cr.setLineWidth(ringWidth);
      cr.arc(cx, cy, radius, 0, 2 * Math.PI);
      cr.stroke();

      let scaled = cell.suffix === "°C" ? (cell.value / TEMP_RING_MAX) * 100 : cell.value;
      let p = Math.max(0, Math.min(100, scaled)) / 100;
      if (p > 0) {
        let [r, g, b] = rampColor(p, this._metricStops);
        cr.setSourceRGBA(r, g, b, 1);
        cr.setLineWidth(ringWidth);
        cr.setLineCap(1);
        cr.arc(cx, cy, radius, -Math.PI / 2, -Math.PI / 2 + p * 2 * Math.PI);
        cr.stroke();
      }

      cr.$dispose();
    });

    return cell;
  }

  _setCell(name, value, displayText) {
    const c = this._cells?.[name];
    if (!c) return;
    c.value = value;
    c.label.set_text(displayText ?? `${Math.round(value)}${c.suffix}`);
    c.drawing.queue_repaint();
  }

  _tick() {
    this._tickCount++;
    this._updateCPU();
    this._updateRAM();
    this._updateDisk();
    this._updateTemp();
    this._updateGPU();
  }

  _updateCPU() {
    let [ok, out] = GLib.file_get_contents("/proc/stat");
    if (!ok) return;
    let line = out.toString().split("\n")[0];
    let v = line.trim().split(/\s+/).slice(1).map(Number);
    let idle = v[3];
    let total = v.reduce((a, b) => a + b, 0);
    let dIdle = idle - this._prevIdle;
    let dTotal = total - this._prevTotal;
    this._prevIdle = idle;
    this._prevTotal = total;
    let usage = dTotal > 0 ? 100 * (1 - dIdle / dTotal) : 0;
    this._setCell("cpu", usage);
  }

  _updateRAM() {
    let [ok, out] = GLib.file_get_contents("/proc/meminfo");
    if (!ok) return;
    let total = 0, available = 0;
    for (let line of out.toString().split("\n")) {
      if (line.startsWith("MemTotal:"))     total = parseInt(line.replace(/\D+/g, ""));
      if (line.startsWith("MemAvailable:")) available = parseInt(line.replace(/\D+/g, ""));
    }
    if (total > 0) this._setCell("ram", ((total - available) / total) * 100);
  }

  _updateDisk() {
    try {
      let info = Gio.File.new_for_path("/").query_filesystem_info(
        "filesystem::size,filesystem::used", null
      );
      let total = Number(info.get_attribute_uint64("filesystem::size"));
      let used  = Number(info.get_attribute_uint64("filesystem::used"));
      if (total > 0) this._setCell("disk", (used / total) * 100);
    } catch (e) {}
  }

  _updateTemp() {
    if (!this._tempPath) return;
    let [ok, out] = GLib.file_get_contents(this._tempPath);
    if (!ok) return;
    let mC = parseInt(out.toString().trim());
    if (isNaN(mC)) return;
    this._setCell("temp", mC / 1000);
  }

  _updateGPU() {
    if (!this._gpuBackend) return;

    if (this._gpuBackend.type === "amd") {
      let [ok, out] = GLib.file_get_contents(this._gpuBackend.path);
      if (!ok) return;
      let v = parseInt(out.toString().trim());
      if (!isNaN(v)) this._setCell("gpu", v);
      return;
    }

    // nvidia: solo 1 de cada NVIDIA_EVERY ticks (a menos que haya una consulta en curso)
    if (this._gpuPending) return;
    if (this._tickCount % NVIDIA_EVERY !== 1) return;
    this._gpuPending = true;
    try {
      let proc = Gio.Subprocess.new(
        ["nvidia-smi", "--query-gpu=utilization.gpu", "--format=csv,noheader,nounits"],
        Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_SILENCE
      );
      this._gpuCancel = new Gio.Cancellable();
      proc.communicate_utf8_async(null, this._gpuCancel, (p, res) => {
        this._gpuPending = false;
        try {
          let [, stdout] = p.communicate_utf8_finish(res);
          let v = parseInt(stdout.trim());
          if (!isNaN(v)) this._setCell("gpu", v);
        } catch (e) {}
      });
    } catch (e) {
      this._gpuPending = false;
    }
  }

  _detectGpuBackend() {
    try {
      let dir = Gio.File.new_for_path("/sys/class/drm");
      let enumr = dir.enumerate_children("standard::name", Gio.FileQueryInfoFlags.NONE, null);
      let info;
      while ((info = enumr.next_file(null)) !== null) {
        let name = info.get_name();
        if (!/^card\d+$/.test(name)) continue;
        let p = `/sys/class/drm/${name}/device/gpu_busy_percent`;
        if (GLib.file_test(p, GLib.FileTest.EXISTS)) {
          return { type: "amd", path: p };
        }
      }
    } catch (e) {}

    if (GLib.find_program_in_path("nvidia-smi")) {
      return { type: "nvidia" };
    }

    return null;
  }

  _findCpuTempPath() {
    let dir = Gio.File.new_for_path("/sys/class/thermal");
    try {
      let enumr = dir.enumerate_children("standard::name", Gio.FileQueryInfoFlags.NONE, null);
      let info, candidates = [];
      while ((info = enumr.next_file(null)) !== null) {
        let name = info.get_name();
        if (!name.startsWith("thermal_zone")) continue;
        let [ok, out] = GLib.file_get_contents(`/sys/class/thermal/${name}/type`);
        if (ok) candidates.push({ name, type: out.toString().trim() });
      }
      let pkg = candidates.find(c => c.type === "x86_pkg_temp");
      if (pkg) return `/sys/class/thermal/${pkg.name}/temp`;
      if (candidates.length > 0) return `/sys/class/thermal/${candidates[0].name}/temp`;
    } catch (e) {}
    return null;
  }
}
