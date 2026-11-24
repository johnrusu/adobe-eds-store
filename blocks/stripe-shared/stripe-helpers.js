/* eslint-disable import/no-unresolved */
/* eslint-disable no-console */

// Dropin Tools
import { events } from '@dropins/tools/event-bus.js';

// Checkout Dropin
import * as checkoutApi from '@dropins/storefront-checkout/api.js';

import {
  ABORT_ERROR_NAME,
  AUTH_TOKEN_COOKIE_PATTERN,
  BEARER_PREFIX,
  CART_EVENTS,
  CART_ID_STORAGE_KEY,
  CHECKOUT_ADDRESS_STORAGE_KEYS,
  CLIENT_SECRET_DATA_KEY,
  DEFAULT_STORE_VIEW,
  ELEMENTS_CONTAINER_ID,
  HTTP_HEADERS,
  HTTP_METHOD_POST,
  JSON_CONTENT_TYPE,
  LOADING_CLASS,
  PAYMENT_FORM_ID,
  STORE_VIEW_STORAGE_KEY,
  STRIPE_ERROR_CLASS,
  STRIPE_ERROR_DISPLAY_TIME,
  STRIPE_ERROR_SCROLL_OPTIONS,
  STRIPE_LOADING_PROMISE_KEY,
  STRIPE_MESSAGES,
  STRIPE_PAYMENT_METHOD_CODE,
  STRIPE_REQUEST_TIMEOUT,
  STRIPE_THREE_DECIMAL_CURRENCIES,
  STRIPE_ZERO_DECIMAL_CURRENCIES,
} from './constants.js';

/**
 * Helpers shared by the stripe-payment, stripe-payment-ewcs and express-checkout
 * blocks. Copy this folder into the storefront next to the block that uses it.
 */

// Store the loading promise to avoid multiple loading attempts
let stripeLoadingPromise = null;
// Client secret last stored on the Commerce cart payment
let persistedPaymentMethodClientSecret = null;

/**
 * Fetch a resource, aborting the request after the Stripe request timeout.
 * @param {string} resource URL to request.
 * @param {Object} [options] Options of the fetch call.
 * @returns {Promise<Response>} The response.
 */
export async function fetchStripeResource(resource, options = {}) {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), STRIPE_REQUEST_TIMEOUT);

  try {
    return await fetch(resource, { ...options, signal: controller.signal });
  } catch (error) {
    if (error.name === ABORT_ERROR_NAME) {
      throw new Error(STRIPE_MESSAGES.RESPONSE_TIMEOUT);
    }
    throw error;
  } finally {
    window.clearTimeout(timeoutId);
  }
}

/**
 * Ensure Stripe.js is loaded from the given release URL. The Stripe blocks on a page
 * share one loading promise, so the first block to start loading decides the release.
 * @param {string} url Stripe.js release URL.
 * @returns {Promise<void>} Settles when Stripe.js is loaded.
 */
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
      reject(new Error(STRIPE_MESSAGES.STRIPE_JS_TIMEOUT));
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
      reject(new Error(STRIPE_MESSAGES.STRIPE_JS_LOAD_FAILED));
    };
    document.head.appendChild(script);
  });
  window[STRIPE_LOADING_PROMISE_KEY] = stripeLoadingPromise;

  return stripeLoadingPromise;
};

/**
 * Build the container of the payment form: the form with the Elements container in its loading
 * state, which the Stripe blocks put in the payment method slot.
 * @returns {{$content: HTMLElement, $stripeContainer: HTMLElement}} The form and the container.
 */
export function createPaymentFormContent() {
  const $content = document.createElement('div');
  $content.id = PAYMENT_FORM_ID; // Stripe form container

  // Ensure a child element exists for Stripe Elements
  const $stripeContainer = document.createElement('div');
  $stripeContainer.id = ELEMENTS_CONTAINER_ID;
  $stripeContainer.classList.add(LOADING_CLASS);

  $content.appendChild($stripeContainer);
  return { $content, $stripeContainer };
}

/**
 * Remove the loading state of the Elements container and empty it, before mounting an element.
 * @param {string} mountId Selector of the container.
 */
export function clearElementsContainer(mountId) {
  const container = document.querySelector(mountId);
  if (container && container.closest(`.${LOADING_CLASS}`)) {
    container
      .closest(`.${LOADING_CLASS}`)
      .classList.remove(LOADING_CLASS);
  }
  if (container) {
    container.innerHTML = '';
  }
}

/**
 * Destroy a mounted Stripe element, logging instead of throwing when Stripe.js refuses.
 * @param {Object|null} element Mounted Payment Element, if there is one.
 */
export function destroyStripeElement(element) {
  if (!element) return;

  try {
    element.destroy();
  } catch (error) {
    console.warn(STRIPE_MESSAGES.PAYMENT_ELEMENT_DESTROY_FAILED, error);
  }
}

