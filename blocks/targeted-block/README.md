# Targeted Block

## Overview

The Targeted Block conditionally displays inline or fragment content using the
Adobe Commerce personalization Dropin. It supports customer segments, customer
groups, and cart-price-rule identifiers.

## Integration

### Block Configuration

| Configuration Key | Type | Default | Description | Required | Side Effects |
|---|---|---|---|---|---|
| `type` | string | none | Personalization matching type passed to the Dropin. | Yes | Controls how personalization data is evaluated. |
| `fragment` | path | none | Optional fragment used as targeted content. | No | Replaces inline content when provided. |
| `customer-segments` | comma-separated IDs | empty | Customer segment IDs. | No | IDs are trimmed and Base64 encoded. |
| `customer-groups` | comma-separated IDs | empty | Customer group IDs. | No | IDs are trimmed and Base64 encoded. |
| `cart-rules` | comma-separated IDs | empty | Cart price rule IDs. | No | IDs are trimmed and Base64 encoded. |

The runtime keys use kebab-case as delivered by `readBlockConfig()`. Component
model field names are normalized by the AEM authoring pipeline.

### URL Parameters and Storage

The block does not directly read URL parameters or browser storage.
Personalization context and authentication state are managed by the
storefront-personalization Dropin.

### Events

The block does not emit custom events. Personalization updates are handled
inside the Dropin and its shared Commerce event context.

## Behavior Patterns

1. Read authored targeting criteria.
2. Base64 encode each comma-separated identifier.
3. Load the configured fragment or use the final inline content row.
4. Render `TargetedBlock` with segment, group, and cart-rule criteria.
5. Replace the Dropin content slot with the selected DOM content.

### Error Handling

Authors must provide valid identifiers and either inline content or a resolvable
fragment. Fragment loading returns `null` when unavailable; malformed IDs or
missing content are delegated to the personalization Dropin and may result in
no rendered targeted content.

