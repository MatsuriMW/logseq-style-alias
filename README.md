# Logseq Style Alias

> **Write the alias, land on the page.**

An Obsidian plugin that makes `[[alias]]` links open the page that has the alias, the way Logseq does — instead of leaving them unresolved, or worse, creating an empty page.

**English** · [简体中文](./README.zh-CN.md)

![Left: `[[5 Whys]]` typed by hand, shown as a resolved link. Right: the page it opens, Five Whys, whose alias is 5 Whys.](https://raw.githubusercontent.com/MatsuriMW/logseq-style-alias/main/docs/screenshot.png)

**Contents**

- [The problem](#the-problem)
- [What it does](#what-it-does)
- [Commands](#commands)
- [Settings](#settings)
- [Installing](#installing)
- [Limits](#limits)
- [Feedback and updates](#feedback-and-updates)

## The problem

Give a page called `Retrieval-Augmented Generation` the alias `RAG`:

```markdown
---
aliases:
  - RAG
---
```

Obsidian uses aliases for link suggestions only. If you type `[[RAG]]` yourself instead of picking the suggestion, the link is unresolved. Click it and Obsidian creates an empty `RAG.md` — and from then on every `[[RAG]]` points at that empty page instead of the real one. Over time a vault collects dozens of these.

In Logseq an alias and the page name are the same thing. This plugin brings that behaviour to Obsidian.

## What it does

| You write | There is… | The link opens |
|---|---|---|
| `[[RAG]]` | no file called `RAG` | the page with alias `RAG` |
| `[[RAG]]` | an **empty** `RAG.md` (only whitespace) | the page with alias `RAG` |
| `[[RAG]]` | a `RAG.md` **with content** | `RAG.md` — a real file always wins |
| `[[RAG]]` | two pages that both claim `RAG` | resolved the way Obsidian normally does; the plugin does not guess |

Everything that asks Obsidian where a link points follows the alias: clicking, hover preview, embeds, the backlinks pane, outgoing links, the graph, unresolved-link styling, and other plugins that use the same API (Dataview, backlink plugins).

Your notes are never modified. Turn the plugin off and links resolve exactly as before.

### Details

- **Case.** Aliases match case-insensitively, like file names do. Set a property (default `case-sensitive`, configurable) to `true` on a page to make its aliases match only the exact spelling.
- **Paths.** Only bare links are redirected. `[[folder/RAG]]` names a specific file and is left alone.
- **Pages with only properties** are not empty. A page that has only frontmatter is treated as a real page.
- **Renaming.** Obsidian updates links on rename through a different lookup, so renaming the aliased page never rewrites your `[[RAG]]` into the new file name.

## Commands

| Command | What it does |
|---|---|
| Delete empty pages named after an alias | Moves every empty page whose name is an alias of exactly one other page to the trash (following your *Deleted files* setting). Links to them keep working through the alias. |
| List alias conflicts | Shows names that point to more than one page with content: an alias claimed by two pages, or an alias that is also another page's file name. |

## Settings

| Setting | Default | What it does |
|---|---|---|
| Empty pages give way to aliases | On | When `[[alias]]` matches an empty page, open the aliased page instead |
| Case-sensitivity property | `case-sensitive` | Pages with this property set to `true` only match links that use the exact case |

## Installing

Copy `main.js` and `manifest.json` into `<vault>/.obsidian/plugins/logseq-style-alias/`, reload Obsidian, and enable **Logseq Style Alias** in **Settings → Community plugins**. Or add it through [BRAT](https://github.com/TfTHacker/obsidian42-brat) from `MatsuriMW/logseq-style-alias`.

## Limits

- The redirection lives inside Obsidian. Tools that read the Markdown files directly — scripts, static-site exporters, other editors — still see `[[RAG]]` as a link to a file named `RAG`.
- Install it on every device you use, including mobile, or `[[alias]]` will be unresolved there.
- It works by wrapping `metadataCache.getFirstLinkpathDest`. The wrapper is removed when the plugin is disabled; if another plugin wrapped the same function afterwards, ours stays in place but passes everything through untouched.

## Feedback and updates

To follow new features, send feedback or keep up with progress, follow me on Twitter: [@Matsurimywaifu](https://x.com/Matsurimywaifu).
