# Mac Style Widgets

> Widgets flotantes estilo macOS para GNOME Shell — reloj, métricas del sistema, batería, música, clima, pronóstico y top de procesos en el escritorio.

![GNOME Shell 49–50](https://img.shields.io/badge/GNOME%20Shell-49%E2%80%9350-blue)
![License](https://img.shields.io/badge/license-MIT-green)

---

## ✨ Características

- 🧩 **7 widgets independientes** que se activan o desactivan a voluntad
- 🎨 Estética **estilo macOS**: cards translúcidas, anillos de progreso con **rampa de color continua**, tipografía limpia
- 🌫️ **Vibrancy opcional** — blur del fondo detrás de cada widget (vidrio esmerilado)
- 🌈 **Color de acento configurable** — tiñe los anillos y el borde del modo edición
- 🖱️ **Modo edición** con drag-and-drop para colocar widgets donde quieras
- 🧲 **Snap automático** a los bordes del monitor al arrastrar
- 🖥️🖥️ Soporte completo **multi-monitor** (selector + auto-detección al arrastrar)
- ⚙️ Página de **preferencias completa** con vista previa en vivo
- 🔌 **Cero dependencias externas** (todo Soup/D-Bus nativo de GNOME)
- 🌐 **Sin API keys** — clima y pronóstico vía Open-Meteo (10 000 req/día gratis)

---

## 📦 Widgets

### 🕐 Reloj

Card con hora grande y fecha localizada. Configurable: formato **24 h / AM-PM**, mostrar **segundos**, mostrar **fecha**. 100 % local, sin dependencias. Activado por defecto.

### 🖥️ Métricas

Pill horizontal con anillos de progreso para:
- **CPU** — `/proc/stat` (icono de chip)
- **RAM** — `/proc/meminfo`
- **Disco** — `Gio.File.query_filesystem_info`
- **Temperatura** — `/sys/class/thermal/*/temp` (zona `x86_pkg_temp` auto-detectada)
- **GPU** — auto-detecta NVIDIA (`nvidia-smi`, consultado cada ~8 s) o AMD (`gpu_busy_percent` en sysfs). Si no hay GPU acelerada, oculta la celda.

Los anillos usan una **rampa continua** acento → ámbar → rojo según el valor. Ajustable: opacidad, tamaño de cada celda (32–120 px).

### 🔋 Batería

Card vertical con anillo de progreso. Icono dinámico según nivel y estado de carga. Rampa de color **rojo (vacío) → ámbar → acento (lleno)**, y **verde** al cargar. Si la PC no tiene batería (escritorio), el widget no se construye.

### 🎵 Música

Card con **portada del álbum** descargada y cacheada (caché acotada a 60 imágenes), título y artista. Detecta automáticamente Spotify, VLC, Firefox/Chromium, Rhythmbox, etc. vía MPRIS D-Bus. Cambia al reproductor preferido cuando aparece.

**Controles opcionales** (switch *"Mostrar controles"*, activado por defecto): botones **anterior / play-pausa / siguiente** con el icono reflejando el estado real. Al activarlos, el widget pasa a ser interactivo y **flota sobre las ventanas** (en pantalla completa se oculta).

### 🌤️ Clima

Card con icono WMO (☀️/⛅/🌧/⛈/❄️), temperatura, condición y ciudad. Refresca cada 15 min vía [Open-Meteo](https://open-meteo.com).

- **Sin API key** ni registro
- **Geocoding por nombre de ciudad** (escribe "Quito", se resuelve a lat/lon automáticamente)
- Botón **"Probar conexión"** en prefs valida cobertura y muestra temperatura actual
- Soporta °C/°F (km/h o mph)

### 📅 Pronóstico extendido

Fila de **3 a 7 días** (hoy + siguientes) con día, icono WMO y máx/mín. Reutiliza la **ciudad, coordenadas y unidades del widget de Clima** (sin configurar nada aparte, sin API key). Refresca cada 30 min.

### 📊 Top procesos

Los N procesos que más consumen, ordenables por **CPU** (muestreo por delta de `/proc/[pid]/stat`) o **memoria** (RSS de `/proc/[pid]/statm`). Configurable cantidad (3–6). Refresca cada 3 s.

---

## 🎨 Apariencia global

En el grupo **Global** (visible en todas las pestañas):

- **Vibrancy (vidrio esmerilado)** — aplica `Shell.BlurEffect` detrás de cada widget. Con una máscara de esquinas redondeadas (shader) para recortar el blur al contorno de la card.
- **Color de acento** — selector de color que tiñe los anillos de métricas/batería y el borde del modo edición.

> **Nota sobre vibrancy:** el blur de GNOME es rectangular por naturaleza; se aplica un shader de recorte para redondear las esquinas. Si en tu equipo el frosted no se ve como esperas, desactiva el switch — el resto del estilo (translúcido + sombra) se mantiene.

---

## 🚀 Instalación

### Opción A — Desde el `.zip` (recomendado)

```bash
# Descarga el .zip de la última release o pídeselo al autor
gnome-extensions install mac-widgets@kevin.shell-extension.zip --force

# Activa
gnome-extensions enable mac-widgets@kevin
```

En **Wayland** necesitas **cerrar sesión y volver a entrar** la primera vez.

### Opción B — Clonando el repo

```bash
git clone -b Produccion https://github.com/kvnChC/MacWitgetsStyle.git \
  ~/.local/share/gnome-shell/extensions/mac-widgets@kevin

cd ~/.local/share/gnome-shell/extensions/mac-widgets@kevin
glib-compile-schemas schemas/

gnome-extensions enable mac-widgets@kevin
```

---

## ⚙️ Uso

### Abrir preferencias

```bash
gnome-extensions prefs mac-widgets@kevin
```

O desde la app **Extensions** de GNOME (icono del engrane junto al toggle).

### Modo edición (drag & drop)

1. En cualquier pestaña de prefs, activa el switch **"Modo edición (mover widgets)"**.
2. Los widgets pasan a estar **encima de las ventanas** con borde de acento.
3. **Click + drag** sobre cualquier widget para moverlo. Se ve un badge con coordenadas en vivo.
4. A 15 px de cualquier borde del monitor → **snap** automático.
5. Si lo arrastras a otro monitor → se detecta solo y actualiza la setting.
6. Apaga el switch — los widgets vuelven al fondo en su nueva posición memorizada.

> Los botones de los controles de música **no** inician arrastre: en modo edición puedes pulsarlos sin mover la card.

### Configuración por widget

Cada widget tiene su pestaña con:
- **Switch maestro** "Mostrar widget"
- **Apariencia**: opacidad (0–100). En métricas también tamaño de celda.
- **Posición**: switch "Centrar horizontalmente", X, Y, selector de monitor
- **Específicos**:
  - Reloj: formato 24 h, segundos, fecha
  - Música: controles on/off, reproductor preferido
  - Clima: ciudad, unidades, provider info, botón Probar conexión
  - Pronóstico: número de días
  - Procesos: ordenar por CPU/memoria, cantidad de filas

---

## 🛠️ Troubleshooting

| Síntoma | Causa probable | Solución |
|---|---|---|
| **Widget no aparece** después de activarlo | Wayland — necesita relogin tras recompilar el JS | Cierra sesión y vuelve a entrar |
| **Celda GPU no se ve** en Métricas | Sin NVIDIA y sin AMD `gpu_busy_percent` | Funcionamiento esperado — Intel iGPU no se mide sin root |
| **Widget batería invisible** | PC sin batería (escritorio) o sin `/sys/class/power_supply/BAT*` | Funcionamiento esperado |
| **Música muestra "Sin reproducción"** | Sin reproductor MPRIS activo | Abre Spotify/VLC y reproduce algo |
| **Música no detecta tu reproductor** preferido | Bus name distinto | Pasa el nombre parcial en prefs (ej. `chromium`, `firefox`) |
| **Pronóstico vacío / "Sin ciudad"** | El widget de Clima nunca resolvió coordenadas | Configura la ciudad en la pestaña **Clima** y pulsa Probar conexión |
| **Clima dice "Ciudad no encontrada"** | Typo o ciudad ambigua | Prueba con país (ej. `Quito, Ecuador`) y pulsa **Probar conexión** |
| **Vibrancy se ve con borde cuadrado** | El blur de Shell es rectangular | El shader de recorte lo redondea; si falla en tu equipo, desactiva vibrancy |
| **Modo edición no encuentra los widgets** | Widget desactivado | Activa primero el switch del widget, luego edit-mode |

### Logs en vivo

```bash
journalctl --user -f -o cat | grep -iE 'mac-widgets|gnome-shell.*ERROR'
```

---

## 🏗️ Desarrollo

### Estructura

```
mac-widgets@kevin/
├── extension.js              ← orquestador (instancia widgets)
├── prefs.js                  ← UI Adwaita multi-página
├── metadata.json
├── stylesheet.css
├── schemas/
│   ├── gschemas.compiled
│   └── org.gnome.shell.extensions.mac-widgets.gschema.xml
└── widgets/
    ├── base.js               ← lifecycle, drag-and-drop, capa chrome/fondo,
    │                            superficie/tokens, vibrancy + máscara redondeada
    ├── clock.js              ← hora + fecha
    ├── metrics.js            ← CPU/RAM/Disco/Temp/GPU
    ├── battery.js            ← /sys/class/power_supply
    ├── music.js              ← MPRIS via Gio.DBusProxy + portada + controles
    ├── weather.js            ← Open-Meteo (clima actual) via Soup 3
    ├── forecast.js           ← Open-Meteo (pronóstico diario)
    ├── processes.js          ← top por CPU/memoria desde /proc
    └── wmo.js                ← códigos WMO → icono/texto (compartido)
```

`base.js` centraliza los tokens de superficie y expone helpers compartidos (`hexToRgb`, `rampColor`, `_applySurface`, vibrancy), así que añadir un widget nuevo es básicamente escribir su contenido y su `_start`/`_stop`.

### Validar antes de subir cambios

```bash
glib-compile-schemas --strict schemas/
for f in extension.js prefs.js widgets/*.js; do node --check "$f"; done
```

### Recargar tras editar JS

- **X11**: `Alt+F2` → `r` → Enter
- **Wayland**: cerrar sesión y volver

### Settings desde CLI

```bash
# Listar todas las claves de un widget
gsettings --schemadir schemas/ list-recursively org.gnome.shell.extensions.mac-widgets.weather

# Cambiar valor
gsettings --schemadir schemas/ set org.gnome.shell.extensions.mac-widgets.weather city '"Madrid"'
```

---

## 📋 Requisitos

- **GNOME Shell 49 o 50**
- **Soup 3.0**, **Gio**, **GdkPixbuf**, **St**, **Clutter**, **Shell**, **Adwaita 1.4+** (todos vienen con GNOME por defecto)
- Para GPU NVIDIA: paquete `nvidia-utils` (`nvidia-smi` en `$PATH`)
- Vibrancy usa `Shell.BlurEffect` (GNOME 46+); el selector de acento usa `Gtk.ColorDialogButton` (GTK 4.10+)

---

## 📝 Licencia

MIT — ver [LICENSE](LICENSE) si se añade.

---

## 🙏 Créditos

- Patrón de descarga/cache de portadas inspirado en [sakithb/media-controls](https://github.com/sakithb/media-controls)
- API de clima y pronóstico: [Open-Meteo](https://open-meteo.com)
- Iconos: [Adwaita](https://gitlab.gnome.org/GNOME/adwaita-icon-theme) / [Yaru](https://github.com/ubuntu/yaru)
