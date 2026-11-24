/**
 * Constants of the helpers shared by the stripe-payment, stripe-payment-ewcs and
 * express-checkout blocks.
 */

// Stripe payment method
export const STRIPE_PAYMENT_METHOD_CODE = 'oope_stripe';
export const ELEMENTS_CONTAINER_ID = 'stripe-elements-container';
export const PAYMENT_FORM_ID = 'stripe-payment-form';
export const LOADING_CLASS = 'stripe-elements-loading';
export const CLIENT_SECRET_DATA_KEY = 'client_secret';

// Timing, in milliseconds
export const STRIPE_REQUEST_TIMEOUT = 15000;
export const STRIPE_ERROR_DISPLAY_TIME = 10000;

// Shared Stripe.js loading promise, read by every Stripe block on the page
export const STRIPE_LOADING_PROMISE_KEY = '__stripeJsLoadingPromise';

// Stripe error message element
export const STRIPE_ERROR_CLASS = 'stripe-error';
export const STRIPE_ERROR_SCROLL_OPTIONS = Object.freeze({ behavior: 'smooth', block: 'nearest' });

// Prefix of an element ID in a CSS selector
export const ID_SELECTOR_PREFIX = '#';

// Event bus events
export const CART_EVENTS = Object.freeze({
  UPDATED: 'cart/updated',
  INITIALIZED: 'cart/initialized',
});
export const CHECKOUT_EVENTS = Object.freeze({
  UPDATED: 'checkout/updated',
  INITIALIZED: 'checkout/initialized',
});

// Stripe Elements
export const ELEMENTS_MODE_PAYMENT = 'payment';

// Stripe Payment Element
export const PAYMENT_ELEMENT_LAYOUT_ACCORDION = 'accordion';
// Values of a Payment Element option, such as a billing detail field or saving a payment method
export const ELEMENT_OPTION_MODE = Object.freeze({ NEVER: 'never', AUTO: 'auto' });
export const PAYMENT_ELEMENT_EVENTS = Object.freeze({
  CHANGE: 'change',
  LOAD_ERROR: 'loaderror',
});
export const REDIRECT_IF_REQUIRED = 'if_required';

// Names of the App Builder action URLs in the Commerce payment configuration
export const RUNTIME_URL_KEYS = Object.freeze({
  CREATE_PAYMENT_INTENT: 'createPaymentIntentUrl',
  GET_INIT_PARAMS: 'getInitParamsUrl',
});

// Browser storage and cookies
export const CART_ID_STORAGE_KEY = 'DROPINS_CART_ID';
export const STORE_VIEW_STORAGE_KEY = 'store-view';
export const DEFAULT_STORE_VIEW = 'default';
// Address form values that the storefront-account drop-in's AddressForm keeps in
// sessionStorage as `${formName}_addressData`. It caches only these two form names.
export const CHECKOUT_ADDRESS_STORAGE_KEYS = Object.freeze([
  'selectedShippingAddress_addressData',
  'selectedBillingAddress_addressData',
]);
// Cookie set by the storefront-auth drop-in
export const AUTH_TOKEN_COOKIE_PATTERN = /(?:^|;\s*)auth_dropin_user_token=([^;]+)/;

// App Builder requests
export const ABORT_ERROR_NAME = 'AbortError';
export const HTTP_METHOD_GET = 'GET';
export const HTTP_METHOD_POST = 'POST';
export const HTTP_HEADERS = Object.freeze({
  CONTENT_TYPE: 'Content-Type',
  AUTHORIZATION: 'Authorization',
  STORE: 'Store',
});
export const JSON_CONTENT_TYPE = 'application/json';
export const BEARER_PREFIX = 'Bearer ';

/** Customer-facing and diagnostic messages. */
export const STRIPE_MESSAGES = Object.freeze({
  RESPONSE_TIMEOUT: 'Stripe did not respond in time. Please try again.',
  STRIPE_JS_TIMEOUT: 'Stripe.js did not load in time.',
  STRIPE_JS_LOAD_FAILED: 'Failed to load Stripe.js',
  ERROR_CONTAINER_NOT_FOUND: 'Error container not found:',
  METHOD_CONFIGURATION_MISSING: 'Stripe payment method configuration is missing.',
  METHOD_NOT_AVAILABLE: 'Stripe payment method is not available.',
  BACKEND_URL_MISSING:
    'Stripe backend integration URL is missing in Commerce payment configuration.',
  BACKEND_URL_INVALID_JSON: 'Stripe backend integration URL is not valid JSON.',
  RUNTIME_URLS_MISSING:
    'Stripe runtime URLs are missing in the Commerce payment configuration.',
  CONFIGURATION_INVALID: 'Stripe payment configuration is invalid.',
  SESSION_CREATE_FAILED: 'Unable to create Stripe session.',
  AMOUNT_UNAVAILABLE: 'A Stripe amount is unavailable.',
  PAYMENT_FORM_LOAD_FAILED: 'Unable to load payment form. Please refresh and try again.',
  PAYMENT_DETAILS_INCOMPLETE: 'Please complete your payment details',
  PAYMENT_METHOD_NOT_SET: 'Failed to set the payment method.',
  NOT_INITIALIZED:
    'Stripe payment is not properly initialized. Please refresh and try again.',
  CART_ID_UNAVAILABLE: 'Cart ID is unavailable. Please refresh checkout and try again.',
  CART_ID_UNAVAILABLE_FOR_INIT: 'Cart ID is not available for Stripe payment initialization.',
  CONFIRMATION_ERROR: 'An error occurred during payment confirmation.',
  PAYMENT_ELEMENT_DESTROY_FAILED: 'Unable to destroy Stripe payment element:',
  PAYMENT_FORM_INIT_ERROR: 'Error initializing Stripe payment form:',
  STRIPE_JS_INIT_LOAD_FAILED: 'Failed to load Stripe.js during initialization:',
});

// Currencies Stripe charges without minor units, and with three decimals.
// UGX is not listed: Stripe takes UGX amounts with two decimals.
// https://docs.stripe.com/currencies
export const STRIPE_ZERO_DECIMAL_CURRENCIES = new Set([
  'BIF', 'CLP', 'DJF', 'GNF', 'JPY', 'KMF', 'KRW', 'MGA',
  'PYG', 'RWF', 'VND', 'VUV', 'XAF', 'XOF', 'XPF',
]);

export const STRIPE_THREE_DECIMAL_CURRENCIES = new Set([
  'BHD', 'JOD', 'KWD', 'OMR', 'TND',
]);
