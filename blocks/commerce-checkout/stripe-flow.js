/**
 * Chooses the Stripe payment block for the checkout page: `stripe-payment` (PaymentIntents) or
 * `stripe-payment-ewcs` (Elements with Checkout Sessions). Both use the `oope_stripe` method.
 *
 * Only the chosen block is imported. Each block listens to checkout events and starts loading
 * its Stripe.js release (`v3` or `dahlia`) when imported, and the page keeps the first release
 * it loads, so switching the flow reloads the page.
 */
import {
  STRIPE_FLOW,
  STRIPE_FLOW_BLOCKS,
  STRIPE_FLOW_LABELS,
  STRIPE_FLOW_LEGEND,
  STRIPE_FLOW_QUERY_PARAM,
  STRIPE_FLOW_SELECTOR_CLASS,
  STRIPE_FLOW_STORAGE_KEY,
} from './constants.js';

/**
 * Reads the chosen Stripe flow from the `flow` query parameter, then from localStorage.
 * @returns {string} A STRIPE_FLOW value, the PaymentIntent flow when none or an unknown one is set
 */
function getStripeFlow() {
  let flow = null;
  try {
    flow = new URLSearchParams(window.location.search).get(STRIPE_FLOW_QUERY_PARAM)
      || window.localStorage.getItem(STRIPE_FLOW_STORAGE_KEY);
  } catch {
    // Storage unavailable: keep the PaymentIntent flow.
  }
  return Object.values(STRIPE_FLOW).includes(flow) ? flow : STRIPE_FLOW.PAYMENT_INTENT;
}

/**
 * Saves the chosen Stripe flow and reloads the checkout with it.
 * @param {string} flow - A STRIPE_FLOW value
 */
function switchStripeFlow(flow) {
  try {
    window.localStorage.setItem(STRIPE_FLOW_STORAGE_KEY, flow);
  } catch {
    // Storage unavailable: the query parameter still selects the flow.
  }
  const url = new URL(window.location.href);
  url.searchParams.set(STRIPE_FLOW_QUERY_PARAM, flow);
  window.location.assign(url.toString());
}

const stripeFlow = getStripeFlow();
const stripeBlock = await import(STRIPE_FLOW_BLOCKS[stripeFlow]);

/**
 * Builds the radio group that switches the Stripe flow.
 * @returns {HTMLFieldSetElement} The flow selector
 */
function createStripeFlowSelector() {
  const $fieldset = document.createElement('fieldset');
  $fieldset.className = STRIPE_FLOW_SELECTOR_CLASS;

  const $legend = document.createElement('legend');
  $legend.textContent = STRIPE_FLOW_LEGEND;
  $fieldset.append($legend);

  Object.values(STRIPE_FLOW).forEach((flow) => {
    const $input = document.createElement('input');
    $input.type = 'radio';
    $input.name = STRIPE_FLOW_SELECTOR_CLASS;
    $input.value = flow;
    $input.checked = flow === stripeFlow;

    const $label = document.createElement('label');
    $label.append($input, STRIPE_FLOW_LABELS[flow]);
    $fieldset.append($label);
  });

  // The checkout form does not own this field, so the change stops here.
  $fieldset.addEventListener('change', (event) => {
    event.stopPropagation();
    switchStripeFlow(event.target.value);
  });

  return $fieldset;
}

/**
 * Renders the flow selector above the chosen block's payment form in the `oope_stripe` slot.
 * @param {Object} ctx - PaymentMethods slot context
 */
function renderStripePaymentMethod(ctx) {
  // The slot's replaceHTML uses `this`, so the original context makes the call.
  const flowCtx = Object.create(ctx, {
    replaceHTML: {
      value: ($content) => {
        const $wrapper = document.createElement('div');
        $wrapper.append(createStripeFlowSelector(), $content);
        ctx.replaceHTML($wrapper);
      },
    },
  });
  stripeBlock.renderStripePaymentMethod(flowCtx);
}

const { handleStripePayment } = stripeBlock;

export { handleStripePayment, renderStripePaymentMethod };
