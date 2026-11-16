/* eslint-disable import/no-unresolved */
/* eslint-disable no-console */

// Dropin Tools
import { events } from '@dropins/tools/event-bus.js';

// Checkout Dropin
import * as checkoutApi from '@dropins/storefront-checkout/api.js';

/**
 * Helpers shared by the stripe-payment, stripe-payment-ewcs and express-checkout
 * blocks. Copy this folder into the storefront next to the block that uses it.
 */

// Define the Stripe payment method code as a constant
export const STRIPE_PAYMENT_METHOD_CODE = 'oope_stripe';
export const STRIPE_REQUEST_TIMEOUT = 15000;
export const ELEMENTS_CONTAINER_ID = 'stripe-elements-container';
const STRIPE_LOADING_PROMISE_KEY = '__stripeJsLoadingPromise';

// Store the loading promise to avoid multiple loading attempts
let stripeLoadingPromise = null;
// Client secret last stored on the Commerce cart payment
let persistedPaymentMethodClientSecret = null;

export async function fetchStripeResource(resource, options = {}) {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), STRIPE_REQUEST_TIMEOUT);

  try {
    return await fetch(resource, { ...options, signal: controller.signal });
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error('Stripe did not respond in time. Please try again.');
    }
    throw error;
  } finally {
    window.clearTimeout(timeoutId);
  }
}

// Helper to ensure Stripe.js is loaded from the given release URL. The Stripe
// blocks on a page share one loading promise, so the first block to start
// loading decides the release.
export const loadStripeJs = (url) => {
  // If there's already a loading promise in progress, return it
  if (stripeLoadingPromise) {
    return stripeLoadingPromise;
  }

  if (window[STRIPE_LOADING_PROMISE_KEY]) {
    stripeLoadingPromise = window[STRIPE_LOADING_PROMISE_KEY];
    return stripeLoadingPromise;
  }

  // If Stripe is already defined, resolve immediately
  if (typeof Stripe !== 'undefined') {
    return Promise.resolve();
  }

  // Create a new loading promise
  stripeLoadingPromise = new Promise((resolve, reject) => {
    // Loading Stripe.js dynamically...
    const script = document.createElement('script');
    script.src = url;
    const timeoutId = window.setTimeout(() => {
      stripeLoadingPromise = null;
      window[STRIPE_LOADING_PROMISE_KEY] = null;
      script.remove();
      reject(new Error('Stripe.js did not load in time.'));
    }, STRIPE_REQUEST_TIMEOUT);
    script.onload = () => {
      // Stripe.js loaded successfully
      window.clearTimeout(timeoutId);
      resolve();
    };
    script.onerror = () => {
      // Failed to load Stripe.js
      window.clearTimeout(timeoutId);
      stripeLoadingPromise = null; // Reset so we can try again next time
      window[STRIPE_LOADING_PROMISE_KEY] = null;
      reject(new Error('Failed to load Stripe.js'));
    };
    document.head.appendChild(script);
  });
  window[STRIPE_LOADING_PROMISE_KEY] = stripeLoadingPromise;

  return stripeLoadingPromise;
};

// Helper to clear Stripe payment errors
export function clearStripeError(containerId = ELEMENTS_CONTAINER_ID) {
  const container = document.querySelector(`#${containerId}`);
  if (!container) return;

  const errorContainer = container.querySelector('.stripe-error');
  if (errorContainer) {
    errorContainer.remove();
  }
}

// Helper to display Stripe payment errors
export function displayStripeError(message, containerId = ELEMENTS_CONTAINER_ID) {
  const container = document.querySelector(`#${containerId}`);
  if (!container) {
    console.error('Error container not found:', containerId);
    return;
  }

  // Create error container if it doesn't exist
  let errorContainer = container.querySelector('.stripe-error');
  if (!errorContainer) {
    errorContainer = document.createElement('div');
    errorContainer.className = 'stripe-error';
    container.appendChild(errorContainer);
  }

  errorContainer.textContent = message;

  // Scroll to error for visibility
  errorContainer.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

  setTimeout(() => {
    clearStripeError(containerId);
  }, 10000);
}

// Helper to get the customer auth token from cookie (set by storefront-auth dropin)
export function getCustomerTokenFromCookie() {
  const match = document.cookie.match(
    /(?:^|;\s*)auth_dropin_user_token=([^;]+)/,
  );
  return match ? decodeURIComponent(match[1]) : null;
}

export function getActiveCartId(preferredCartId = null, cartData = null) {
  return (
    preferredCartId
    || cartData?.id
    || events.lastPayload('cart/updated')?.id
    || events.lastPayload('cart/initialized')?.id
    || window.sessionStorage.getItem('DROPINS_CART_ID')
    || null
  );
}

export function isStripePaymentMethod(method) {
  return method.code === STRIPE_PAYMENT_METHOD_CODE;
}

export function isStripePaymentMethodAvailable(checkoutData) {
  return checkoutData?.availablePaymentMethods.some(isStripePaymentMethod);
}