/**
 * Remove the Stripe payment error message from a container.
 * @param {string} [containerId] ID of the container holding the message.
 */
export function clearStripeError(containerId = ELEMENTS_CONTAINER_ID) {
  const container = document.querySelector(`#${containerId}`);
  if (!container) return;

  const errorContainer = container.querySelector(`.${STRIPE_ERROR_CLASS}`);
  if (errorContainer) {
    errorContainer.remove();
  }
}

/**
 * Show a Stripe payment error message in a container. The message goes away after a while.
 * @param {string} message Message to show.
 * @param {string} [containerId] ID of the container to show it in.
 */
export function displayStripeError(message, containerId = ELEMENTS_CONTAINER_ID) {
  const container = document.querySelector(`#${containerId}`);
  if (!container) {
    console.error(STRIPE_MESSAGES.ERROR_CONTAINER_NOT_FOUND, containerId);
    return;
  }

  // Create error container if it doesn't exist
  let errorContainer = container.querySelector(`.${STRIPE_ERROR_CLASS}`);
  if (!errorContainer) {
    errorContainer = document.createElement('div');
    errorContainer.className = STRIPE_ERROR_CLASS;
    container.appendChild(errorContainer);
  }

  errorContainer.textContent = message;

  // Scroll to error for visibility
  errorContainer.scrollIntoView(STRIPE_ERROR_SCROLL_OPTIONS);

  setTimeout(() => {
    clearStripeError(containerId);
  }, STRIPE_ERROR_DISPLAY_TIME);
}

/**
 * Remove the address form values the storefront keeps for the current checkout.
 * Call it before Stripe confirms the payment: a redirect-based payment method
 * (Bancontact, PayPal, Revolut, …) leaves the page there, so the storefront's
 * own clean-up on `order/placed` never runs and the next checkout would show
 * the previous order's addresses.
 */
export function clearCheckoutAddressCache() {
  try {
    CHECKOUT_ADDRESS_STORAGE_KEYS.forEach((key) => window.sessionStorage.removeItem(key));
  } catch (error) {
    // Storage unavailable: the address form had nothing to keep.
  }
}

/**
 * Read the customer auth token from the cookie set by the storefront-auth drop-in.
 * @returns {string|null} The token of a logged-in customer, or null.
 */
export function getCustomerTokenFromCookie() {
  const match = document.cookie.match(AUTH_TOKEN_COOKIE_PATTERN);
  return match ? decodeURIComponent(match[1]) : null;
}

/**
 * Resolve the active cart ID from the arguments, the cart events or the session storage.
 * @param {string|null} [preferredCartId] Cart ID to use when there is one.
 * @param {Object|null} [cartData] Cart data of the checkout.
 * @param {Object|null} [checkoutData] Checkout data, which can also carry the cart ID.
 * @returns {string|null} The cart ID, or null.
 */
export function getActiveCartId(preferredCartId = null, cartData = null, checkoutData = null) {
  return (
    preferredCartId
    || cartData?.id
    || checkoutData?.id
    || events.lastPayload(CART_EVENTS.UPDATED)?.id
    || events.lastPayload(CART_EVENTS.INITIALIZED)?.id
    || window.sessionStorage.getItem(CART_ID_STORAGE_KEY)
    || null
  );
}

/**
 * Tell whether a payment method is the Stripe one.
 * @param {Object} method Commerce payment method.
 * @returns {boolean}
 */
export function isStripePaymentMethod(method) {
  return method.code === STRIPE_PAYMENT_METHOD_CODE;
}

/**
 * Tell whether the checkout offers the Stripe payment method.
 * @param {Object} checkoutData Checkout drop-in data.
 * @returns {boolean|undefined}
 */
export function isStripePaymentMethodAvailable(checkoutData) {
  return checkoutData?.availablePaymentMethods.some(isStripePaymentMethod);
}

/**
 * Read the App Builder action URLs from the trusted Commerce payment configuration of
 * the Stripe payment method, which must hold every URL in requiredUrls.
 * @param {Object} stripePaymentMethod Commerce Stripe payment method.
 * @param {string[]} requiredUrls Names of the URLs the configuration must hold.
 * @returns {Object} The parsed payment configuration.
 */
export function getStripeRuntimeConfig(stripePaymentMethod, requiredUrls) {
  if (!stripePaymentMethod) {
    console.error(STRIPE_MESSAGES.METHOD_CONFIGURATION_MISSING);
    throw new Error(STRIPE_MESSAGES.METHOD_NOT_AVAILABLE);
  }

  const backendIntegrationUrl = stripePaymentMethod
    ?.oope_payment_method_config?.backend_integration_url;

  if (!backendIntegrationUrl) {
    console.error(STRIPE_MESSAGES.BACKEND_URL_MISSING);
    throw new Error(STRIPE_MESSAGES.CONFIGURATION_INVALID);
  }

  let paymentConfig;
  try {
    paymentConfig = JSON.parse(backendIntegrationUrl);
  } catch (error) {
    console.error(STRIPE_MESSAGES.BACKEND_URL_INVALID_JSON, error);
    throw new Error(STRIPE_MESSAGES.CONFIGURATION_INVALID);
  }

  if (requiredUrls.some((name) => !paymentConfig[name])) {
    console.error(STRIPE_MESSAGES.RUNTIME_URLS_MISSING);
    throw new Error(STRIPE_MESSAGES.CONFIGURATION_INVALID);
  }

  return paymentConfig;
}

