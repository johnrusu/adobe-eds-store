import { initializers } from '@dropins/tools/initializer.js';
import { getConfigValue } from '@dropins/tools/lib/aem/configs.js';
import { initialize, setEndpoint } from '@dropins/storefront-product-discovery/api.js';
import { initializeDropin } from './index.js';
import { CORE_FETCH_GRAPHQL, CS_FETCH_GRAPHQL, fetchPlaceholders } from '../commerce.js';

const CURRENCY_QUERY = `query CurrencyQuery {
  currency {
    base_currency_code
    exchange_rates {
      currency_to
      rate
    }
  }
}`;

async function fetchCurrencyConfig() {
  try {
    const response = await CORE_FETCH_GRAPHQL.fetchGraphQl(CURRENCY_QUERY, {
      method: 'GET',
      cache: 'force-cache',
    });
    return response?.data?.currency;
  } catch (error) {
    console.warn('Unable to fetch currency exchange rates.', error);
    return null;
  }
}

function createPriceConverter(targetCurrency, currencyConfig) {
  const baseCurrency = currencyConfig?.base_currency_code;
  const exchangeRate = currencyConfig?.exchange_rates?.find(
    ({ currency_to: currencyTo }) => currencyTo === targetCurrency,
  )?.rate;

  const convertAmount = (amount) => {
    if (!amount || !targetCurrency || amount.currency === targetCurrency) return amount;
    if (amount.currency !== baseCurrency || !exchangeRate) return amount;
    return {
      ...amount,
      value: Number((amount.value * exchangeRate).toFixed(2)),
      currency: targetCurrency,
    };
  };

  const convertPrice = (price) => (price ? {
    ...price,
    final: price.final
      ? { ...price.final, amount: convertAmount(price.final.amount) }
      : price.final,
    regular: price.regular
      ? { ...price.regular, amount: convertAmount(price.regular.amount) }
      : price.regular,
  } : price);

  return (product) => ({
    ...product,
    price: convertPrice(product?.price),
    priceRange: product?.priceRange ? {
      ...product.priceRange,
      minimum: convertPrice(product.priceRange.minimum),
      maximum: convertPrice(product.priceRange.maximum),
    } : product?.priceRange,
  });
}

await initializeDropin(async () => {
  // Inherit Fetch GraphQL Instance (Catalog Service)
  setEndpoint(CS_FETCH_GRAPHQL);

  // Fetch placeholders
  const labels = await fetchPlaceholders('placeholders/search.json');
  const langDefinitions = {
    default: {
      ...labels,
    },
  };

  const activeStoreCode = window.localStorage.getItem('store-view')
    || getConfigValue('headers.all.Store')
    || 'default';
  const activeStoreView = (getConfigValue('store-views') || [])
    .find(({ code }) => code === activeStoreCode);
  const currencyConfig = activeStoreView?.currency ? await fetchCurrencyConfig() : null;
  const models = activeStoreView?.currency ? {
    Product: {
      transformer: createPriceConverter(activeStoreView.currency, currencyConfig),
    },
  } : undefined;

  // Initialize search
  return initializers.mountImmediately(initialize, { langDefinitions, models });
})();
