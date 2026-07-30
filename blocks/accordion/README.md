# Accordion Block

## Overview

The Accordion block converts each authored two-column row into a native HTML
`details` element. The first column becomes the clickable `summary`; the second
column becomes the expandable content. Native elements provide keyboard,
focus, and screen-reader behavior without additional JavaScript state.

## Integration

### Authoring Structure

Each accordion item requires:

1. A summary or label in the first cell.
2. Rich-text content in the second cell.

The component model allows one or more `accordion-item` components inside the
parent Accordion block.

### Block Configuration

The block does not use `readBlockConfig()` and has no key/value configuration.

### URL Parameters and Storage

The block does not read URL parameters, cookies, session storage, or local
storage.

### Events

The block does not use the Commerce event bus or emit custom events. Opening
and closing are handled by the browser's native `details` behavior.

## Behavior Patterns

- Every authored row is replaced with `.accordion-item`.
- The first cell becomes `.accordion-item-label`.
- The second cell becomes `.accordion-item-body`.
- Multiple items can remain open simultaneously.
- Users can toggle an item by clicking its summary or pressing Enter/Space
  while the summary has focus.

### Error Handling

No network operations are performed. Authors must provide both cells; malformed
rows without a body do not satisfy the block contract and may prevent that item
from decorating.

