# Visualink

Save links as clean visual cards (cover, title, description and tags) right inside Obsidian. Inspired by [Brace](https://brace.to).

Available in English and Spanish (Latin America). It follows Obsidian's language, or pick one from the ⚙ menu.

## Why Visualink

Dozens of open tabs can bring any laptop to a crawl, and not every link deserves a full note. Clippers like [Obsidian Web Clipper](https://obsidian.md/clipper) are great when you want to keep an article's content. Sometimes, though, you just want to save a page for later.

Visualink sits in between. Close the tab and keep the link as a light card with its cover, title and description, ready when you come back to it. No full-page copies filling up your vault, and nothing slowing down your browser.

## Features

- Paste, drag or type one or more links to turn them into cards.
- Covers and icons are stored in your vault, so cards keep working offline.
- No connection? Save the link with a title and fetch the cover later.
- Create your own **collections** (Work, School, Recipes…) next to My list, Pinned and Archive.
- **Drag a card** onto another to swap their places, or drop it on a collection to move it there.
- Tags, search, and sorting by date, title or site.
- Three layouts: grid, list and compact. Follows your light/dark theme.
- Tracking parameters (`utm_*`, `fbclid`…) are removed automatically.
- Save from your browser with the bookmarklet (Settings → Visualink).
- Export all links to a Markdown note.

## Embed cards in a note

````
```visualink
tag: reading
limit: 6
```
````

Other options: `collection: Work`, `search: text`, `domain: github.com`, `pinned`, or a list of URLs (one per line).

## Privacy and network use

Visualink has no telemetry, accounts or servers. It only connects to the internet to:

- Read a page's metadata when you save a link or refresh a card. If a site hides its preview from regular requests, Visualink asks again as `VisualinkBot` and, for some sites (YouTube, Reddit, X, TikTok, Bluesky, Vimeo), uses their public oEmbed service.
- Download the page's cover and icon into `Visualink/assets/` in your vault. If image caching is turned off, images load from their original site instead.

It reads the clipboard only when you run *Save link(s) from clipboard* or open the *Save a link* dialog (to prefill a copied link).

Cards are stored in `.obsidian/plugins/visualink/data.json`.

## Development

```bash
npm install
npm run dev     # watch mode
npm run build   # production build
```

## License

[MIT](LICENSE)
