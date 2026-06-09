import St from "gi://St";
import Clutter from "gi://Clutter";
import Gio from "gi://Gio";
import GLib from "gi://GLib";
import GdkPixbuf from "gi://GdkPixbuf";
import Soup from "gi://Soup?version=3.0";
import { BaseWidget } from "./base.js";

const MPRIS_PREFIX = "org.mpris.MediaPlayer2.";
const MPRIS_PATH = "/org/mpris/MediaPlayer2";

const MPRIS_PLAYER_XML = `
<node>
  <interface name="org.mpris.MediaPlayer2.Player">
    <method name="Next"/>
    <method name="Previous"/>
    <method name="PlayPause"/>
    <property name="PlaybackStatus" type="s" access="read"/>
    <property name="Metadata" type="a{sv}" access="read"/>
  </interface>
</node>`;

const MprisPlayerProxy = Gio.DBusProxy.makeProxyWrapper(MPRIS_PLAYER_XML);

const COVER_SIZE = 100;
const CACHE_SUBDIR = "mac-widgets@kevin";
const CACHE_MAX_FILES = 60; // carátulas en disco antes de podar las más antiguas

// Promisify una vez (idempotente — múltiples extensiones pueden hacerlo)
Gio._promisify(GdkPixbuf.Pixbuf, "new_from_stream_async", "new_from_stream_finish");
Gio._promisify(Gio.File.prototype, "read_async", "read_finish");
Gio._promisify(Gio.File.prototype, "replace_contents_bytes_async", "replace_contents_finish");
Gio._promisify(Soup.Session.prototype, "send_and_read_async", "send_and_read_finish");

export class MusicWidget extends BaseWidget {
  constructor(extension) {
    super(extension, "org.gnome.shell.extensions.mac-widgets.music");
    this._player = null;
    this._busName = null;
    this._propsId = 0;
    this._nameSubId = 0;
    this._currentArtUrl = null;
    this._artCancellable = null;
    this._session = null;
    // Con controles, el widget debe ser interactivo (vivir sobre las ventanas).
    this._isInteractive = this._settings.get_boolean("show-controls");
  }

  _build() {
    this._surfaceRadius = 18;

    const card = new St.BoxLayout({
      style_class: "mac-card mac-card-wide",
      vertical: true,
      x_align: Clutter.ActorAlign.CENTER,
    });

    this._coverIcon = new St.Icon({
      icon_name: "audio-x-generic-symbolic",
      icon_size: COVER_SIZE,
      style_class: "mac-music-cover",
      x_align: Clutter.ActorAlign.CENTER,
    });

    this._titleLabel = new St.Label({
      text: "Sin reproducción",
      style_class: "mac-card-value mac-music-title",
      x_align: Clutter.ActorAlign.CENTER,
    });

    this._artistLabel = new St.Label({
      text: "",
      style_class: "mac-card-sub mac-music-artist",
      x_align: Clutter.ActorAlign.CENTER,
    });

    card.add_child(this._coverIcon);
    card.add_child(this._titleLabel);
    card.add_child(this._artistLabel);

    if (this._settings.get_boolean("show-controls")) {
      card.add_child(this._buildControls());
    }

    this._actor = card;
    this._applySurface();
  }

  _buildControls() {
    const bar = new St.BoxLayout({
      style_class: "mac-music-controls",
      vertical: false,
      x_align: Clutter.ActorAlign.CENTER,
    });

    this._prevBtn = this._iconButton("media-skip-backward-symbolic", () =>
      this._player?.PreviousRemote?.()
    );
    this._playBtn = this._iconButton("media-playback-start-symbolic", () =>
      this._player?.PlayPauseRemote?.()
    );
    this._nextBtn = this._iconButton("media-skip-forward-symbolic", () =>
      this._player?.NextRemote?.()
    );

    bar.add_child(this._prevBtn);
    bar.add_child(this._playBtn);
    bar.add_child(this._nextBtn);
    return bar;
  }

  _iconButton(iconName, onClick) {
    const btn = new St.Button({
      style_class: "mac-music-btn",
      child: new St.Icon({ icon_name: iconName, icon_size: 18 }),
      can_focus: true,
    });
    btn.connect("clicked", () => onClick());
    return btn;
  }

  _teardown() {
    this._coverIcon = null;
    this._titleLabel = null;
    this._artistLabel = null;
    this._prevBtn = null;
    this._playBtn = null;
    this._nextBtn = null;
  }

