# Enrichment Block

## Overview

The Enrichment block injects contextual AEM fragments into product detail or
product listing pages. It looks up matching fragment paths in the
`enrichment/enrichment` index and matches entries by product SKU, category, and
optional position.

## Integration

### Block Configuration

| Configuration Key | Type | Default | Description | Required | Side Effects |
|---|---|---|---|---|---|
| `type` | `product` or `category` | none | Selects product-SKU or category-path matching. | Yes | Determines which page context is added to the index filters. |
| `position` | string | none | Optional placement identifier matched against indexed positions. | No | Narrows the matching fragment set. |

### Index and Fragment Data

- Loads `/enrichment/enrichment.json` through `fetchIndex()`.
- Indexed `products`, `categories`, and `positions` values must be JSON arrays.
- Every matching `path` is loaded through the Fragment block.
- A single-section fragment is merged into the current section.
- Multi-section fragments are inserted after the enrichment section.

### URL Parameters and Storage

No query parameters or browser-storage keys are used. Product SKU can come from
page metadata or the PDP URL. Category context comes from the
Product List Page block's `urlpath`.

### Events

No Commerce event-bus events are consumed or emitted.

## Behavior Patterns

- **Product pages:** matches the current SKU.
- **Category pages:** matches the PLP category path.
- **Universal position:** optionally restricts either page type by position.
- **Universal Editor:** preserves the wrapper so the component remains
  authorable.
- **Published pages:** removes the enrichment wrapper after processing.

### Error Handling

Missing type, SKU, PLP block, category ID, index data, or invalid indexed JSON is
caught and logged. Fragment paths that fail to load are ignored. The wrapper is
still cleaned up outside Universal Editor.

