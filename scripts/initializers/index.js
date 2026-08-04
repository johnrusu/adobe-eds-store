// Drop-in Tools
import { getCookie } from '@dropins/tools/lib.js';
import { events } from '@dropins/tools/event-bus.js';
import { initializers } from '@dropins/tools/initializer.js';
import { isAemAssetsEnabled } from '@dropins/tools/lib/aem/assets.js';
import { getConfigValue, getRootPath } from '@dropins/tools/lib/aem/configs.js';
import { FetchGraphQL } from '@dropins/tools/fetch-graphql.js';
import {
  CORE_FETCH_GRAPHQL,
  CS_FETCH_GRAPHQL,
  fetchPlaceholders,
  getCommerceCoreEndpoint,
} from '../commerce.js';

const DROPIN_WEBSITE_COOKIE = 'dropin_website_path';
const CART_STORE_VIEW_KEY = 'DROPIN__CART__STORE_VIEW';
const getWebsitePath = () => getRootPath() || '/';
const clearCookie = (name) => { document.cookie = `${name}=; path=/; Max-Age=0`; };

const clearCartState = () => {
  clearCookie('DROPIN__CART__CART-ID');
  sessionStorage.removeItem('DROPINS_CART_ID');
  sessionStorage.removeItem('DROPIN__CART__CART__DATA');
  sessionStorage.removeItem('DROPIN__CART__SHIPPING__DATA');
  localStorage.removeItem('DROPIN__CART__CART__AUTHENTICATED');
};

const getCachedCartCurrency = () => {
  try {
    const cartData = JSON.parse(sessionStorage.getItem('DROPIN__CART__CART__DATA'));
    return cartData?.total?.includingTax?.currency
      || cartData?.subtotal?.includingTax?.currency
      || cartData?.subtotal?.excludingTax?.currency;
  } catch {
    return null;
  }
};

const CREATE_GUEST_CART = `mutation CreateStoreCart {
  createGuestCart {
    cart {
      id
    }
  }
}`;

const ASSIGN_CUSTOMER_CART = `mutation AssignCustomerCart($cartId: String!) {
  assignCustomerToGuestCart(cart_id: $cartId) {
    id
  }
}`;

async function migrateCustomerCartToStore(storeCode) {
  const guestFetchGraphQL = new FetchGraphQL();
  guestFetchGraphQL.setEndpoint(getCommerceCoreEndpoint());
  guestFetchGraphQL.setFetchGraphQlHeader('Store', storeCode);

  const guestResponse = await guestFetchGraphQL.fetchGraphQl(CREATE_GUEST_CART);
  const guestCartId = guestResponse?.data?.createGuestCart?.cart?.id;
  if (!guestCartId || guestResponse?.errors?.length) {
    throw new Error(guestResponse?.errors?.[0]?.message || 'Unable to create store cart.');
  }

  const assignResponse = await CORE_FETCH_GRAPHQL.fetchGraphQl(ASSIGN_CUSTOMER_CART, {
    variables: { cartId: guestCartId },
  });
  if (!assignResponse?.data?.assignCustomerToGuestCart || assignResponse?.errors?.length) {
    throw new Error(assignResponse?.errors?.[0]?.message || 'Unable to migrate customer cart.');
  }
}

export const getUserTokenCookie = () => getCookie('auth_dropin_user_token');

const setAuthHeaders = (state) => {
  if (state) {
    const token = getUserTokenCookie();
    CORE_FETCH_GRAPHQL.setFetchGraphQlHeader('Authorization', `Bearer ${token}`);
  } else {
    CORE_FETCH_GRAPHQL.removeFetchGraphQlHeader('Authorization');
  }
};

const setCustomerGroupHeader = (customerGroupId) => {
  CS_FETCH_GRAPHQL.setFetchGraphQlHeader('Magento-Customer-Group', customerGroupId);
};

const setAdobeCommerceOptimizerHeader = (adobeCommerceOptimizer) => {
  if (adobeCommerceOptimizer?.priceBookId) {
    CS_FETCH_GRAPHQL.setFetchGraphQlHeader('AC-Price-Book-ID', adobeCommerceOptimizer.priceBookId);
  } else {
    CS_FETCH_GRAPHQL.removeFetchGraphQlHeader('AC-Price-Book-ID');
  }
};

const persistCartDataInSession = (data) => {
  if (data?.id) {
    sessionStorage.setItem('DROPINS_CART_ID', data.id);
  } else {
    sessionStorage.removeItem('DROPINS_CART_ID');
  }
};

