import {
  CART_EVENTS,
  CHECKOUT_EVENTS,
  ELEMENT_OPTION_MODE,
  REDIRECT_IF_REQUIRED,
  STRIPE_PAYMENT_METHOD_CODE,
} from '../stripe-shared/constants.js';

/** Stripe and App Builder protocol values shared with the other Stripe blocks. */
export { STRIPE_PAYMENT_METHOD_CODE };

/** Stripe and App Builder protocol values. */
export const STRIPE_PAYMENT_METHOD_TITLE = 'Stripe Payment Method';

export const STRIPE_JS_URL = 'https://js.stripe.com/v3/';

export const STRIPE = Object.freeze({
  INVALID_PAYMENT_DATA: 'invalid_payment_data',
  FAIL: 'fail',
  ELEMENT_TYPE: 'expressCheckout',
  REDIRECT_IF_REQUIRED,
  // Stripe.js releases such as `dahlia` refuse this option in Stripe() with a VersionError.
  API_VERSION_OPTION: 'apiVersion',
  API_VERSION_REFUSED_PATTERN: /apiVersion/i,
});

export const SUPPORTED_PAYMENT_STATUSES = new Set([
  'processing',
  'requires_capture',
  'succeeded',
]);

/** Request values the block sends to Commerce. */
export const CACHE_NO_CACHE = 'no-cache';

/** Accessibility attributes and the values the block sets. */
export const ARIA = Object.freeze({
  ROLE: 'role',
  LABEL: 'aria-label',
  LIVE: 'aria-live',
  BUSY: 'aria-busy',
  TRUE: 'true',
  ROLE_SEPARATOR: 'separator',
  ROLE_ALERT: 'alert',
  ROLE_STATUS: 'status',
  LIVE_ASSERTIVE: 'assertive',
  LIVE_POLITE: 'polite',
});

/** Presentation values of the checkout markup. */
export const ALERT_VARIANT_PRIMARY = 'primary';
export const BUTTON_TYPE = 'button';
export const FORM_SELECTOR = 'form';

/** Wallets: Stripe payment method names, and the suffixes of their DOM IDs and classes. */
export const WALLET_PAYMENT_METHODS = Object.freeze({
  LINK: 'link',
  AMAZON_PAY: 'amazonPay',
  APPLE_PAY: 'applePay',
  GOOGLE_PAY: 'googlePay',
  PAYPAL: 'paypal',
  KLARNA: 'klarna',
});

export const WALLET_NAMES = Object.freeze({
  LINK: 'link',
  AMAZON: 'amazon',
  APPLE_PAY: 'apple-pay',
  GOOGLE_PAY: 'google-pay',
  PAYPAL: 'paypal',
  KLARNA: 'klarna',
});

// Whether a wallet's payment method is offered by the Express Checkout Element
export const WALLET_METHOD_MODE = Object.freeze({
  ON: ELEMENT_OPTION_MODE.AUTO,
  OFF: ELEMENT_OPTION_MODE.NEVER,
});

/** DOM hooks shared with the block stylesheet and checkout host. */
export const STYLESHEET_URL = '/blocks/express-checkout/stripe-express-checkout.css';

export const ELEMENT_CONTAINER_ID = 'stripe-express-checkout-element';

export const BLOCK_CLASS = 'stripe-express-checkout';

// Prefix of a wallet's container ID and class: the prefix plus a WALLET_NAMES value
export const WALLET_CONTAINER_PREFIX = `${BLOCK_CLASS}-`;

export const BLOCKED_CLASS = 'stripe-express-checkout-blocked';

export const HIDDEN_CLASS = 'stripe-express-checkout-hidden';

export const LOADING_CLASS = 'stripe-express-checkout-loading';

export const HEADING_CLASS = 'stripe-express-checkout-heading';

export const STATUS_CLASS = 'stripe-express-checkout-status';

export const SEPARATOR_CLASS = 'stripe-express-checkout-separator';

export const WALLETS_CLASS = 'stripe-express-checkout-wallets';

export const GATE_CLASS = 'stripe-express-checkout-gate';

export const CHECKOUT_SELECTOR = '.commerce-checkout';

/** Commerce event bus and Stripe Element event names. */
export const EVENTS = Object.freeze({
  CHECKOUT_INITIALIZED: CHECKOUT_EVENTS.INITIALIZED,
  CHECKOUT_UPDATED: CHECKOUT_EVENTS.UPDATED,
  CHECKOUT_VALUES: 'checkout/values',
  CART_INITIALIZED: CART_EVENTS.INITIALIZED,
  CART_UPDATED: CART_EVENTS.UPDATED,
  CART_DATA: 'cart/data',
  CART_RESET: 'cart/reset',
  CLICK: 'click',
  CONFIRM: 'confirm',
  SHIPPING_ADDRESS_CHANGE: 'shippingaddresschange',
  SHIPPING_RATE_CHANGE: 'shippingratechange',
  CANCEL: 'cancel',
  ESCAPE: 'escape',
  LOAD_ERROR: 'loaderror',
  READY: 'ready',
  METHODS_CHANGE: 'availablepaymentmethodschange',
});

