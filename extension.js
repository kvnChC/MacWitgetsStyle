import { Extension } from "resource:///org/gnome/shell/extensions/extension.js";
import { MetricsWidget } from "./widgets/metrics.js";
import { BatteryWidget } from "./widgets/battery.js";
import { MusicWidget } from "./widgets/music.js";
import { WeatherWidget } from "./widgets/weather.js";
import { ClockWidget } from "./widgets/clock.js";
import { ForecastWidget } from "./widgets/forecast.js";
import { ProcessesWidget } from "./widgets/processes.js";

export default class MacWidgetsExtension extends Extension {
  enable() {
    this._widgets = [
      new ClockWidget(this),
      new MetricsWidget(this),
      new BatteryWidget(this),
      new MusicWidget(this),
      new WeatherWidget(this),
      new ForecastWidget(this),
      new ProcessesWidget(this),
    ];
    for (const w of this._widgets) w.enable();
  }

  disable() {
    if (this._widgets) {
      for (const w of this._widgets) {
        try { w.disable(); } catch (e) { console.error(e); }
      }
      this._widgets = null;
    }
  }
}
