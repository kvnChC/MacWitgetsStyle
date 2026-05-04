import * as Main from "resource:///org/gnome/shell/ui/main.js";
import Clutter from "gi://Clutter";
import St from "gi://St";

const SNAP_DISTANCE = 15; // px para snap a bordes del monitor

export class BaseWidget {
  constructor(extension, schemaId) {
    this._ext = extension;
    this._settings = extension.getSettings(schemaId);
    this._rootSettings = extension.getSettings();
    this._actor = null;

    this._enabledId = 0;
    this._editModeId = 0;
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
    this._sync();
  }

  disable() {
    if (this._enabledId) { this._settings.disconnect(this._enabledId); this._enabledId = 0; }
    if (this._editModeId) { this._rootSettings.disconnect(this._editModeId); this._editModeId = 0; }
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

    if (useChrome) {
      Main.layoutManager.addChrome(this._actor, { trackFullscreen: true });
      if (editMode) {
        this._actor.add_style_class_name("mac-edit-mode");
        this._enableDrag();
      }
    } else {
      Main.layoutManager._backgroundGroup.add_child(this._actor);
      this._actor.set_reactive(false);
    }

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

    const editMode = this._rootSettings.get_boolean("edit-mode");
    const wasChrome = editMode || this._isInteractive;
    if (wasChrome) {
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

  // hooks para subclases
  _build() {}
  _teardown() {}
  _start() {}
  _stop() {}
}