/** Customer-facing copy and alert presentation. */
export const STATUS = Object.freeze({ INFO: 'info', SUCCESS: 'success', ERROR: 'error' });

/** Order-summary labels and Commerce tax-display values. */
export const ORDER_SUMMARY = Object.freeze({
  SUBTOTAL: 'Subtotal',
  SHIPPING: 'Shipping & Handling',
  TAX: 'Tax',
  DISCOUNT: 'Discount',
  GRAND_TOTAL: 'Grand Total',
});

export const TAX_DISPLAY = Object.freeze({
  EXCLUDING: 'EXCLUDING_TAX',
  INCLUDING: 'INCLUDING_TAX',
  BOTH: 'INCLUDING_EXCLUDING_TAX',
  BOTH_CHECKOUT: 'INCLUDING_AND_EXCLUDING_TAX',
  // Numeric display settings Commerce can also return
  LEGACY_INCLUDING: Object.freeze([2, 3, '2', '3']),
  LEGACY_EXCLUDING: Object.freeze([1, '1']),
});

/** Keys of the cart model that hold prices and taxes. */
export const CART_PRICE_KEYS = Object.freeze({
  INCLUDING_TAX: 'includingTax',
  EXCLUDING_TAX: 'excludingTax',
  TOTAL_TAX: 'totalTax',
  APPLIED_TAXES: 'appliedTaxes',
});

// Joins a shipping method's carrier and title
export const SHIPPING_METHOD_NAME_SEPARATOR = ' - ';

export const PAYMENT_STATUS = Object.freeze({
  info: {
    heading: 'Payment processing',
    icon: 'InfoFilled',
  },
  success: {
    heading: 'Payment successful',
    icon: 'CheckWithCircle',
    type: 'success',
  },
  error: {
    heading: 'Payment failed',
    icon: 'PaymentError',
    type: 'error',
  },
});

export const MESSAGES = Object.freeze({
  WALLET_ADDRESS_INCOMPLETE: 'The wallet address is incomplete.',
  CART_AMOUNT_UNAVAILABLE: 'The authoritative cart amount is unavailable.',
  CURRENCY_CHANGED: 'The cart currency changed during Express Checkout.',
  INIT_UNAVAILABLE: 'Stripe initialization parameters are unavailable.',
  INTENT_FAILED: 'PaymentIntent failed.',
  METHOD_NOT_PERSISTED: 'Adobe Commerce did not select Stripe as the payment method.',
  TOTAL_CHANGED:
    'The order total changed. Please reopen your wallet and approve the updated total.',
  PROCESSING: 'We are processing your wallet details and payment.',
  CART_UNAVAILABLE: 'The active cart is unavailable.',
  TERMS_REQUIRED:
    'Please accept the terms and conditions, then try Express Checkout again.',
  CHECKOUT_FIELDS_REQUIRED:
    'Please fix the highlighted required fields, then try Express Checkout again.',
  SHIPPING_REQUIRED:
    'Please fill in your shipping address and select a shipping method, then try Express Checkout again.',
  SUBMIT_FAILED: 'The wallet could not submit this payment.',
  TOKEN_FAILED: 'The wallet payment details could not be confirmed.',
  ADDRESS_INCOMPLETE:
    'The wallet did not provide a complete billing or shipping address.',
  CONFIRM_FAILED: 'Stripe could not confirm the payment.',
  PAYMENT_INCOMPLETE:
    'The payment was not completed. Please try again or use the card form below.',
  CREATING_ORDER: 'Payment confirmed. We are creating your order.',
  ORDER_FAILED: 'Adobe Commerce did not create the order.',
  ORDER_PLACED: 'Your payment was successful and your order has been placed.',
  PAYMENT_FAILED: 'Express Checkout could not complete the payment.',
  UNAVAILABLE: 'Express Checkout is unavailable. Please use the card payment form below.',
  HEADING: 'Express checkout',
  SEPARATOR: 'Or pay another way',
  GATE_LABEL: 'Complete the required checkout fields to use Express Checkout',
  ADDRESS_VERIFY_FAILED: 'Unable to verify checkout addresses. Please try again.',
  SAVED_ADDRESS_VERIFY_FAILED: 'Unable to verify saved addresses. Please try again.',
});

/** Developer diagnostics; never include payment credentials in these messages. */
export const DIAGNOSTICS = Object.freeze({
  SUMMARY_SETTINGS_FAILED: 'Unable to load Express Checkout tax-display settings.',
  SHIPPING_SELECTION_FAILED: 'Unable to persist the selected Magento shipping method.',
  SHIPPING_ESTIMATE_FAILED: 'Unable to estimate wallet shipping methods.',
  SHIPPING_METHOD_FAILED: 'Unable to persist the wallet shipping method.',
  STATUS_RENDER_FAILED: 'Unable to render Express Checkout payment status.',
  ELEMENT_DESTROY_FAILED: 'Unable to destroy Stripe Express Checkout Element.',
  CONFIRMATION_FAILED: 'Stripe Express Checkout confirmation failed.',
  ELEMENT_LOAD_FAILED: 'Stripe Express Checkout Element failed to load.',
  ELEMENT_INIT_FAILED: 'Unable to initialize Stripe Express Checkout Element.',
});
