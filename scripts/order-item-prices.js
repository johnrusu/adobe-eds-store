/**
 * Order item price fix for tax-inclusive catalogs.
 *
 * The @dropins/storefront-order drop-in flags an order item as discounted when
 * `prices.original_price > prices.price`. When catalog prices are entered
 * including tax, Commerce returns `original_price` including tax and `price`
 * excluding tax, so every taxed item looks discounted (the tax-inclusive price
 * is struck through and the tax-exclusive price is shown as a sale price).
 *
 * This transformer corrects only items whose `original_price` equals their
 * `price_including_tax` (tax-inclusive catalog price, no discount). All other
 * items keep the drop-in's values.
 */

/**
 * Largest difference, in currency units, at which two order prices are
 * treated as equal. Commerce returns order prices with more than two decimals.
 */
export const PRICE_MATCH_TOLERANCE = 0.005;

/**
 * Tells whether an order item's regular price was entered including tax and no
 * discount was applied to it.
 *
 * @param {Object} prices - Raw GraphQL `OrderItemPrices` of the item.
 * @returns {boolean} True when `original_price` equals `price_including_tax`
 *   and the item carries tax.
 */
export function isUndiscountedTaxInclusivePrice(prices) {
  const original = prices?.original_price?.value;
  const price = prices?.price?.value;
  const priceInclTax = prices?.price_including_tax?.value;
  if (![original, price, priceInclTax].every(Number.isFinite)) {
    return false;
  }
  return price < priceInclTax
    && Math.abs(original - priceInclTax) < PRICE_MATCH_TOLERANCE;
}

/**
 * Builds the per-item overrides for one raw order item.
 *
 * @param {Object} rawItem - Raw GraphQL order item.
 * @returns {Object} Fields to deep-merge into the drop-in's item model, or an
 *   empty object when the item needs no change.
 */
function buildItemOverride(rawItem) {
  if (!isUndiscountedTaxInclusivePrice(rawItem?.prices)) {
    return {};
  }
  const { price } = rawItem.prices;
  return {
    discounted: false,
    taxCalculations: {
      excludeTax: {
        originalPrice: { value: price.value, currency: price.currency },
        baseOriginalPrice: { value: price.value, currency: price.currency },
      },
    },
  };
}

/**
 * `OrderDataModel` transformer for the order drop-in. Its result is
 * deep-merged into the order model, with arrays merged by index.
 *
 * @param {Object} rawOrder - Raw GraphQL order the drop-in received.
 * @returns {Object} `{ items }` overrides aligned with the model's items, or an
 *   empty object when no item needs a change.
 */
export function transformOrderItemPrices(rawOrder) {
  const rawItems = rawOrder?.items;
  if (!Array.isArray(rawItems)) {
    return {};
  }
  // Same filter the drop-in applies before mapping items, so indexes line up.
  const items = rawItems.filter((item) => item?.__typename).map(buildItemOverride);
  return items.some((item) => Object.keys(item).length > 0) ? { items } : {};
}

/**
 * `models` option for every `@dropins/storefront-order` initialize call.
 * Each call replaces the drop-in config, so every call must pass it.
 */
export const ORDER_DROPIN_MODELS = {
  OrderDataModel: {
    transformer: transformOrderItemPrices,
  },
};
