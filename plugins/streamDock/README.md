# StreamDock

A [Vencord](https://vencord.dev) plugin that docks a stream into your chat so you can watch and type at the same time.

When you're watching a stream and switch to a text channel or DM, Discord shrinks the stream into a small floating popout. StreamDock pins that popout to the top or bottom of the chat area and moves the messages and text box out of its way.

Install it with the installer in the [main README](../../README.md).

## Using it

1. Watch a stream in a voice channel.
2. Switch to any text channel or DM. The stream docks into the chat.

Hover over the stream to show its buttons:

- **Undock** / **Dock to chat** switches between the docked view and Discord's normal floating popout.
- **↓ Move to bottom** / **↑ Move to top** moves the stream to the other end of the chat. At the bottom, the stream sits below the text box, so it never covers where you type.

## Settings

Open **User Settings → Vencord → Plugins**, find **★ StreamDock** at the top of the list, and click the cog icon.

- **Auto dock**: dock the stream automatically when the popout appears. On by default.
- **Position**: top or bottom of the chat. The Move button changes this too, and it's remembered.
- **Ratio**: how much of the chat height the stream takes, from 20% to 80%. Default is 50%.
