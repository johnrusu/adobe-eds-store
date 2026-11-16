/**
 * Constants of the stripe-payment block. Values shared with the other Stripe blocks
 * are in ../stripe-shared/constants.js.
 */

export const STYLESHEET_URL = '/blocks/stripe-payment/stripe-payment.css';
export const STRIPE_JS_URL = 'https://js.stripe.com/v3/';

// Stripe Elements
export const PAYMENT_ELEMENT_TYPE = 'payment';

/** Customer-facing and diagnostic messages of this block. */
export const PAYMENT_MESSAGES = Object.freeze({
  CART_TOTAL_UNAVAILABLE: 'Cart total is unavailable for Stripe payment initialization.',
  PAYMENT_ERROR_SESSION_CREATE_FAILED: 'Payment error: Unable to create Stripe session.',
  PAYMENT_AMOUNT_UPDATE_FAILED: 'Unable to update Stripe payment amount:',
  STRIPE_KEY_FETCH_FAILED: 'Error fetching Stripe key:',
  PAYMENT_FORM_INIT_FAILED: 'Unable to initialize payment form. Please refresh and try again.',
  PAYMENT_FORM_INIT_FAILED_LOG: 'Failed to initialize Stripe payment form:',
  SUBMIT_UNKNOWN_ERROR: 'Unknown error submitting payment form',
  PAYMENT_SESSION_UNAVAILABLE: 'Unable to create payment session. Please try again.',
  /**
   * The message for an init-params request that failed.
   * @param {string} statusText Status text of the response.
   * @returns {string}
   */
  INIT_PARAMS_LOAD_FAILED: (statusText) => `Failed to load Stripe init params: ${statusText}`,
});
