# Footer Block

## Overview

The Footer block loads the authored footer fragment and optionally provides a
multistore selector modal. It decorates region/store lists for pointer and
keyboard interaction and then appends the authored footer sections.

## Integration

### Configuration and Metadata

| Key | Source | Default | Description |
|---|---|---|---|
| `footer` | page metadata | `/footer` | Fragment path used for the footer content. |
| `footer-store-switcher-enabled` | `config.json` | false/unset | Enables the modal store selector when the configuration is multistore. |

When enabled, the selector loads `/store-switcher` as a fragment and uses the
current root path to determine the active store link.

### URL Parameters and Storage

The block does not use query parameters or browser storage. Store destinations
are authored links in the store-switcher fragment.

### Events

No Commerce event-bus events are used. Modal lifecycle behavior is delegated to
the Modal block.

## Behavior Patterns

- Loads and decorates the configured footer fragment.
- Renders no store button unless both multistore and the feature flag are true.
- Collapses regions containing multiple store views.
- Converts regions with one store view into direct links.
- Supports click, Enter, and Space interaction.
- Opens the selector inside a native dialog-based modal.

### Error Handling

If the store-switcher fragment is unavailable, the error is logged and footer
decoration stops before rendering an incomplete selector. The footer fragment
must exist and contain valid fragment markup.

