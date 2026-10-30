# Vencord Custom Plugins

Custom [Vencord](https://vencord.dev) plugins, shipped together in one pre-built Vencord.

| Plugin | What it does |
| --- | --- |
| [ChannelConnectSound](plugins/channelConnectSound/README.md) | Plays a server soundboard sound when you join a voice channel. |
| [StreamDock](plugins/streamDock/README.md) | Docks a stream across the top or bottom of the window so you can watch and type at the same time. |

## Install

1. Download **vencord_install.bat** from the [latest release](https://github.com/darkspector/Vencord_CustomPlugins/releases/latest).
2. Double-click it and press a key when prompted.

The installer downloads a pre-built Vencord with all the plugins included, restarts Discord so any pending Discord update is applied, then patches Discord if needed. No Node.js or build tools required.

Run it again any time to pick up new plugin builds, or after a Discord update removes Vencord.

After installing, enable the plugins you want in **User Settings → Vencord → Plugins**. They have a ★ in front of their names, so they sort to the top of the list.

## Adding a plugin

Create a folder under `plugins/` with an `index.ts` or `index.tsx`. Every push to `main` builds Vencord with all the plugins in `plugins/` and publishes it to the `latest` release.
