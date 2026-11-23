/* eslint-env node, jest */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

/** Loads the ES module source into a sandbox and returns its exports. */
function loadModule() {
  const source = fs.readFileSync(path.join(__dirname, 'order-item-prices.js'), 'utf8')
    .replace(/^export (const|function) /gm, '$1 ');
  const sandbox = {};
  vm.runInNewContext(
    `${source}\nthis.exports = { PRICE_MATCH_TOLERANCE, isUndiscountedTaxInclusivePrice, transformOrderItemPrices, ORDER_DROPIN_MODELS };`,
    sandbox,
  );
  return sandbox.exports;
}

const {
  isUndiscountedTaxInclusivePrice,
  transformOrderItemPrices,
  ORDER_DROPIN_MODELS,
} = loadModule();

const money = (value) => ({ value, currency: 'USD' });

/** Item prices from order 000000814 (PaaS, catalog prices include 21% tax, no discount). */
const ORDER_814_PRICES = {
  price: money(52.625),
  price_including_tax: money(63.675),
  original_price: money(63.675),
  original_price_including_tax: money(77.04675),
};

describe('isUndiscountedTaxInclusivePrice', () => {
  test('tax-inclusive catalog price without discount (order 000000814)', () => {
    expect(isUndiscountedTaxInclusivePrice(ORDER_814_PRICES)).toBe(true);
  });

  test('tax-inclusive catalog price with a real discount', () => {
    expect(isUndiscountedTaxInclusivePrice({
      price: money(40),
      price_including_tax: money(48.4),
      original_price: money(63.675),
    })).toBe(false);
  });

  test('tax-exclusive catalog price without discount', () => {
    expect(isUndiscountedTaxInclusivePrice({
      price: money(100),
      price_including_tax: money(121),
      original_price: money(100),
    })).toBe(false);
  });

  test('untaxed item', () => {
    expect(isUndiscountedTaxInclusivePrice({
      price: money(50),
      price_including_tax: money(50),
      original_price: money(50),
    })).toBe(false);
  });

  test('missing prices', () => {
    expect(isUndiscountedTaxInclusivePrice(undefined)).toBe(false);
    expect(isUndiscountedTaxInclusivePrice({ price: money(1) })).toBe(false);
  });
});

describe('transformOrderItemPrices', () => {
  test('clears the false discount and uses the tax-exclusive price for exclude-tax display', () => {
    const result = transformOrderItemPrices({
      items: [{ __typename: 'OrderItem', prices: ORDER_814_PRICES }],
    });
    expect(JSON.parse(JSON.stringify(result))).toEqual({
      items: [{
        discounted: false,
        taxCalculations: {
          excludeTax: {
            originalPrice: money(52.625),
            baseOriginalPrice: money(52.625),
          },
        },
      }],
    });
  });

  test('returns nothing when no item needs a change', () => {
    expect(JSON.parse(JSON.stringify(transformOrderItemPrices({
      items: [{
        __typename: 'OrderItem',
        prices: {
          price: money(40),
          price_including_tax: money(48.4),
          original_price: money(63.675),
        },
      }],
    })))).toEqual({});
  });

  test('keeps indexes aligned with the drop-in (it drops items without __typename)', () => {
    const result = transformOrderItemPrices({
      items: [
        { prices: ORDER_814_PRICES },
        { __typename: 'OrderItem', prices: { price: money(100), price_including_tax: money(121), original_price: money(100) } },
        { __typename: 'OrderItem', prices: ORDER_814_PRICES },
      ],
    });
    expect(result.items).toHaveLength(2);
    expect(Object.keys(result.items[0])).toHaveLength(0);
    expect(result.items[1].discounted).toBe(false);
  });

  test('handles orders without items', () => {
    expect(JSON.parse(JSON.stringify(transformOrderItemPrices({})))).toEqual({});
    expect(JSON.parse(JSON.stringify(transformOrderItemPrices(null)))).toEqual({});
  });

  test('is registered as the OrderDataModel transformer', () => {
    expect(ORDER_DROPIN_MODELS.OrderDataModel.transformer).toBe(transformOrderItemPrices);
  });
});
