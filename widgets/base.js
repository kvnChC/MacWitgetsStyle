import * as Main from "resource:///org/gnome/shell/ui/main.js";
import Clutter from "gi://Clutter";
import St from "gi://St";
import Shell from "gi://Shell";

const SNAP_DISTANCE = 15; // px para snap a bordes del monitor

// Máscara de esquinas redondeadas: recorta el resultado del blur (rectangular)
// a un rectángulo redondeado, eliminando el "halo cuadrado". Se aplica como
// efecto MÁS EXTERNO, envolviendo al BlurEffect.
const ROUNDED_MASK_GLSL = `
uniform sampler2D tex;
uniform float tex_width;
uniform float tex_height;
uniform float radius;
void main() {
  vec2 size = vec2(tex_width, tex_height);
  vec4 color = texture2D(tex, cogl_tex_coord_in[0].st);
  vec2 pos = cogl_tex_coord_in[0].st * size;
  vec2 d = min(pos, size - pos);          // distancia a los bordes más cercanos
  vec2 c = vec2(radius) - d;              // dentro de la zona de esquina si > 0
  if (c.x > 0.0 && c.y > 0.0) {
    float dist = length(c);
    float a = clamp(radius - dist + 0.5, 0.0, 1.0); // borde antialias ~1px
    color *= a;                                     // alpha premultiplicado
  }
  cogl_color_out = color;
}
`;

// ─── Tokens de superficie compartidos (un solo lugar) ───────────────
const SURFACE = {
  rgb: "40, 42, 50",                              // material charcoal, leve tinte frío
  border: "1px solid rgba(255, 255, 255, 0.16)",  // borde de definición
  shadow: "0 12px 32px rgba(0, 0, 0, 0.45)",      // sombra para "flotar"
};

// Paletas de la rampa continua de los anillos (macOS system colors)
export const RAMP_AMBER = [0.94, 0.70, 0.16]; // #f0b329
export const RAMP_RED   = [1.00, 0.27, 0.23]; // #ff453a
export const RAMP_GREEN = [0.19, 0.82, 0.35]; // #30d158

