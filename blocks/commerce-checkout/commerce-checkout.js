/* eslint-disable import/no-unresolved */
/* eslint-disable no-unused-vars */

// Dropin Tools
import { events } from '@dropins/tools/event-bus.js';
import { initReCaptcha } from '@dropins/tools/recaptcha.js';
import {
  Icon,
  InLineAlert,
  provider as UI,
} from '@dropins/tools/components.js';
import { h } from '@dropins/tools/preact.js';

// Order Dropin Modules
import * as orderApi from '@dropins/storefront-order/api.js';
import { getCart } from '@dropins/storefront-checkout/api.js';

// Checkout Dropin Libraries
import {
  createScopedSelector,
  isVirtualCart,
  setMetaTags,
  validateForms,
} from '@dropins/storefront-checkout/lib/utils.js';

// Payment Services Dropin
import { PaymentMethodCode } from '@dropins/storefront-payment-services/api.js';
import { reuseCustomerAddresses } from '../../scripts/checkout-addresses.js';

// Block Utilities
import {
  buildOrderDetailsUrl,
  displayOverlaySpinner,
  removeOverlaySpinner,
} from './utils.js';

// Page restore recovery
import {
  beginPaymentConfirmation,
  endPaymentConfirmation,
  watchForPageRestore,
} from './page-restore.js';

// Fragment functions
import {
  createCheckoutFragment,
  selectors,
} from './fragments.js';

// Container functions
import {
  renderAddressForm,
  renderBillingAddressFormSkeleton,
  renderBillToShippingAddress,
  renderCartSummaryList,
  renderCheckoutHeader,
  renderCustomerBillingAddresses,
  renderCustomerShippingAddresses,
  renderGiftOptions,
  renderLoginForm,
  renderMergedCartBanner,
  renderOrderSummary,
  renderOutOfStock,
  renderPaymentMethods,
  renderPlaceOrder,
  renderServerError,
  renderShippingAddressFormSkeleton,
  renderShippingMethods,
  renderTermsAndConditions,
} from './containers.js';

// Constants
import {
  BILLING_ADDRESS_DATA_KEY,
  BILLING_FORM_NAME,
  LOGIN_FORM_NAME,
  PURCHASE_ORDER_FORM_NAME,
  SHIPPING_ADDRESS_DATA_KEY,
  SHIPPING_FORM_NAME,
  TERMS_AND_CONDITIONS_FORM_NAME,
} from './constants.js';

import { rootLink } from '../../scripts/commerce.js';

// Initializers
import '../../scripts/initializers/account.js';
import '../../scripts/initializers/checkout.js';
import '../../scripts/initializers/order.js';
import '../../scripts/initializers/payment-services.js';

// Checkout success block import and CSS preload
import { renderCheckoutSuccess, preloadCheckoutSuccess } from '../commerce-checkout-success/commerce-checkout-success.js';
import { handleStripePayment } from '../stripe-payment/stripe-payment.js';

preloadCheckoutSuccess();

function redirectToCartIfEmpty(cartData) {
  const isOrderPlaced = events.lastPayload('order/placed') !== undefined;

  if (!isOrderPlaced && (cartData === null || cartData?.items?.length === 0)) {
    window.location.href = rootLink('/cart');
  }
}

// A redirect-based wallet (PayPal, Revolut, …) freezes the page while an order
// placement is in flight. A back/forward cache restore of that page never
// re-fires drop-in events, so recovery is handled here instead.
watchForPageRestore(({ isPaymentConfirmationInProgress }) => {
  if (isPaymentConfirmationInProgress) {
    window.location.reload();
    return;
  }

  const cartData = events.lastPayload('cart/data') ?? events.lastPayload('cart/initialized');
  redirectToCartIfEmpty(cartData);
});

function renderLocalTestingNotice(container) {
  const isLocal = ['localhost', '127.0.0.1'].includes(
    window.location.hostname,
  );
  if (!isLocal) return null;

  const commands = h(
    'ul',
    { className: 'checkout__local-testing-commands' },
    h(
      'li',
      {},
      h('strong', {}, 'Windows: '),
      h(
        'code',
        {},
        'chrome.exe --user-data-dir="C:\\Chrome dev session" --disable-web-security',
      ),
    ),
    h(
      'li',
      {},
      h('strong', {}, 'macOS: '),
      h(
        'code',
        {},
        'open -n -a /Applications/Google\\ Chrome.app/Contents/MacOS/Google\\ Chrome --args --user-data-dir="/tmp/chrome_dev_test" --disable-web-security',
      ),
    ),
  );

  return UI.render(InLineAlert, {
    heading: 'Local checkout testing',
    description: 'CORS debugging may require Chrome with web security disabled. Use a dedicated profile only—do not browse normally in that session. This only bypasses browser CORS checks; Stripe Express Checkout still requires HTTPS and a registered domain.',
    type: 'warning',
    variant: 'primary',
    icon: h(Icon, { source: 'WarningWithCircle' }),
    itemList: commands,
    role: 'note',
  })(container);
}

