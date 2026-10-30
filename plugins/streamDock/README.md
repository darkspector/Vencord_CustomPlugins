# StreamDock

A [Vencord](https://vencord.dev) plugin that docks a stream into your chat so you can watch and type at the same time.

When you're watching a stream and switch to a text channel or DM, Discord shrinks the stream into a small floating popout. StreamDock pins that popout to the top or bottom of the chat area and moves the messages and text box out of its way.

Install it with the installer in the [main README](../../README.md).

## Using it

Click **Watch** on someone's stream. Instead of opening the full-screen call view, Discord stays on the text channel you were in and the stream docks into the chat. Switching channels keeps it docked.

The stream fills the chat's width at its own shape (usually 16:9), so there's no wasted space above or below it. On a narrow or short window it's capped at a maximum height and gets black bars at the sides.

Hover over the stream to show its toolbar in the top-right corner:

- **Move to bottom** / **Move to top** moves the stream to the other end of the chat. At the bottom, the stream sits below the text box, so it never covers where you type.
- **Undock** / **Dock to chat** switches between the docked view and Discord's normal floating popout.

## Settings

Open **User Settings → Vencord → Plugins**, find **★ StreamDock** at the top of the list, and click the cog icon.

- **Auto dock**: dock the stream automatically when the popout appears. On by default.
- **Stay in chat**: stay in your text channel when you start watching a stream, instead of opening the full call view. On by default.
- **Position**: top or bottom of the chat. The Move button changes this too, and it's remembered.
- **Max height**: the most of the chat height the stream can take, from 30% to 90%. Default is 70%.
