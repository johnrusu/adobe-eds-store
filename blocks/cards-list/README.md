# Cards List Block

## Overview

The Cards List block renders a responsive editorial card collection used for
storefront category and promotional links. It applies the card layout classes,
identifies descriptive copy, and converts authored links to the alternate
button treatment.

## Integration

### Authoring Structure

Each direct child row represents one card and should contain:

1. A media cell, normally containing a picture.
2. A content cell containing a heading, description, and optional link.

The decorator adds `.card-item` to every row and `.desc` to the first paragraph
that is not already a button container.

### Block Configuration

The block does not read key/value configuration.

### URL Parameters and Storage

The block does not read URL parameters or use browser storage. Link destinations
come directly from authored anchors.

### Events

No custom or Commerce events are consumed or emitted.

## Behavior Patterns

- All links receive the shared `.button.alt` presentation.
- Missing descriptions are allowed; the card still renders its other content.
- Card layout and responsive behavior are controlled entirely by
  `cards-list.css`.
- Native anchor behavior is preserved for keyboard and pointer users.

### Error Handling

The decorator uses optional access for the content and description elements, so
cards with partial content remain visible. Invalid or missing link destinations
retain normal browser anchor behavior.