/**
 * Read the store view the storefront selected.
 * @returns {string} The store view code, the default one when none is selected.
 */
export function getSelectedStoreView() {
  return window.localStorage.getItem(STORE_VIEW_STORAGE_KEY) || DEFAULT_STORE_VIEW;
}

/**
 * Build the headers of a request to an App Builder action: JSON content, the token of a
 * logged-in customer and the store view.
 * @returns {Object} The headers.
 */
export function getStripeActionHeaders() {
  const headers = { [HTTP_HEADERS.CONTENT_TYPE]: JSON_CONTENT_TYPE };
  const customerToken = getCustomerTokenFromCookie();
  if (customerToken) {
    headers[HTTP_HEADERS.AUTHORIZATION] = `${BEARER_PREFIX}${customerToken}`;
  }

  headers[HTTP_HEADERS.STORE] = getSelectedStoreView();
  return headers;
}

/**
 * POST to an App Builder action with the customer token and the store view. A failed
 * request throws the action's error message, with its error code as `code`.
 * @param {string} endpoint URL of the action.
 * @param {Object} body Request body.
 * @returns {Promise<Object>} The action's response data.
 */
export async function postStripeAction(endpoint, body) {
  const response = await fetchStripeResource(endpoint, {
    method: HTTP_METHOD_POST,
    headers: getStripeActionHeaders(),
    body: JSON.stringify(body),
  });
  const data = await response.json();

  if (!response.ok || data.error) {
    const error = new Error(
      data.error || data.message || STRIPE_MESSAGES.SESSION_CREATE_FAILED,
    );
    error.code = data.code || null;
    throw error;
  }

  return data;
}

/**
 * Set the Stripe payment method, with a client secret, on the Commerce cart.
 * @param {string} clientSecret Client secret of the PaymentIntent or Checkout Session.
 * @returns {Promise<Object|null|undefined>} The updated checkout, as the checkout API returns it.
 */
export function setStripePaymentMethod(clientSecret) {
  return checkoutApi.setPaymentMethod({
    code: STRIPE_PAYMENT_METHOD_CODE,
    additional_data: [{ key: CLIENT_SECRET_DATA_KEY, value: clientSecret }],
  });
}

/**
 * Store the client secret on the Commerce cart payment, once per client secret.
 * @param {string} clientSecret Client secret of the PaymentIntent or Checkout Session.
 * @returns {Promise<boolean>} Whether Commerce accepted it.
 */
export async function persistStripePaymentMethod(clientSecret) {
  if (persistedPaymentMethodClientSecret === clientSecret) {
    return true;
  }

  const paymentMethodResponse = await setStripePaymentMethod(clientSecret);

  if (!paymentMethodResponse) {
    return false;
  }

  persistedPaymentMethodClientSecret = clientSecret;
  return true;
}

/**
 * Forget the client secret last stored on the Commerce cart payment.
 */
export function resetPersistedStripePaymentMethod() {
  persistedPaymentMethodClientSecret = null;
}

/**
 * Read the shipping address from the supported shapes of the checkout and cart models: a single
 * address, or the first of the shipping addresses, in camel or snake case.
 * @param {Object|null} [checkoutData] Checkout or cart data.
 * @returns {Object|null} The shipping address, or null.
 */
export function readCheckoutShippingAddress(checkoutData) {
  return (
    checkoutData?.shippingAddress
    || checkoutData?.shippingAddresses?.[0]
    || checkoutData?.shipping_address
    || checkoutData?.shipping_addresses?.[0]
    || null
  );
}

/**
 * Join the first and last name of an address.
 * @param {Object} [address] Checkout drop-in address.
 * @returns {string} The full name, empty when the address has none.
 */
export function getAddressFullName(address) {
  return `${address?.firstName || ''} ${address?.lastName || ''}`.trim();
}

/**
 * Convert a checkout drop-in address to the shape Stripe.js expects.
 * @param {Object} [address] Checkout drop-in address.
 * @returns {Object} The Stripe address.
 */
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
    throw new Error(STRIPE_MESSAGES.AMOUNT_UNAVAILABLE);
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

/**
 * Drop empty strings, null, undefined and empty objects from a value, recursively.
 * @param {*} value Value to clean.
 * @returns {*} The cleaned value; a non-object is returned as it is.
 */
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
