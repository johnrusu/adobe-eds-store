// Form and address constants
const BILLING_FORM_NAME = 'selectedBillingAddress';
const BILLING_ADDRESS_DATA_KEY = `${BILLING_FORM_NAME}_addressData`;
const LOGIN_FORM_NAME = 'login-form';
const PURCHASE_ORDER_FORM_NAME = 'purchase-order';
const SHIPPING_FORM_NAME = 'selectedShippingAddress';
const SHIPPING_ADDRESS_DATA_KEY = `${SHIPPING_FORM_NAME}_addressData`;
const TERMS_AND_CONDITIONS_FORM_NAME = 'checkout-terms-and-conditions__form';

// Timing constants
const DEBOUNCE_TIME = 1000;
const ADDRESS_INPUT_DEBOUNCE_TIME = 500;

// Block and styling constants
const CHECKOUT_BLOCK = 'checkout__block';
const CHECKOUT_ERROR_CLASS = 'checkout__content--error';
const CHECKOUT_HEADER_CLASS = 'checkout-header';
const ORDER_CONFIRMATION_BLOCK = 'order-confirmation__block';

// Stripe payment flow constants (query parameter and storage key match the Stripe playground)
const STRIPE_FLOW = Object.freeze({
  PAYMENT_INTENT: 'payment-intent',
  EWCS: 'ewcs',
});
// Block modules, relative to blocks/commerce-checkout/stripe-flow.js
const STRIPE_FLOW_BLOCKS = Object.freeze({
  [STRIPE_FLOW.PAYMENT_INTENT]: '../stripe-payment/stripe-payment.js',
  [STRIPE_FLOW.EWCS]: '../stripe-payment-ewcs/stripe-payment-ewcs.js',
});
const STRIPE_FLOW_LABELS = Object.freeze({
  [STRIPE_FLOW.PAYMENT_INTENT]: 'Standard',
  [STRIPE_FLOW.EWCS]: 'Checkout Sessions (new)',
});
const STRIPE_FLOW_LEGEND = 'Payment flow';
const STRIPE_FLOW_QUERY_PARAM = 'flow';
const STRIPE_FLOW_STORAGE_KEY = 'stripe-storefront-checkout-flow';
const STRIPE_FLOW_SELECTOR_CLASS = 'checkout__stripe-flow';

export {
  ADDRESS_INPUT_DEBOUNCE_TIME,
  BILLING_ADDRESS_DATA_KEY,
  BILLING_FORM_NAME,
  LOGIN_FORM_NAME,
  PURCHASE_ORDER_FORM_NAME,
  SHIPPING_ADDRESS_DATA_KEY,
  SHIPPING_FORM_NAME,
  TERMS_AND_CONDITIONS_FORM_NAME,

  // Timing constants
  DEBOUNCE_TIME,

  // Block and styling constants
  CHECKOUT_BLOCK,
  CHECKOUT_ERROR_CLASS,
  CHECKOUT_HEADER_CLASS,
  ORDER_CONFIRMATION_BLOCK,

  // Stripe payment flow constants
  STRIPE_FLOW,
  STRIPE_FLOW_BLOCKS,
  STRIPE_FLOW_LABELS,
  STRIPE_FLOW_LEGEND,
  STRIPE_FLOW_QUERY_PARAM,
  STRIPE_FLOW_SELECTOR_CLASS,
  STRIPE_FLOW_STORAGE_KEY,
};
