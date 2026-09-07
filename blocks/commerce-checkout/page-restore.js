/**
 * Back/forward cache (bfcache) recovery for the checkout page.
 *
 * Redirect-based payment methods (PayPal, Revolut, …) navigate the browser
 * away while an order placement is in flight. The overlay spinner stays
 * mounted and the frozen page can later be restored from the back/forward
 * cache, where no drop-in events fire — the only signal a restore produces
 * is a `pageshow` event with `event.persisted` set to true.
 */

let paymentConfirmationInProgress = false;

/**
 * Flags an order placement as started so a later bfcache restore knows the
 * page was frozen mid-payment.
 */
export function beginPaymentConfirmation() {
  paymentConfirmationInProgress = true;
}

/**
 * Clears the in-flight flag once order placement finished without navigation.
 */
export function endPaymentConfirmation() {
  paymentConfirmationInProgress = false;
}

/**
 * Invokes the handler whenever the page is restored from the back/forward
 * cache. Normal loads and non-persistent `pageshow` events are ignored.
 * @param {Function} handler Called with the frozen payment state.
 */
export function watchForPageRestore(handler) {
  window.addEventListener('pageshow', (event) => {
    if (!event.persisted) return;
    handler({ isPaymentConfirmationInProgress: paymentConfirmationInProgress });
  });
}