const setupAemAssetsImageParams = () => {
  if (isAemAssetsEnabled()) {
    // Convert decimal values to integers for AEM Assets compatibility
    initializers.setImageParamKeys({
      width: (value) => ['width', Math.floor(value)],
      height: (value) => ['height', Math.floor(value)],
      quality: 'quality',
      auto: 'auto',
      crop: 'crop',
      fit: 'fit',
    });
    return;
  }

  // Magento catalog media ignores these params; skip non-finite values so we
  // do not append height=NaN to product image URLs.
  initializers.setImageParamKeys({
    width: (value) => (Number.isFinite(Number(value)) ? ['width', Math.floor(Number(value))] : undefined),
    height: (value) => (Number.isFinite(Number(value)) ? ['height', Math.floor(Number(value))] : undefined),
  });
};

export default async function initializeDropins() {
  const init = async () => {
    const selectedStoreView = localStorage.getItem('store-view') || 'default';
    const cartStoreView = localStorage.getItem(CART_STORE_VIEW_KEY);
    const selectedCurrency = (getConfigValue('store-views') || [])
      .find(({ code }) => code === selectedStoreView)?.currency;
    const cachedCartCurrency = getCachedCartCurrency();
    const isCurrencyMismatch = Boolean(
      cachedCartCurrency
      && selectedCurrency
      && cachedCartCurrency !== selectedCurrency,
    );
    const isStoreChange = cartStoreView !== selectedStoreView || isCurrencyMismatch;
    const token = getUserTokenCookie();

    // A cart belongs to the store view and currency in which it was created.
    // Never reuse a cart after the selected Commerce store changes.
    if (isStoreChange) {
      clearCartState();
    }

    // The customer token exists independently from the cart-authenticated flag.
    setAuthHeaders(!!token);

    if (isStoreChange && token) {
      try {
        await migrateCustomerCartToStore(selectedStoreView);
      } catch (error) {
        localStorage.removeItem(CART_STORE_VIEW_KEY);
        console.error('Unable to migrate the customer cart to the selected store.', error);
        throw error;
      }
    }
    localStorage.setItem(CART_STORE_VIEW_KEY, selectedStoreView);

    // Set Customer-Group-ID header
    if (getConfigValue('adobe-commerce-optimizer')) {
      events.on('auth/adobe-commerce-optimizer', setAdobeCommerceOptimizerHeader, { eager: true });
    } else {
      events.on('auth/group-uid', setCustomerGroupHeader, { eager: true });
    }

    // Clear cart state when switching between websites to avoid stale cart IDs
    // and authentication state from a different website causing errors.
    const storedWebsitePath = getCookie(DROPIN_WEBSITE_COOKIE);
    const currentWebsitePath = getWebsitePath();
    if (storedWebsitePath && storedWebsitePath !== currentWebsitePath) {
      clearCartState();
    }
    document.cookie = `${DROPIN_WEBSITE_COOKIE}=${currentWebsitePath}; path=/`;

    // Set auth headers on authenticated event
    events.on('authenticated', setAuthHeaders, { eager: true });

    // Cache cart data in session storage
    events.on('cart/data', persistCartDataInSession, { eager: true });

    // on page load, check if user is authenticated
    // Event Bus Logger
    events.enableLogger(true);

    // Set up AEM Assets image parameter conversion
    setupAemAssetsImageParams();

    // Fetch global placeholders
    await fetchPlaceholders('placeholders/global.json');

    // Initialize Global Drop-ins
    await import('./auth.js');

    await import('./personalization.js');

    import('./cart.js');

    events.on('aem/lcp', async () => {
      // Recaptcha
      await import('@dropins/tools/recaptcha.js').then((recaptcha) => {
        recaptcha.setEndpoint(CORE_FETCH_GRAPHQL);
        recaptcha.enableLogger(true);
        return recaptcha.setConfig();
      });
    }, { eager: true });
  };

  // re-initialize on prerendering changes
  document.addEventListener('prerenderingchange', initializeDropins, { once: true });

  return init();
}

export function initializeDropin(cb) {
  let initialized = false;

  const init = async (force = false) => {
    // prevent re-initialization
    if (initialized && !force) return;
    // initialize drop-in
    await cb();
    initialized = true;
  };

  // re-initialize on prerendering changes
  document.addEventListener('prerenderingchange', () => init(true), { once: true });

  return init;
}