  _start() {
    this._session = new Soup.Session();
    this._nameSubId = Gio.DBus.session.signal_subscribe(
      "org.freedesktop.DBus",
      "org.freedesktop.DBus",
      "NameOwnerChanged",
      "/org/freedesktop/DBus",
      null,
      Gio.DBusSignalFlags.NONE,
      (_c, _s, _o, _i, _sig, params) => this._onNameOwnerChanged(params)
    );

    this._discoverPlayer();
  }

  _stop() {
    if (this._artCancellable) {
      this._artCancellable.cancel();
      this._artCancellable = null;
    }
    if (this._nameSubId) {
      Gio.DBus.session.signal_unsubscribe(this._nameSubId);
      this._nameSubId = 0;
    }
    if (this._session) {
      this._session.abort();
      this._session = null;
    }
    this._dropPlayer();
  }

  _handleSettingChange(key) {
    if (key === "opacity") this._applySurface();
    if (key === "preferred-player") {
      this._dropPlayer();
      this._discoverPlayer();
    }
    if (key === "show-controls") {
      // Cambia la interactividad → recrear el actor en la capa correcta.
      this._isInteractive = this._settings.get_boolean("show-controls");
      this._deactivate();
      this._activate();
    }
  }

  _onNameOwnerChanged(params) {
    const [name, oldOwner, newOwner] = params.deep_unpack();
    if (!name.startsWith(MPRIS_PREFIX)) return;

    if (newOwner && !oldOwner) {
      if (!this._busName) {
        this._discoverPlayer();
        return;
      }
      // Si aparece el reproductor preferido y no es el que tenemos, cambiar a él.
      const preferred = this._settings.get_string("preferred-player").toLowerCase();
      if (
        preferred &&
        name.toLowerCase().includes(preferred) &&
        !this._busName.toLowerCase().includes(preferred)
      ) {
        this._dropPlayer();
        this._discoverPlayer();
      }
    } else if (oldOwner && !newOwner) {
      if (name === this._busName) {
        this._dropPlayer();
        this._discoverPlayer();
      }
    }
  }

  _discoverPlayer() {
    Gio.DBus.session.call(
      "org.freedesktop.DBus",
      "/org/freedesktop/DBus",
      "org.freedesktop.DBus",
      "ListNames",
      null,
      new GLib.VariantType("(as)"),
      Gio.DBusCallFlags.NONE,
      -1,
      null,
      (conn, res) => {
        try {
          const reply = conn.call_finish(res);
          const [names] = reply.deep_unpack();
          const players = names.filter(n => n.startsWith(MPRIS_PREFIX));

          if (players.length === 0) {
            this._setIdle();
            return;
          }

          const preferred = this._settings.get_string("preferred-player");
          let chosen = null;
          if (preferred) {
            chosen = players.find(p => p.toLowerCase().includes(preferred.toLowerCase()));
          }
          if (!chosen) chosen = players[0];

          this._adoptPlayer(chosen);
        } catch (e) {
          console.error("[mac-widgets/music] ListNames failed:", e);
          this._setIdle();
        }
      }
    );
  }

  _adoptPlayer(busName) {
    this._busName = busName;

    MprisPlayerProxy(
      Gio.DBus.session,
      busName,
      MPRIS_PATH,
      (proxy, error) => {
        if (error) {
          console.error("[mac-widgets/music] proxy error:", error);
          this._setIdle();
          return;
        }
        if (!this._actor) return;

        this._player = proxy;
        this._propsId = proxy.connect("g-properties-changed", () => this._render());
        this._render();
      }
    );
  }

  _dropPlayer() {
    if (this._player && this._propsId) {
      try { this._player.disconnect(this._propsId); } catch (e) {}
      this._propsId = 0;
    }
    this._player = null;
    this._busName = null;
    this._currentArtUrl = null;
    this._setIdle();
  }

  _render() {
    if (!this._titleLabel || !this._player) return;

    const meta = this._player.Metadata || {};

    const title = this._unwrap(meta["xesam:title"]) || "—";
    const artistVar = this._unwrap(meta["xesam:artist"]);
    const artist = Array.isArray(artistVar) ? artistVar.join(", ") : (artistVar || "");
    const artUrl = this._unwrap(meta["mpris:artUrl"]) || null;

    this._titleLabel.set_text(this._truncate(title, 38));
    this._artistLabel.set_text(this._truncate(artist, 38));
    this._updatePlayIcon();

    if (artUrl !== this._currentArtUrl) {
      this._loadCoverArt(artUrl);
    }
  }

  _updatePlayIcon() {
    if (!this._playBtn) return;
    const playing = this._player?.PlaybackStatus === "Playing";
    this._playBtn.child.set_icon_name(
      playing ? "media-playback-pause-symbolic" : "media-playback-start-symbolic"
    );
  }