export default async function decorate(block) {
  setMetaTags('Checkout');
  document.title = 'Checkout';

  const cartData = events.lastPayload('cart/initialized');
  redirectToCartIfEmpty(cartData);

  // Container and component references
  let shippingForm;
  let billingForm;
  let shippingAddresses;
  let billingAddresses;

  const shippingFormRef = { current: null };
  const billingFormRef = { current: null };
  const creditCardFormRef = { current: null };
  const loaderRef = { current: null };

  events.on('order/placed', () => {
    setMetaTags('Order Confirmation');
    document.title = 'Order Confirmation';
  });

  // Create the checkout layout using fragments
  const checkoutFragment = createCheckoutFragment();

  // Create scoped selector for the checkout fragment
  const getElement = createScopedSelector(checkoutFragment);

  // Get all checkout elements using centralized selectors
  const $content = getElement(selectors.checkout.content);
  const $loader = getElement(selectors.checkout.loader);
  const $loaderStatus = getElement(selectors.checkout.loaderStatus);
  const $mergedCartBanner = getElement(selectors.checkout.mergedCartBanner);
  const $heading = getElement(selectors.checkout.heading);
  const $localTestingNotice = getElement(
    selectors.checkout.localTestingNotice,
  );
  const $serverError = getElement(selectors.checkout.serverError);
  const $outOfStock = getElement(selectors.checkout.outOfStock);
  const $login = getElement(selectors.checkout.login);
  const $shippingForm = getElement(selectors.checkout.shippingForm);
  const $billToShipping = getElement(selectors.checkout.billToShipping);
  const $delivery = getElement(selectors.checkout.delivery);
  const $paymentMethods = getElement(selectors.checkout.paymentMethods);
  const $billingForm = getElement(selectors.checkout.billingForm);
  const $orderSummary = getElement(selectors.checkout.orderSummary);
  const $cartSummary = getElement(selectors.checkout.cartSummary);
  const $placeOrder = getElement(selectors.checkout.placeOrder);
  const $giftOptions = getElement(selectors.checkout.giftOptions);
  const $termsAndConditions = getElement(selectors.checkout.termsAndConditions);

  block.appendChild(checkoutFragment);

  const handleValidation = () => validateForms([
    { name: LOGIN_FORM_NAME },
    { name: SHIPPING_FORM_NAME, ref: shippingFormRef },
    { name: BILLING_FORM_NAME, ref: billingFormRef },
    { name: PURCHASE_ORDER_FORM_NAME },
    { name: TERMS_AND_CONDITIONS_FORM_NAME },
  ]);

  const handleExpressValidation = () => validateForms([
    { name: TERMS_AND_CONDITIONS_FORM_NAME },
  ]);

  // Magento-owned wallets rely on the checkout shipping form (including phone).
  // Amazon collects its own address, so that path keeps terms-only validation.
  const handleExpressShippingValidation = () => validateForms([
    { name: SHIPPING_FORM_NAME, ref: shippingFormRef },
    { name: BILLING_FORM_NAME, ref: billingFormRef },
  ]);

  const handlePlaceOrder = async ({ cartId, code }) => {
    await displayOverlaySpinner(loaderRef, $loader, $loaderStatus);
    beginPaymentConfirmation();
    try {
      await reuseCustomerAddresses(await getCart());
      // Payment Services credit card
      if (code === PaymentMethodCode.CREDIT_CARD) {
        if (!creditCardFormRef.current) {
          console.error('Credit card form not rendered.');
          return;
        }
        if (!creditCardFormRef.current.validate()) {
          // Credit card form invalid; abort order placement
          return;
        }
        // Submit Payment Services credit card form
        await creditCardFormRef.current.submit();
      }
      if (code === 'oope_stripe' && !await handleStripePayment(cartId)) {
        return;
      }
      // Place order
      await orderApi.placeOrder(cartId);
    } catch (error) {
      console.error(error);
      throw error;
    } finally {
      endPaymentConfirmation();
      removeOverlaySpinner(loaderRef, $loader, $loaderStatus);
    }
  };

  // First, render the place order component
  await renderPlaceOrder($placeOrder, { handleValidation, handlePlaceOrder });

  // Render the remaining containers
  const [
    _mergedCartBanner,
    _header,
    _localTestingNotice,
    _serverError,
    _outOfStock,
    _loginForm,
    shippingFormSkeleton,
    _billToShipping,
    _shippingMethods,
    _paymentMethods,
    billingFormSkeleton,
    _orderSummary,
    _cartSummary,
    _termsAndConditions,
    _giftOptions,
  ] = await Promise.all([
    renderMergedCartBanner($mergedCartBanner),

    renderCheckoutHeader($heading, 'Checkout'),

    renderLocalTestingNotice($localTestingNotice),

    renderServerError($serverError, $content),

    renderOutOfStock($outOfStock),

    renderLoginForm($login),

    renderShippingAddressFormSkeleton($shippingForm),

    renderBillToShippingAddress($billToShipping),

    renderShippingMethods($delivery),

    renderPaymentMethods($paymentMethods, creditCardFormRef, {
      handleExpressValidation,
      handleExpressShippingValidation,
    }),

    renderBillingAddressFormSkeleton($billingForm),

    renderOrderSummary($orderSummary),

    renderCartSummaryList($cartSummary),

    renderTermsAndConditions($termsAndConditions),

    renderGiftOptions($giftOptions),
  ]);

  async function initializeCheckout(data) {
    await initReCaptcha(0);
    if (data.isGuest) await displayGuestAddressForms(data);
    else {
      removeOverlaySpinner(loaderRef, $loader, $loaderStatus);
      await displayCustomerAddressForms(data);
    }
  }

  async function displayGuestAddressForms(data) {
    if (isVirtualCart(data)) {
      shippingForm?.remove();
      shippingForm = null;
      $shippingForm.innerHTML = '';
    } else if (!shippingForm) {
      shippingFormSkeleton.remove();

      shippingForm = await renderAddressForm($shippingForm, shippingFormRef, data, 'shipping');
    }

    if (!billingForm) {
      billingFormSkeleton.remove();

      billingForm = await renderAddressForm($billingForm, billingFormRef, data, 'billing');
    }
  }

  async function displayCustomerAddressForms(data) {
    if (isVirtualCart(data)) {
      shippingAddresses?.remove();
      shippingAddresses = null;
      $shippingForm.innerHTML = '';
    } else if (!shippingAddresses) {
      shippingForm?.remove();
      shippingForm = null;
      shippingFormRef.current = null;

      shippingAddresses = await renderCustomerShippingAddresses(
        $shippingForm,
        shippingFormRef,
        data,
      );
    }

    if (!billingAddresses) {
      billingForm?.remove();
      billingForm = null;
      billingFormRef.current = null;

      billingAddresses = await renderCustomerBillingAddresses(
        $billingForm,
        billingFormRef,
        data,
      );
    }
  }

  async function handleCheckoutUpdated(data) {
    if (!data) return;
    await initializeCheckout(data);
  }

  function handleAuthenticated(authenticated) {
    if (!authenticated) return;

    // When a customer creates an account on the checkout success page and then
    // signs in, they will be redirected to the order details page with the order
    // number as orderRef, allowing the order details to be displayed
    const orderData = events.lastPayload('order/placed');
    if (orderData) {
      const url = buildOrderDetailsUrl(orderData);
      window.history.replaceState({}, '', url);
    }

    window.location.reload();
  }

  function handleCheckoutValues(payload) {
    const { isBillToShipping } = payload;
    $billingForm.style.display = isBillToShipping ? 'none' : 'block';
  }

  async function handleOrderPlaced(orderData) {
    // Clear address form data
    sessionStorage.removeItem(SHIPPING_ADDRESS_DATA_KEY);
    sessionStorage.removeItem(BILLING_ADDRESS_DATA_KEY);

    const url = buildOrderDetailsUrl(orderData);

    // Replace instead of push so the browser back button from the order
    // confirmation cannot land on the consumed checkout page.
    window.history.replaceState({}, '', url);

    await renderCheckoutSuccess(block, { orderData });
  }

  events.on('authenticated', handleAuthenticated);
  events.on('checkout/initialized', handleCheckoutUpdated, { eager: true });
  events.on('checkout/updated', handleCheckoutUpdated);
  events.on('checkout/values', handleCheckoutValues);
  events.on('order/placed', handleOrderPlaced);
  events.on('cart/initialized', redirectToCartIfEmpty, { eager: true });
  events.on('cart/data', redirectToCartIfEmpty);
}
