import St from "gi://St";
import Clutter from "gi://Clutter";
import GLib from "gi://GLib";
import { BaseWidget } from "./base.js";

const POLL_SECONDS = 3;
const PAGE_SIZE = 4096; // bytes por página (típico en x86_64)

export class ProcessesWidget extends BaseWidget {
  constructor(extension) {
    super(extension, "org.gnome.shell.extensions.mac-widgets.processes");
    this._prevJiffies = new Map(); // pid -> utime+stime
    this._prevTotal = 0;
  }

  _build() {
    this._surfaceRadius = 18;

    const card = new St.BoxLayout({
      style_class: "mac-card mac-procs",
      vertical: true,
      x_align: Clutter.ActorAlign.FILL,
    });

    this._header = new St.Label({
      text: "",
      style_class: "mac-card-sub mac-procs-header",
    });

    this._rowsBox = new St.BoxLayout({
      style_class: "mac-procs-rows",
      vertical: true,
      x_expand: true,
    });

    card.add_child(this._header);
    card.add_child(this._rowsBox);

    this._actor = card;
    this._applySurface();
  }

  _teardown() {
    this._header = null;
    this._rowsBox = null;
  }

  _start() {
    this._sampleCpu(); // línea base para el primer delta
    this._tick();
    this._timeout = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, POLL_SECONDS, () => {
      this._tick();
      return GLib.SOURCE_CONTINUE;
    });
  }

  _stop() {
    if (this._timeout) { GLib.source_remove(this._timeout); this._timeout = null; }
  }

  _handleSettingChange(key) {
    if (key === "opacity") this._applySurface();
    else this._tick(); // sort-by, count
  }

  _tick() {
    if (!this._rowsBox) return;
    const mode = this._settings.get_string("sort-by");
    const count = this._settings.get_int("count");

    this._header.set_text(mode === "memory" ? "Memoria" : "CPU");

    const list = mode === "memory" ? this._topByMemory(count) : this._topByCpu(count);
    this._rowsBox.destroy_all_children();

    if (list.length === 0) {
      this._rowsBox.add_child(new St.Label({ text: "…", style_class: "mac-card-sub" }));
      return;
    }

    for (const p of list) {
      const row = new St.BoxLayout({ vertical: false, x_expand: true });
      const name = new St.Label({
        text: this._truncate(p.name, 14),
        style_class: "mac-procs-name",
        x_expand: true,
        x_align: Clutter.ActorAlign.START,
      });
      const value = new St.Label({
        text: p.text,
        style_class: "mac-procs-value",
        x_align: Clutter.ActorAlign.END,
      });
      row.add_child(name);
      row.add_child(value);
      this._rowsBox.add_child(row);
    }
  }

  // ─── CPU ──────────────────────────────────────────────────────────

  _readTotalJiffies() {
    const [ok, out] = GLib.file_get_contents("/proc/stat");
    if (!ok) return 0;
    const line = out.toString().split("\n")[0];
    return line.trim().split(/\s+/).slice(1).map(Number).reduce((a, b) => a + b, 0);
  }

  // Lee todos los procesos y devuelve {pid, name, jiffies}
  _readProcs() {
    const procs = [];
    let dir;
    try { dir = GLib.Dir.open("/proc", 0); } catch (e) { return procs; }
    let entry;
    while ((entry = dir.read_name()) !== null) {
      if (!/^\d+$/.test(entry)) continue;
      const [ok, out] = GLib.file_get_contents(`/proc/${entry}/stat`);
      if (!ok) continue;
      const s = out.toString();
      const open = s.indexOf("(");
      const close = s.lastIndexOf(")");
      if (open < 0 || close < 0) continue;
      const name = s.slice(open + 1, close);
      const rest = s.slice(close + 2).trim().split(/\s+/);
      // campos tras comm: [0]=state, … utime=field14→idx11, stime=field15→idx12
      const utime = Number(rest[11]);
      const stime = Number(rest[12]);
      if (isNaN(utime) || isNaN(stime)) continue;
      procs.push({ pid: entry, name, jiffies: utime + stime });
    }
    dir.close();
    return procs;
  }

  _sampleCpu() {
    this._prevTotal = this._readTotalJiffies();
    this._prevJiffies = new Map();
    for (const p of this._readProcs()) this._prevJiffies.set(p.pid, p.jiffies);
  }

  _topByCpu(count) {
    const total = this._readTotalJiffies();
    const dTotal = total - this._prevTotal;
    const procs = this._readProcs();

    const scored = [];
    for (const p of procs) {
      const prev = this._prevJiffies.get(p.pid);
      if (prev !== undefined && dTotal > 0) {
        const pct = (100 * (p.jiffies - prev)) / dTotal;
        if (pct > 0.05) scored.push({ name: p.name, pct });
      }
    }

    // Guardar muestra para el próximo delta
    this._prevTotal = total;
    this._prevJiffies = new Map(procs.map((p) => [p.pid, p.jiffies]));

    scored.sort((a, b) => b.pct - a.pct);
    return scored.slice(0, count).map((p) => ({
      name: p.name,
      text: `${p.pct.toFixed(1)}%`,
    }));
  }

  // ─── Memoria ──────────────────────────────────────────────────────

  _topByMemory(count) {
    const scored = [];
    let dir;
    try { dir = GLib.Dir.open("/proc", 0); } catch (e) { return []; }
    let entry;
    while ((entry = dir.read_name()) !== null) {
      if (!/^\d+$/.test(entry)) continue;
      const [okC, comm] = GLib.file_get_contents(`/proc/${entry}/comm`);
      const [okS, statm] = GLib.file_get_contents(`/proc/${entry}/statm`);
      if (!okC || !okS) continue;
      const resident = Number(statm.toString().trim().split(/\s+/)[1]);
      if (isNaN(resident)) continue;
      scored.push({
        name: comm.toString().trim(),
        bytes: resident * PAGE_SIZE,
      });
    }
    dir.close();

    scored.sort((a, b) => b.bytes - a.bytes);
    return scored.slice(0, count).map((p) => ({
      name: p.name,
      text: this._humanBytes(p.bytes),
    }));
  }

  _humanBytes(b) {
    if (b >= 1024 ** 3) return `${(b / 1024 ** 3).toFixed(1)} GB`;
    return `${Math.round(b / 1024 ** 2)} MB`;
  }

  _truncate(s, n) {
    if (!s) return "";
    return s.length > n ? s.slice(0, n - 1) + "…" : s;
  }
}