  _setIdle() {
    if (!this._titleLabel) return;
    this._titleLabel.set_text("Sin reproducción");
    this._artistLabel.set_text("");
    if (this._playBtn) {
      this._playBtn.child.set_icon_name("media-playback-start-symbolic");
    }
    this._clearCoverArt();
  }

  _clearCoverArt() {
    if (!this._coverIcon) return;
    this._coverIcon.gicon = null;
    this._coverIcon.icon_name = "audio-x-generic-symbolic";
    this._currentArtUrl = null;
  }

  async _loadCoverArt(url) {
    this._currentArtUrl = url;
    if (this._artCancellable) this._artCancellable.cancel();

    if (!url) { this._clearCoverArt(); return; }

    const cancellable = new Gio.Cancellable();
    this._artCancellable = cancellable;

    try {
      const stream = await this._getImageStream(url, cancellable);
      if (cancellable.is_cancelled() || !this._coverIcon) return;
      if (!stream) { this._clearCoverArt(); return; }

      const pixbuf = await GdkPixbuf.Pixbuf.new_from_stream_async(stream, cancellable);
      if (cancellable.is_cancelled() || !this._coverIcon) return;
      if (!pixbuf) { this._clearCoverArt(); return; }

      const [ok, buffer] = pixbuf.save_to_bufferv("png", [], []);
      if (!ok || !this._coverIcon) return;

      const bytes = GLib.Bytes.new(buffer);
      this._coverIcon.gicon = Gio.BytesIcon.new(bytes);
    } catch (e) {
      if (!cancellable.is_cancelled()) {
        console.error("[mac-widgets/music] cover art failed:", e);
        this._clearCoverArt();
      }
    } finally {
      if (this._artCancellable === cancellable) this._artCancellable = null;
    }
  }

  async _getImageStream(url, cancellable) {
    const cacheDir = GLib.build_filenamev([GLib.get_user_cache_dir(), CACHE_SUBDIR]);
    GLib.mkdir_with_parents(cacheDir, 0o755);

    const enc = new TextEncoder();
    const encoded = GLib.base64_encode(enc.encode(url));
    const cachePath = GLib.build_filenamev([cacheDir, encoded]);
    const cacheFile = Gio.File.new_for_path(cachePath);

    if (cacheFile.query_exists(null)) {
      return await cacheFile.read_async(GLib.PRIORITY_DEFAULT, cancellable);
    }

    const uri = GLib.Uri.parse(url, GLib.UriFlags.NONE);
    if (!uri) return null;
    const scheme = uri.get_scheme();

    if (scheme === "file") {
      const file = Gio.File.new_for_uri(url);
      if (!file.query_exists(null)) return null;
      return await file.read_async(GLib.PRIORITY_DEFAULT, cancellable);
    }

    if (scheme === "http" || scheme === "https") {
      if (!this._session) return null;
      const msg = Soup.Message.new("GET", url);
      const bytes = await this._session.send_and_read_async(msg, GLib.PRIORITY_DEFAULT, cancellable);
      if (!bytes) return null;
      if (msg.get_status() !== Soup.Status.OK) return null;

      await cacheFile.replace_contents_bytes_async(
        bytes, null, false, Gio.FileCreateFlags.NONE, cancellable
      );
      this._pruneCache(cacheDir);
      return await cacheFile.read_async(GLib.PRIORITY_DEFAULT, cancellable);
    }

    return null;
  }

  // Mantiene la caché acotada: borra las carátulas más antiguas si se excede el tope.
  _pruneCache(cacheDir) {
    try {
      const dir = Gio.File.new_for_path(cacheDir);
      const enumr = dir.enumerate_children(
        "standard::name,time::modified",
        Gio.FileQueryInfoFlags.NONE,
        null
      );
      const files = [];
      let info;
      while ((info = enumr.next_file(null)) !== null) {
        files.push({
          name: info.get_name(),
          mtime: info.get_attribute_uint64("time::modified"),
        });
      }
      if (files.length <= CACHE_MAX_FILES) return;
      files.sort((a, b) => a.mtime - b.mtime); // más antiguos primero
      for (const f of files.slice(0, files.length - CACHE_MAX_FILES)) {
        try {
          Gio.File.new_for_path(GLib.build_filenamev([cacheDir, f.name])).delete(null);
        } catch (e) {}
      }
    } catch (e) {}
  }

  _unwrap(v) {
    if (v === undefined || v === null) return null;
    return typeof v.deep_unpack === "function" ? v.deep_unpack() : v;
  }

  _truncate(s, n) {
    if (!s) return "";
    return s.length > n ? s.slice(0, n - 1) + "…" : s;
  }
}
