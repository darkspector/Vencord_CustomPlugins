# StreamDock

A [Vencord](https://vencord.dev) plugin that docks a stream across the top or bottom of the Discord window so you can watch and type at the same time.

When you're watching a stream and switch to a text channel or DM, Discord shrinks the stream into a small floating popout. StreamDock stretches that popout across the full width of the window, at the top or bottom, and shrinks the rest of Discord (servers, channels, chat, member list) to fit around it.

Install it with the installer in the [main README](../../README.md).

## Using it

Click **Watch** on someone's stream. Instead of opening the full-screen call view, Discord stays on the text channel you were in and the stream docks right away. Switching channels keeps it docked.

The stream fills the window's width at its own shape (usually 16:9), so there's no wasted space above or below it. On a narrow or short window it's capped at a maximum height and gets black bars at the sides.

Hover over the stream to show its toolbar in the top-right corner:

- **Move to bottom** / **Move to top** moves the stream to the other end of the window. Discord moves out of the way either way, so it never covers anything.
- **Undock** / **Dock** switches between the docked view and Discord's normal floating popout.

## Settings

Open **User Settings → Vencord → Plugins**, find **★ StreamDock** at the top of the list, and click the cog icon.

- **Auto dock**: dock the stream automatically when the popout appears. On by default.
- **Stay in chat**: stay in your text channel when you start watching a stream, instead of opening the full call view. On by default.
- **Position**: top or bottom of the window. The Move button changes this too, and it's remembered.
- **Max height**: the most of the window height the stream can take, from 30% to 90%. Default is 70%.