export function hexToRgb(hex) {
  const n = parseInt(String(hex).replace("#", ""), 16);
  if (isNaN(n)) return [0.35, 0.78, 0.98]; // fallback: azure macOS
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

// Interpola un color a lo largo de paradas [[pos0..1, [r,g,b]], ...] ordenadas.
export function rampColor(t, stops) {
  t = Math.max(0, Math.min(1, t));
  for (let i = 1; i < stops.length; i++) {
    const [p0, c0] = stops[i - 1];
    const [p1, c1] = stops[i];
    if (t <= p1) {
      const f = (t - p0) / (p1 - p0 || 1);
      return [0, 1, 2].map(k => c0[k] + (c1[k] - c0[k]) * f);
    }
  }
  return stops[stops.length - 1][1];
}

export class BaseWidget {
  constructor(extension, schemaId) {
    this._ext = extension;
    this._settings = extension.getSettings(schemaId);
    this._rootSettings = extension.getSettings();
    this._actor = null;
    this._addedAsChrome = false;
    this._surfaceRadius = 18; // las subclases lo ajustan en _build

    this._enabledId = 0;
    this._editModeId = 0;
    this._vibrancyId = 0;
    this._accentId = 0;
    this._monitorsId = 0;
    this._settingsId = 0;
    this._sizeSignal = 0;

    this._isInteractive = false; // override en subclase si necesita clics permanentes

    this._dragHandlerIds = [];
    this._dragMotionId = 0;
    this._dragReleaseId = 0;
    this._dragging = false;
    this._dragOffset = null;
    this._coordsBadge = null;
  }

  enable() {
    this._enabledId = this._settings.connect("changed::enabled", () => this._sync());
    this._editModeId = this._rootSettings.connect("changed::edit-mode", () => this._reapplyLayer());
    // accent-color: rebuild para que anillos y borde de edición lo relean
    this._accentId = this._rootSettings.connect("changed::accent-color", () => this._reapplyLayer());
    // vibrancy: basta con añadir/quitar el efecto, sin reconstruir
    this._vibrancyId = this._rootSettings.connect("changed::vibrancy", () => this._applyVibrancy());
    this._sync();
  }

  disable() {
    if (this._enabledId) { this._settings.disconnect(this._enabledId); this._enabledId = 0; }
    if (this._editModeId) { this._rootSettings.disconnect(this._editModeId); this._editModeId = 0; }
    if (this._accentId) { this._rootSettings.disconnect(this._accentId); this._accentId = 0; }
    if (this._vibrancyId) { this._rootSettings.disconnect(this._vibrancyId); this._vibrancyId = 0; }
    this._deactivate();
  }

  _sync() {
    const want = this._settings.get_boolean("enabled");
    if (want && !this._actor) this._activate();
    else if (!want && this._actor) this._deactivate();
  }

  _reapplyLayer() {
    if (!this._actor) return;
    this._deactivate();
    this._activate();
  }

  _activate() {
    this._build();
    if (!this._actor) return;

    const editMode = this._rootSettings.get_boolean("edit-mode");
    const useChrome = editMode || this._isInteractive;
    this._addedAsChrome = useChrome; // recordar CÓMO se añadió, no el edit-mode actual

    if (useChrome) {
      Main.layoutManager.addChrome(this._actor, { trackFullscreen: true });
      if (editMode) this._enableDrag(); // el borde de acento lo pinta _applySurface
    } else {
      Main.layoutManager._backgroundGroup.add_child(this._actor);
      this._actor.set_reactive(false);
    }

    this._applyVibrancy();

    this._monitorsId = Main.layoutManager.connect("monitors-changed", () => this.applyPosition());
    this._settingsId = this._settings.connect("changed", (_s, key) => this._onChange(key));
    this._sizeSignal = this._actor.connect("notify::width", () => this.applyPosition());

    this.applyPosition();
    this._start();
  }

  _deactivate() {
    if (!this._actor) return;
    this._stop();
    this._endDrag();
    this._disableDrag();

    if (this._monitorsId) { Main.layoutManager.disconnect(this._monitorsId); this._monitorsId = 0; }
    if (this._settingsId) { this._settings.disconnect(this._settingsId); this._settingsId = 0; }
    if (this._sizeSignal) {
      try { this._actor.disconnect(this._sizeSignal); } catch (e) {}
      this._sizeSignal = 0;
    }

    this._teardown();

    // Quitar exactamente del mismo sitio donde se añadió en _activate
    if (this._addedAsChrome) {
      try { Main.layoutManager.removeChrome(this._actor); } catch (e) {}
    }

    this._actor.destroy();
    this._actor = null;
  }

  _onChange(key) {
    if (key === "enabled" || key === "edit-mode") return;
    if (["monitor", "position-x", "position-y", "center-horizontally"].includes(key)) {
      this.applyPosition();
    } else {
      this._handleSettingChange?.(key);
    }
  }

  applyPosition() {
    if (!this._actor || this._dragging) return;
    const mon = this._getTargetMonitor();
    if (!mon) return;

    const y = this._settings.get_int("position-y");
    let x;
    if (this._settings.get_boolean("center-horizontally")) {
      const w = this._actor.width || 200;
      x = mon.x + Math.round((mon.width - w) / 2);
    } else {
      x = mon.x + this._settings.get_int("position-x");
    }
    this._actor.set_position(x, mon.y + y);
    this._updateMaskUniforms(); // el tamaño pudo cambiar (notify::width)
  }

  _getTargetMonitor() {
    const idx = this._settings.get_int("monitor");
    const monitors = Main.layoutManager.monitors;
    if (idx >= 0 && idx < monitors.length) return monitors[idx];
    return Main.layoutManager.primaryMonitor;
  }

  // ─── Drag & drop (solo en edit mode) ──────────────────────────────

  _enableDrag() {
    if (!this._actor) return;
    this._actor.set_reactive(true);

    const id = this._actor.connect("button-press-event", (actor, event) => {
      if (event.get_button() !== 1) return Clutter.EVENT_PROPAGATE;
      // Si el clic cae sobre un control (botón), que lo maneje él, no arrastrar.
      if (this._isControl(event.get_source())) return Clutter.EVENT_PROPAGATE;

      const [stageX, stageY] = event.get_coords();
      const [actorX, actorY] = actor.get_position();
      this._dragOffset = [stageX - actorX, stageY - actorY];
      this._dragging = true;

      this._showCoordsBadge();

      this._dragMotionId = global.stage.connect(
        "motion-event", (_s, ev) => this._onDragMotion(ev)
      );
      this._dragReleaseId = global.stage.connect(
        "button-release-event", (_s, ev) => this._onDragRelease(ev)
      );

      return Clutter.EVENT_STOP;
    });
    this._dragHandlerIds.push(id);
  }

  _disableDrag() {
    for (const id of this._dragHandlerIds) {
      try { this._actor.disconnect(id); } catch (e) {}
    }
    this._dragHandlerIds = [];
  }

  // ¿El actor (origen del evento) es un control clicable dentro del widget?
  _isControl(actor) {
    let a = actor;
    while (a && a !== this._actor) {
      if (a instanceof St.Button) return true;
      a = a.get_parent();
    }
    return false;
  }

  _onDragMotion(event) {
    if (!this._dragging || !this._actor) return Clutter.EVENT_PROPAGATE;
    const [stageX, stageY] = event.get_coords();
    let x = stageX - this._dragOffset[0];
    let y = stageY - this._dragOffset[1];

    // Snap a los bordes del monitor donde está el centro del actor
    const monitors = Main.layoutManager.monitors;
    const cx = x + this._actor.width / 2;
    const cy = y + this._actor.height / 2;
    let mon = monitors.find(m => cx >= m.x && cx < m.x + m.width && cy >= m.y && cy < m.y + m.height);
    if (!mon) mon = Main.layoutManager.primaryMonitor;
    if (mon) {
      const w = this._actor.width;
      const h = this._actor.height;
      if (Math.abs(x - mon.x) < SNAP_DISTANCE) x = mon.x;
      if (Math.abs(y - mon.y) < SNAP_DISTANCE) y = mon.y;
      if (Math.abs((x + w) - (mon.x + mon.width)) < SNAP_DISTANCE) x = mon.x + mon.width - w;
      if (Math.abs((y + h) - (mon.y + mon.height)) < SNAP_DISTANCE) y = mon.y + mon.height - h;
    }

    this._actor.set_position(x, y);
    this._updateCoordsBadge(x, y);
    return Clutter.EVENT_STOP;
  }

  _onDragRelease(event) {
    if (!this._dragging) return Clutter.EVENT_PROPAGATE;

    const [absX, absY] = this._actor.get_position();

    // ¿En qué monitor cayó?
    const cx = absX + this._actor.width / 2;
    const cy = absY + this._actor.height / 2;
    const monitors = Main.layoutManager.monitors;
    let chosenIdx = -1;
    for (let i = 0; i < monitors.length; i++) {
      const m = monitors[i];
      if (cx >= m.x && cx < m.x + m.width && cy >= m.y && cy < m.y + m.height) {
        chosenIdx = i;
        break;
      }
    }

    const monRect = chosenIdx >= 0 ? monitors[chosenIdx] : Main.layoutManager.primaryMonitor;
    if (monRect) {
      this._settings.set_int("monitor", chosenIdx);
      this._settings.set_boolean("center-horizontally", false);
      this._settings.set_int("position-x", Math.max(0, Math.round(absX - monRect.x)));
      this._settings.set_int("position-y", Math.max(0, Math.round(absY - monRect.y)));
    }

    this._endDrag();
    return Clutter.EVENT_STOP;
  }

  _endDrag() {
    this._dragging = false;
    this._dragOffset = null;
    if (this._dragMotionId) { global.stage.disconnect(this._dragMotionId); this._dragMotionId = 0; }
    if (this._dragReleaseId) { global.stage.disconnect(this._dragReleaseId); this._dragReleaseId = 0; }
    this._hideCoordsBadge();
  }

  _showCoordsBadge() {
    if (this._coordsBadge) return;
    this._coordsBadge = new St.Label({
      text: "",
      style_class: "mac-drag-coords",
    });
    Main.layoutManager.addChrome(this._coordsBadge);
    if (this._actor) {
      const [x, y] = this._actor.get_position();
      this._updateCoordsBadge(x, y);
    }
  }

  _updateCoordsBadge(x, y) {
    if (!this._coordsBadge) return;
    const mon = this._getTargetMonitor();
    const dx = mon ? Math.round(x - mon.x) : Math.round(x);
    const dy = mon ? Math.round(y - mon.y) : Math.round(y);
    this._coordsBadge.set_text(`x: ${dx}   y: ${dy}`);
    this._coordsBadge.set_position(x + 6, Math.max(0, y - 30));
  }

  _hideCoordsBadge() {
    if (!this._coordsBadge) return;
    try { Main.layoutManager.removeChrome(this._coordsBadge); } catch (e) {}
    this._coordsBadge.destroy();
    this._coordsBadge = null;
  }

  // ─── Superficie / acento / vibrancy ───────────────────────────────

  _accentRgb() {
    return hexToRgb(this._rootSettings.get_string("accent-color"));
  }

  _accentCss(alpha) {
    const [r, g, b] = this._accentRgb();
    return `rgba(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)}, ${alpha})`;
  }

  // Estilo de superficie unificado: fondo + borde + radio + sombra.
  // En modo edición el borde y la sombra usan el color de acento.
  _applySurface() {
    if (!this._actor) return;
    const alpha = this._settings.get_int("opacity") / 100;
    const editMode = this._rootSettings.get_boolean("edit-mode");
    const border = editMode ? `2px solid ${this._accentCss(0.9)}` : SURFACE.border;
    const shadow = editMode ? `0 0 20px ${this._accentCss(0.5)}` : SURFACE.shadow;
    this._actor.set_style(
      `background-color: rgba(${SURFACE.rgb}, ${alpha}); ` +
      `border: ${border}; ` +
      `border-radius: ${this._surfaceRadius}px; ` +
      `box-shadow: ${shadow};`
    );
  }

  _makeBlur() {
    // El nombre de la propiedad de radio cambió entre versiones de Shell.
    for (const props of [
      { radius: 24, brightness: 0.62, mode: Shell.BlurMode.BACKGROUND },
      { sigma: 12, brightness: 0.62, mode: Shell.BlurMode.BACKGROUND },
    ]) {
      try { return new Shell.BlurEffect(props); } catch (e) {}
    }
    return null;
  }

  _makeCornerMask() {
    try {
      const fx = new Clutter.ShaderEffect({ shader_type: Clutter.ShaderType.FRAGMENT_SHADER });
      fx.set_shader_source(ROUNDED_MASK_GLSL);
      fx.set_uniform_value("tex", 0);
      fx.set_uniform_value("radius", this._surfaceRadius);
      return fx;
    } catch (e) {
      return null;
    }
  }

  _applyVibrancy() {
    if (!this._actor) return;
    const want = this._rootSettings.get_boolean("vibrancy");
    const has = !!this._actor.get_effect("vibrancy");

    if (want && !has) {
      // Orden importa: la máscara se añade PRIMERO → es el efecto más externo
      // y recorta el resultado ya difuminado. El blur va dentro.
      const mask = this._makeCornerMask();
      if (mask) this._actor.add_effect_with_name("vibrancy-mask", mask);
      const blur = this._makeBlur();
      if (blur) this._actor.add_effect_with_name("vibrancy", blur);
      this._updateMaskUniforms();
    } else if (!want && has) {
      this._actor.remove_effect_by_name("vibrancy");
      if (this._actor.get_effect("vibrancy-mask")) {
        this._actor.remove_effect_by_name("vibrancy-mask");
      }
    }
  }

  _updateMaskUniforms() {
    if (!this._actor) return;
    const mask = this._actor.get_effect("vibrancy-mask");
    if (!mask) return;
    const [w, h] = this._actor.get_size();
    if (w <= 0 || h <= 0) return;
    mask.set_uniform_value("tex_width", w);
    mask.set_uniform_value("tex_height", h);
    mask.set_uniform_value("radius", this._surfaceRadius);
    this._actor.queue_redraw();
  }

  // hooks para subclases
  _build() {}
  _teardown() {}
  _start() {}
  _stop() {}
}
