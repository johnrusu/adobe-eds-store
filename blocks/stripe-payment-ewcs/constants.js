/**
 * Constants of the stripe-payment-ewcs block. Values shared with the other Stripe blocks
 * are in ../stripe-shared/constants.js.
 */

export const STYLESHEET_URL = '/blocks/stripe-payment-ewcs/stripe-payment-ewcs.css';

// Checkout Sessions in Elements mode need this Stripe.js release. It matches the
// Stripe API version the checkout-session action creates the session with.
export const STRIPE_JS_URL = 'https://js.stripe.com/dahlia/stripe.js';
// The checkout-session action is deployed in the same App Builder package as payment-intent.
export const CHECKOUT_SESSION_ACTION = 'checkout-session';
export const CART_INCOMPLETE_ERROR_CODE = 'cart_incomplete';
// Type of a successful Checkout Session result
export const CHECKOUT_RESULT_SUCCESS = 'success';

// Wait for the checkout to settle before replacing the session of a mounted form.
export const SESSION_SYNC_DELAY = 500;

// Session total shown below the Payment Element
export const SESSION_TOTAL_CLASS = 'stripe-checkout-total';
export const SESSION_TOTAL_LABEL_CLASS = 'stripe-checkout-total-label';
export const SESSION_TOTAL_AMOUNT_CLASS = 'stripe-checkout-total-amount';
export const SESSION_TOTAL_LABEL = 'Amount due';

// Container of the Currency Selector Element, above the Payment Element. The block creates
// it, so the shared payment form markup stays the same for both Stripe blocks.
export const CURRENCY_SELECTOR_CONTAINER_ID = 'stripe-currency-selector';
// Event of the Checkout SDK instance that reports a change of the session
export const CHECKOUT_SESSION_CHANGE_EVENT = 'change';

// Notice shown while the cart lacks what the session needs
export const CART_INCOMPLETE_NOTICE_CLASS = 'stripe-cart-incomplete';
export const CART_INCOMPLETE_HINT = 'The payment form loads once the checkout details above are complete.';

/** Customer-facing and diagnostic messages of this block. */
export const EWCS_MESSAGES = Object.freeze({
  SESSION_REFRESH_FAILED: 'Unable to refresh Stripe session:',
  ORDER_DETAILS_CHANGED: 'Your order details changed. Please enter your payment details again.',
  CHECKOUT_ACTIONS_LOAD_FAILED: 'Failed to load Stripe Checkout actions.',
  PAYMENT_ELEMENT_LOAD_FAILED_LOG: 'Stripe payment element failed to load:',
  STRIPE_JS_LOAD_FAILED_LOG: 'Failed to load Stripe.js:',
  /**
   * The message for a Stripe.js release that cannot run Checkout Sessions in Elements mode.
   * @param {string} stripeJsUrl Release the block needs.
   * @returns {string}
   */
  CHECKOUT_SESSIONS_UNSUPPORTED: (stripeJsUrl) => `The loaded Stripe.js does not support Checkout Sessions in Elements mode. Load ${stripeJsUrl} on this page.`,
});