// The App Builder action URLs from the trusted Commerce payment configuration of
// the Stripe payment method, which must hold every URL in requiredUrls.
export function getStripeRuntimeConfig(stripePaymentMethod, requiredUrls) {
  if (!stripePaymentMethod) {
    console.error('Stripe payment method configuration is missing.');
    throw new Error('Stripe payment method is not available.');
  }

  const backendIntegrationUrl = stripePaymentMethod
    ?.oope_payment_method_config?.backend_integration_url;

  if (!backendIntegrationUrl) {
    console.error(
      'Stripe backend integration URL is missing in Commerce payment configuration.',
    );
    throw new Error('Stripe payment configuration is invalid.');
  }

  let paymentConfig;
  try {
    paymentConfig = JSON.parse(backendIntegrationUrl);
  } catch (error) {
    console.error('Stripe backend integration URL is not valid JSON.', error);
    throw new Error('Stripe payment configuration is invalid.');
  }

  if (requiredUrls.some((name) => !paymentConfig[name])) {
    console.error(
      'Stripe runtime URLs are missing in the Commerce payment configuration.',
    );
    throw new Error('Stripe payment configuration is invalid.');
  }

  return paymentConfig;
}

// POST to an App Builder action with the customer token and the store view. A
// failed request throws the action's error message, with its error code as
// `code`.
export async function postStripeAction(endpoint, body) {
  const headers = { 'Content-Type': 'application/json' };
  const customerToken = getCustomerTokenFromCookie();
  if (customerToken) {
    headers.Authorization = `Bearer ${customerToken}`;
  }

  const selectedStore = window.localStorage.getItem('store-view') || 'default';
  headers.Store = selectedStore;

  const response = await fetchStripeResource(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  const data = await response.json();

  if (!response.ok || data.error) {
    const error = new Error(
      data.error || data.message || 'Unable to create Stripe session.',
    );
    error.code = data.code || null;
    throw error;
  }

  return data;
}

// Store the client secret on the Commerce cart payment, once per client secret.
export async function persistStripePaymentMethod(clientSecret) {
  if (persistedPaymentMethodClientSecret === clientSecret) {
    return true;
  }

  const paymentMethodResponse = await checkoutApi.setPaymentMethod({
    code: STRIPE_PAYMENT_METHOD_CODE,
    additional_data: [{ key: 'client_secret', value: clientSecret }],
  });

  if (!paymentMethodResponse) {
    return false;
  }

  persistedPaymentMethodClientSecret = clientSecret;
  return true;
}

export function resetPersistedStripePaymentMethod() {
  persistedPaymentMethodClientSecret = null;
}

export function getAddressFullName(address) {
  return `${address?.firstName || ''} ${address?.lastName || ''}`.trim();
}

// A checkout drop-in address in the shape Stripe.js expects.
export function getStripeAddress(address) {
  const country = address?.country?.code
    || address?.country?.value
    || address?.countryCode
    || '';

  return {
    line1: address?.street?.[0] || '',
    line2: address?.street?.[1] || '',
    city: address?.city || '',
    state: address?.region?.code || '',
    country,
    postal_code: address?.postCode || address?.postcode || '',
  };
}

// Currencies Stripe charges without minor units, and with three decimals.
// UGX is not listed: Stripe takes UGX amounts with two decimals.
// https://docs.stripe.com/currencies
const STRIPE_ZERO_DECIMAL_CURRENCIES = new Set([
  'BIF', 'CLP', 'DJF', 'GNF', 'JPY', 'KMF', 'KRW', 'MGA',
  'PYG', 'RWF', 'VND', 'VUV', 'XAF', 'XOF', 'XPF',
]);

const STRIPE_THREE_DECIMAL_CURRENCIES = new Set([
  'BHD', 'JOD', 'KWD', 'OMR', 'TND',
]);

/**
 * Convert a Commerce amount to the smallest currency unit Stripe expects, with
 * the same rules as the App Builder actions. A three-decimal amount is rounded
 * to a multiple of 10, as Stripe requires.
 * @param {number|string} value Amount in major currency units.
 * @param {string} currency ISO currency code.
 * @returns {number}
 */
export function toStripeMinorUnits(value, currency) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    throw new Error('A Stripe amount is unavailable.');
  }

  const normalizedCurrency = String(currency || '').toUpperCase();
  if (STRIPE_ZERO_DECIMAL_CURRENCIES.has(normalizedCurrency)) {
    return Math.round(numericValue);
  }
  if (STRIPE_THREE_DECIMAL_CURRENCIES.has(normalizedCurrency)) {
    return Math.round(numericValue * 100) * 10;
  }
  return Math.round(numericValue * 100);
}

export function removeEmptyStripeValues(value) {
  if (!value || typeof value !== 'object') {
    return value;
  }

  return Object.entries(value).reduce((result, [key, fieldValue]) => {
    if (fieldValue === '' || fieldValue === null || fieldValue === undefined) {
      return result;
    }

    if (typeof fieldValue === 'object' && !Array.isArray(fieldValue)) {
      const nestedValue = removeEmptyStripeValues(fieldValue);
      if (Object.keys(nestedValue).length === 0) {
        return result;
      }
      result[key] = nestedValue;
      return result;
    }

    result[key] = fieldValue;
    return result;
  }, {});
}
