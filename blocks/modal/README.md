# Modal Block

## Overview

The Modal block is a programmatic utility that wraps supplied DOM nodes in a
native `dialog`. It is used by authentication, mini-PDP, and store-selector
flows and handles focus, backdrop dismissal, cleanup, and Dropin unmounting.

## Integration

### API

`createModal(contentNodes)` returns:

| Member | Description |
|---|---|
| `block` | The generated modal block element appended to `main`. |
| `showModal()` | Opens the native dialog and focuses the first input once available. |
| `removeModal()` | Closes the dialog and unmounts nested Dropin containers. |

The utility does not use `readBlockConfig()`.

### URL Parameters and Storage

No URL parameters or browser-storage keys are used.

### Events

When the dialog closes, the generated block dispatches:

`CustomEvent('close', { detail: { reason } })`

Reasons currently include `button`, `backdrop`, or an empty string for
programmatic closure.

## Behavior Patterns

- Lazy-loads `modal.css`.
- Adds `modal-open` to the body while visible.
- Closes from the close button or mouse click outside the dialog bounds.
- Does not treat touch/pointer events as backdrop clicks.
- Observes asynchronous content and focuses its first input.
- Resets modal scroll position each time it opens.
- Unmounts every nested `[data-dropin-container]` before closing.

### Error Handling

Callers must supply valid DOM nodes and a page containing `main`. Dropin cleanup
is performed even for programmatic closure. The observer disconnects after an
input is found.

