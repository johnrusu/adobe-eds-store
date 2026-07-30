# Fragment Block

## Overview

The Fragment block includes reusable AEM page content inside another page.
Loaded markup is passed through the normal main-content decoration and
three-phase section loading pipeline before being inserted.

## Integration

### Block Configuration

The fragment path is read from the first authored link. If there is no link,
the trimmed block text is used as the path.

| Value | Type | Required | Description |
|---|---|---|---|
| Fragment URL | root-relative path | Yes | Path to the reusable fragment without `.plain.html`. |
| Fragment URL Text | string | No | Optional author-facing link text. |

### URL Construction

- Production request: `{root}{path}.plain.html`
- Local request on `localhost` or `127.0.0.1`:
  `/drafts{root}{path}.plain.html`
- Protocol-relative and non-root-relative paths are rejected.
- Relative `./media_*` image and source URLs are rebased to the fragment path.

### Storage and Events

The block does not use browser storage or custom events.

## Behavior Patterns

1. Fetch the fragment's plain HTML.
2. Create a temporary `main` element.
3. Rebase fragment media URLs.
4. Run `decorateMain()` and `loadSections()`.
5. Replace the authored block with the decorated fragment nodes.

### Error Handling

`loadFragment()` returns `null` for invalid paths and non-successful responses.
The default decorator leaves the original block in place when loading fails.
Callers should check for a null result before reading fragment content.

