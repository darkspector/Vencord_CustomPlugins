# StreamDock

A [Vencord](https://vencord.dev) plugin that docks a stream across the top or bottom of the Discord window so you can watch and type at the same time.

When you're watching a stream and switch to a text channel or DM, Discord shrinks the stream into a small floating popout. StreamDock stretches that popout across the full width of the window, at the top or bottom, and shrinks the rest of Discord (servers, channels, chat, member list) to fit around it.

Install it with the installer in the [main README](../../README.md).

## Using it

Click **Watch** on someone's stream. Instead of opening the full-screen call view, Discord stays on the text channel you were in and the stream docks right away. Switching channels keeps it docked. To start in the full view or the mini player instead, change **Start Streams In**.

The stream fills the window's width at its own shape (usually 16:9), so there's no wasted space above or below it. It never takes more than half the window height; past that it gets black bars at the sides.

To change the size, drag the edge of the stream that faces the rest of Discord (a handle appears when you hover). You can make it smaller, or bigger up to half the window or the stream's full height, whichever is shorter, so you never get black bars above and below it. The size is remembered. Double-click the handle to go back to fitting the stream's shape.

Hover over the stream to show its buttons. They sit next to Discord's own Full Screen / Pop Out buttons when the stream has them, otherwise in a toolbar in the top-right corner:

- **Move to bottom** / **Move to top** moves the stream to the other end of the window. Discord moves out of the way either way, so it never covers anything.
- **Full view** (↕ arrows) switches to Discord's full-screen call view of the stream. While you're there, a **Dock stream** button next to Discord's Full Screen and Pop Out buttons takes you back to your text channel with the stream docked.
- **Undock to mini player** / **Dock** switches between the docked view and Discord's normal floating popout.

## Settings

Open **User Settings → Vencord → Plugins**, find **★ StreamDock** at the top of the list, and click the cog icon.

- **Start Streams In**: how a stream opens when you click Watch.
  - **Docked** (default): stay in your text channel with the stream docked.
  - **Full view**: Discord's full call view. Leaving it docks the stream.
  - **Mini player**: stay in your text channel with Discord's floating player. Leaving the full view also goes to the mini player.

  The buttons on the stream switch between all three at any time.
- **Position**: top or bottom of the window. The Move button changes this too, and it's remembered.
