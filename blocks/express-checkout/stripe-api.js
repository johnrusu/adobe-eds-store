import { events } from '@dropins/tools/event-bus.js';
import {
  MESSAGES,
  EVENTS,
  STRIPE_PAYMENT_METHOD_CODE,
  STRIPE_PAYMENT_METHOD_TITLE,
} from './constants.js';
import { HTTP_METHOD_POST, RUNTIME_URL_KEYS } from '../stripe-shared/constants.js';
import {
  fetchStripeResource,
  getActiveCartId,
  getSelectedStoreView,
  getStripeActionHeaders,
  getStripeRuntimeConfig,
  setStripePaymentMethod,
} from '../stripe-shared/stripe-helpers.js';
import { state } from './checkout-state.js';
import { getCommerceCustomerName } from './addresses.js';

/**
 * Resolve the active cart ID from the Express Checkout state and the shared fallbacks.
 * @returns {string|null}
 */
function getCurrentCartId() {
  return getActiveCartId(null, state.cartData, state.checkoutData);
}

/**
 * Find the Stripe method and its Commerce-provided runtime configuration.
 * @returns {Object|undefined}
 */
function getStripePaymentMethod() {
  const paymentMethods = [
    state.checkoutData?.selectedPaymentMethod,
    ...(state.checkoutData?.availablePaymentMethods || []),
  ].filter(Boolean);
  return paymentMethods.find((method) => method.code === STRIPE_PAYMENT_METHOD_CODE);
}

/**
 * Check whether the selected or an available Commerce payment method is the Stripe one.
 * @returns {boolean}
 */
function isStripeMethodOffered() {
  return Boolean(getStripePaymentMethod());
}

/**
 * Read the required App Builder action URLs from the Commerce payment method.
 * @returns {Object}
 */
function parseRuntimeConfig() {
  return getStripeRuntimeConfig(
    getStripePaymentMethod(),
    [RUNTIME_URL_KEYS.GET_INIT_PARAMS, RUNTIME_URL_KEYS.CREATE_PAYMENT_INTENT],
  );
}

/**
 * Fetch and validate the public Stripe initialization response.
 * @param {string} endpoint Configured initialization action URL.
 * @returns {Promise<Object>}
 */
async function fetchInitParams(endpoint) {
  const response = await fetchStripeResource(endpoint);
  const data = await response.json().catch(() => null);
  if (!response.ok || !data?.publishableKey) {
    throw new Error(MESSAGES.INIT_UNAVAILABLE);
  }
  return data;
}

/**
 * Send cart context and the Confirmation Token ID to the configured action.
 * @param {string} confirmationTokenId Stripe Confirmation Token ID.
 * @returns {Promise<Object>}
 */
async function createPaymentIntent(confirmationTokenId) {
  const cartId = getCurrentCartId();
  const selectedStore = getSelectedStoreView();
  const response = await fetchStripeResource(state.runtimeConfig.createPaymentIntentUrl, {
    method: HTTP_METHOD_POST,
    headers: getStripeActionHeaders(),
    body: JSON.stringify({
      cartId,
      cartFullName: getCommerceCustomerName(),
      confirmationTokenId,
      storeCode: selectedStore,
    }),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data?.client_secret) {
    throw new Error(data?.error || data?.message || MESSAGES.INTENT_FAILED);
  }
  return data;
}

/**
 * Select Stripe in the UI and verify Commerce persisted its client secret.
 * @param {string} clientSecret PaymentIntent client secret returned by App Builder.
 * @returns {Promise<Object>}
 */
async function selectStripePaymentMethod(clientSecret) {
  const stripePaymentMethod = getStripePaymentMethod() || {
    code: STRIPE_PAYMENT_METHOD_CODE,
    title: STRIPE_PAYMENT_METHOD_TITLE,
  };
  const checkoutValues = events.lastPayload(EVENTS.CHECKOUT_VALUES) || {};
  events.emit(EVENTS.CHECKOUT_VALUES, {
    ...checkoutValues,
    selectedPaymentMethod: stripePaymentMethod,
  });
  const updatedCheckout = await setStripePaymentMethod(clientSecret);
  if (updatedCheckout?.selectedPaymentMethod?.code !== STRIPE_PAYMENT_METHOD_CODE) {
    throw new Error(MESSAGES.METHOD_NOT_PERSISTED);
  }
  state.checkoutData = {
    ...state.checkoutData,
    ...updatedCheckout,
    availablePaymentMethods:
      updatedCheckout.availablePaymentMethods
      || state.checkoutData?.availablePaymentMethods,
  };
  events.emit(EVENTS.CHECKOUT_VALUES, {
    ...(events.lastPayload(EVENTS.CHECKOUT_VALUES) || {}),
    selectedPaymentMethod: updatedCheckout.selectedPaymentMethod,
  });
  return updatedCheckout;
}

export {
  getCurrentCartId,
  createPaymentIntent,
  selectStripePaymentMethod,
  isStripeMethodOffered,
  parseRuntimeConfig,
  fetchInitParams,
};
