# Mac Style Widgets

> Widgets flotantes estilo macOS para GNOME Shell — métricas del sistema, batería, música y clima en el fondo del escritorio.

![GNOME Shell 49–50](https://img.shields.io/badge/GNOME%20Shell-49%E2%80%9350-blue)
![License](https://img.shields.io/badge/license-MIT-green)

---

## ✨ Características

- 🖥️ **4 widgets independientes** que se activan o desactivan a voluntad
- 🎨 Estética **estilo macOS** (cards translúcidas, anillos de progreso, tipografía limpia)
- 🖱️ **Modo edición** con drag-and-drop para colocar widgets donde quieras
- 🧲 **Snap automático** a los bordes del monitor al arrastrar
- 🖥️🖥️ Soporte completo **multi-monitor** (selector + auto-detección al arrastrar)
- ⚙️ Página de **preferencias completa** con vista previa en vivo
- 🔌 **Cero dependencias externas** (todo Soup/D-Bus nativo de GNOME)
- 🌐 **Sin API keys** — clima vía Open-Meteo (10 000 req/día gratis)

---

## 📦 Widgets

### 🖥️ Métricas

Pill horizontal con anillos de progreso para:
- **CPU** — `/proc/stat`
- **RAM** — `/proc/meminfo`
- **Disco** — `Gio.File.query_filesystem_info`
- **Temperatura** — `/sys/class/thermal/*/temp` (zona `x86_pkg_temp` auto-detectada)
- **GPU** — auto-detecta NVIDIA (`nvidia-smi`) o AMD (`gpu_busy_percent` en sysfs). Si no hay GPU acelerada, oculta la celda.

Ajustable: opacidad, tamaño de cada celda (32–120 px).

### 🔋 Batería

Card vertical con anillo de progreso. Icono dinámico según nivel y estado de carga. Color: rojo <20 %, amarillo <50 %, azul ≥50 %, verde si está cargando. Si la PC no tiene batería (escritorio), el widget no se construye.

### 🎵 Música

Card con **portada del álbum** descargada y cacheada (igual patrón que [media-controls](https://github.com/sakithb/media-controls)), título y artista. Detecta automáticamente Spotify, VLC, Firefox/Chromium, Rhythmbox, etc. vía MPRIS D-Bus.

> **Nota:** los controles play/pausa/saltar **no están en el card** (estaría encima de las ventanas). Usa las teclas multimedia del teclado (`XF86AudioPlay`, etc.) o el reproductor mismo.

### 🌤️ Clima

Card con icono WMO (☀️/⛅/🌧/⛈/❄️), temperatura, condición y ciudad. Refresca cada 15 min vía [Open-Meteo](https://open-meteo.com).

- **Sin API key** ni registro
- **Geocoding por nombre de ciudad** (escribe "Quito", se resuelve a lat/lon automáticamente)
- Botón **"Probar conexión"** en prefs valida cobertura y muestra temperatura actual
- Soporta °C/°F (km/h o mph)

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
2. Los widgets pasan a estar **encima de las ventanas** con borde celeste dashed.
3. **Click + drag** sobre cualquier widget para moverlo. Se ve un badge con coordenadas en vivo.
4. A 15 px de cualquier borde del monitor → **snap** automático.
5. Si lo arrastras a otro monitor → se detecta solo y actualiza la setting.
6. Apaga el switch — los widgets vuelven al fondo en su nueva posición memorizada.

### Configuración por widget

Cada widget tiene su pestaña con:
- **Switch maestro** "Mostrar widget"
- **Apariencia**: opacidad (0–100). En métricas también tamaño de celda.
- **Posición**: switch "Centrar horizontalmente", X, Y, selector de monitor
- **Específicos**:
  - Música: nombre parcial del reproductor preferido
  - Clima: ciudad, unidades (métrico/imperial), provider info, botón Probar conexión

---

## 🛠️ Troubleshooting

| Síntoma | Causa probable | Solución |
|---|---|---|
| **Widget no aparece** después de activarlo | Wayland — necesita relogin tras recompilar el JS | Cierra sesión y vuelve a entrar |
| **Celda GPU no se ve** en Métricas | Sin NVIDIA y sin AMD `gpu_busy_percent` | Funcionamiento esperado — Intel iGPU no se mide sin root |
| **Widget batería invisible** | PC sin batería (escritorio) o sin `/sys/class/power_supply/BAT*` | Funcionamiento esperado |
| **Música muestra "Sin reproducción"** | Sin reproductor MPRIS activo | Abre Spotify/VLC y reproduce algo |
| **Música no detecta tu reproductor** preferido | Bus name distinto | Pasa el nombre parcial en prefs (ej. `chromium`, `firefox`) |
| **Clima dice "Ciudad no encontrada"** | Typo o ciudad ambigua | Prueba con país (ej. `Quito, Ecuador`) y pulsa **Probar conexión** |
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
    ├── base.js               ← lifecycle, drag-and-drop, layer chrome/fondo
    ├── metrics.js            ← CPU/RAM/Disco/Temp/GPU
    ├── battery.js            ← /sys/class/power_supply
    ├── music.js              ← MPRIS via Gio.DBusProxy + portada (Pixbuf)
    └── weather.js            ← Open-Meteo via Soup 3
```

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
- **Soup 3.0**, **Gio**, **GdkPixbuf**, **St**, **Clutter**, **Adwaita 1.4+** (todos vienen con GNOME por defecto)
- Para GPU NVIDIA: paquete `nvidia-utils` (`nvidia-smi` en `$PATH`)

---

## 📝 Licencia

MIT — ver [LICENSE](LICENSE) si se añade.

---

## 🙏 Créditos

- Patrón de descarga/cache de portadas inspirado en [sakithb/media-controls](https://github.com/sakithb/media-controls)
- API de clima: [Open-Meteo](https://open-meteo.com)
- Iconos: [Adwaita](https://gitlab.gnome.org/GNOME/adwaita-icon-theme)
