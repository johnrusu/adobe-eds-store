/* eslint-env node, jest */
/* eslint-disable quotes, indent, implicit-arrow-linebreak, no-confusing-arrow, import/extensions */
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const {
  inlineStripeHelpers,
  inlineBlockConstants,
} = require("../stripe-shared/stripe-helpers.harness");

const STRIPE_BLOCK_PATH = path.join(__dirname, "stripe-payment-ewcs.js");
const CHECKOUT_SESSION_URL = "https://commerce-config.example/checkout-session";

function flushPromises() {
  return new Promise((resolve) => {
    setImmediate(resolve);
  });
}

function createStorage(initialValues = {}) {
  const values = new Map(Object.entries(initialValues));

  return {
    getItem: jest.fn((key) => values.get(key) || null),
    setItem: jest.fn((key, value) => {
      values.set(key, String(value));
    }),
    removeItem: jest.fn((key) => {
      values.delete(key);
    }),
  };
}

function createElement(tagName) {
  const element = {
    tagName,
    children: [],
    id: "",
    className: "",
    textContent: "",
    innerHTML: "",
    parentElement: null,
    scrollIntoView: jest.fn(),
    classList: {
      add: jest.fn((className) => {
        element.className = [element.className, className]
          .filter(Boolean)
          .join(" ");
      }),
      remove: jest.fn((className) => {
        element.className = element.className
          .split(" ")
          .filter((value) => value && value !== className)
          .join(" ");
      }),
    },
    appendChild: jest.fn((child) => {
      child.parentElement = element;
      element.children.push(child);
      return child;
    }),
    remove: jest.fn(() => {
      if (!element.parentElement) {
        return;
      }
      element.parentElement.children = element.parentElement.children.filter(
        (child) => child !== element,
      );
      element.parentElement = null;
    }),
    closest: jest.fn((selector) => {
      const className = selector.startsWith(".") ? selector.slice(1) : selector;
      let current = element;
      while (current) {
        if ((current.className || "").split(" ").includes(className)) {
          return current;
        }
        current = current.parentElement;
      }
      return null;
    }),
    querySelector: jest.fn((selector) => findElement(element, selector)),
  };

  return element;
}

function findElement(root, selector) {
  const isIdSelector = selector.startsWith("#");
  const selectorValue = selector.slice(1);
  const matches = (element) => {
    if (isIdSelector) {
      return element.id === selectorValue;
    }
    return (element.className || "").split(" ").includes(selectorValue);
  };

  const stack = [...root.children];
  while (stack.length > 0) {
    const element = stack.shift();
    if (matches(element)) {
      return element;
    }
    stack.push(...element.children);
  }

  return null;
}

function createDocument() {
  const body = createElement("body");
  const head = createElement("head");

  return {
    body,
    head,
    cookie: "",
    createElement: jest.fn(createElement),
    querySelector: jest.fn((selector) => findElement(body, selector)),
  };
}

function transformStripeBlockSource(source) {
  return inlineBlockConstants(
    inlineStripeHelpers(source),
    path.join(__dirname, "constants.js"),
  )
    .replace(
      /import \{ events \} from ['"]@dropins\/tools\/event-bus\.js['"];/,
      "const { events } = __mocks;",
    )
    .replace(
      /import \* as checkoutApi from ['"]@dropins\/storefront-checkout\/api\.js['"];/,
      "const { checkoutApi } = __mocks;",
    )
    .replace(
      /import \{ loadCSS \} from ['"]\.\.\/\.\.\/scripts\/aem\.js['"];/,
      "const { loadCSS } = __mocks;",
    )
    .replace(
      /export \{\s*renderStripePaymentMethod,\s*handleStripePayment,\s*validateStripePayment,\s*\};/,
      "Object.assign(__exports, { renderStripePaymentMethod, handleStripePayment, validateStripePayment });",
    )
    .replace(
      "export default function decorate(block) {",
      "function decorate(block) {",
    )
    .concat("\n__exports.default = decorate;\n");
}

function checkoutSessionPayload(overrides = {}) {
  return {
    id: "cs_test_1",
    client_secret: "cs_test_1_secret_abc",
    return_url:
      "https://runtime.example/checkout-session-return?cart_id=cart_123&checkout_session_id={CHECKOUT_SESSION_ID}",
    authenticated: false,
    email_required: false,
    publishableKey: "pk_test_123",
    options: { locale: "auto" },
    appInfo: { name: "Stripe Adobe Commerce App Builder" },
    ...overrides,
  };
}

function checkoutSessionResponse(payload = checkoutSessionPayload()) {
  return { ok: true, json: async () => payload };
}

function checkoutSessionErrorResponse(status, body) {
  return { ok: false, status, json: async () => body };
}

function createPaymentElement() {
  const paymentElement = {
    mount: jest.fn(),
    on: jest.fn(),
    update: jest.fn(),
    destroy: jest.fn(),
    handlers: {},
  };
  paymentElement.on.mockImplementation((eventName, handler) => {
    paymentElement.handlers[eventName] = handler;
  });
  return paymentElement;
}

function loadStripePaymentBlock({
  onCheckoutSession = () => checkoutSessionResponse(),
  stripeLoaded = true,
  supportsCheckoutSessions = true,
  initCheckoutError = null,
  sharedLoadingPromise = undefined,
} = {}) {
  const handlers = new Map();
  const lastPayloads = new Map();

  const events = {
    on: jest.fn((eventName, handler, options = {}) => {
      handlers.set(eventName, [...(handlers.get(eventName) || []), handler]);
      if (options.eager && lastPayloads.has(eventName)) {
        handler(lastPayloads.get(eventName));
      }
    }),
    lastPayload: jest.fn((eventName) => lastPayloads.get(eventName)),
    emit: async (eventName, payload) => {
      lastPayloads.set(eventName, payload);
      await Promise.all(
        (handlers.get(eventName) || []).map((handler) => handler(payload)),
      );
      await flushPromises();
    },
  };

  const document = createDocument();
  const localStorage = createStorage({ "store-view": "de_store" });
  const sessionStorage = createStorage();

  // One Payment Element, actions object and Checkout SDK instance per mounted session.
  const paymentElements = [];
  const checkouts = [];
  const confirm = jest
    .fn()
    .mockResolvedValue({ type: "success", session: { id: "cs_test_1" } });
  const getSession = jest.fn(() => ({
    total: { total: { amount: "$42.00", minorUnitsAmount: 4200 } },
  }));
  let loadActionsResult = () => ({
    type: "success",
    actions: { confirm, getSession },
  });

  const stripeInstance = {
    registerAppInfo: jest.fn(),
    elements: jest.fn(),
    confirmPayment: jest.fn(),
  };
  if (supportsCheckoutSessions) {
    stripeInstance.initCheckoutElementsSdk = jest.fn(() => {
      if (initCheckoutError) {
        throw initCheckoutError;
      }

      const checkout = {
        loadActions: jest.fn(async () => loadActionsResult()),
        createPaymentElement: jest.fn(() => {
          const paymentElement = createPaymentElement();
          paymentElements.push(paymentElement);
          return paymentElement;
        }),
      };
      checkouts.push(checkout);
      return checkout;
    });
  }

  const timers = [];
  const fetch = jest.fn(async (url, options) => {
    if (url === CHECKOUT_SESSION_URL) {
      return onCheckoutSession(options);
    }

    throw new Error(`Unexpected fetch URL: ${url}`);
  });

  const context = {
    __exports: {},
    __mocks: {
      events,
      checkoutApi: {
        setPaymentMethod: jest.fn().mockResolvedValue({ success: true }),
      },
      loadCSS: jest.fn(),
    },
    AbortController,
    console,
    document,
    fetch,
    requestAnimationFrame: (callback) => callback(),
    setTimeout: jest.fn(),
    URL,
    URLSearchParams,
    window: {
      location: { search: "" },
      localStorage,
      sessionStorage,
      setTimeout: jest.fn((callback, delay) => {
        timers.push({ callback, delay, cleared: false });
        return timers.length;
      }),
      clearTimeout: jest.fn((timerId) => {
        if (timers[timerId - 1]) {
          timers[timerId - 1].cleared = true;
        }
      }),
      ...(sharedLoadingPromise
        ? { __stripeJsLoadingPromise: sharedLoadingPromise }
        : {}),
    },
  };
  if (stripeLoaded) {
    context.Stripe = jest.fn(() => stripeInstance);
  }

  vm.createContext(context);
  const source = transformStripeBlockSource(
    fs.readFileSync(STRIPE_BLOCK_PATH, "utf8"),
  );
  new vm.Script(source, { filename: STRIPE_BLOCK_PATH }).runInContext(context);

  return {
    exports: context.__exports,
    mocks: context.__mocks,
    context,
    events,
    document,
    window: context.window,
    localStorage,
    fetch,
    timers,
    checkouts,
    paymentElements,
    confirm,
    getSession,
    stripeInstance,
    Stripe: context.Stripe,
    setLoadActionsResult: (result) => {
      loadActionsResult = () => result;
    },
    emitPaymentComplete: () =>
      paymentElements[paymentElements.length - 1].handlers.change({
        complete: true,
      }),
    // Run the pending debounced session refresh, as the browser would after the delay.
    runSessionSyncTimer: async () => {
      const pending = timers.filter(
        (timer) => timer.delay === 500 && !timer.cleared && !timer.ran,
      );
      pending.forEach((timer) => {
        timer.ran = true;
        timer.callback();
      });
      await flushPromises();
      return pending.length;
    },
    checkoutSessionCalls: () =>
      fetch.mock.calls.filter(([url]) => url === CHECKOUT_SESSION_URL),
    errorText: () =>
      document.querySelector(".stripe-error")?.textContent || null,
    cartIncompleteText: () =>
      document.querySelector(".stripe-cart-incomplete")?.textContent || null,
  };
}

function shippingMethodPayload(amount = 5) {
  return {
    carrier: { code: "flatrate" },
    code: "flatrate",
    amount: { value: amount, currency: "USD" },
  };
}

function checkoutPayload(overrides = {}) {
  return {
    email: "customer@example.com",
    availablePaymentMethods: [
      {
        code: "oope_stripe",
        oope_payment_method_config: {
          backend_integration_url: JSON.stringify({
            getInitParamsUrl: "https://commerce-config.example/init-params",
            createPaymentIntentUrl:
              "https://commerce-config.example/payment-intent",
          }),
        },
      },
    ],
    billingAddress: {
      firstName: "Ada",
      lastName: "Lovelace",
      telephone: "",
      street: ["1 Algorithm Way", ""],
      city: "London",
      region: { code: "" },
      country: { code: "GB" },
      postcode: "SW1A 1AA",
    },
    shippingAddress: {
      firstName: "Ada",
      lastName: "Lovelace",
      telephone: "020 7946 0000",
      street: ["1 Algorithm Way", ""],
      city: "London",
      region: { code: "" },
      country: { code: "GB" },
      postcode: "SW1A 1AA",
      selectedShippingMethod: shippingMethodPayload(),
    },
    ...overrides,
  };
}

function cartPayload({ value = 42, currency = "USD" } = {}) {
  return {
    id: "cart_123",
    total: { includingTax: { value, currency } },
  };
}

function createCtx(block) {
  return {
    replaceHTML: jest.fn((content) => {
      block.document.body.appendChild(content);
    }),
  };
}

// Checkout and cart data arrive before the slot renders, as on the real page.
async function renderAndMount(
  block,
  { cart = cartPayload(), checkout = checkoutPayload() } = {},
) {
  await block.events.emit("checkout/initialized", checkout);
  await block.events.emit("cart/initialized", cart);

  block.exports.renderStripePaymentMethod(createCtx(block));
  await flushPromises();
}

describe("stripe-payment-ewcs EDS block", () => {
  let expectedConsoleErrors;

  beforeEach(() => {
    expectedConsoleErrors = 0;
    jest.spyOn(console, "error").mockImplementation(() => {});
    jest.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    expect(console.error).toHaveBeenCalledTimes(expectedConsoleErrors);
    console.error.mockRestore();
    console.warn.mockRestore();
  });

  describe("mounting", () => {
    test("mounts the Payment Element from a Checkout Session of the cart", async () => {
      const block = loadStripePaymentBlock();

      await renderAndMount(block);

      expect(block.checkoutSessionCalls()).toHaveLength(1);
      const [, request] = block.checkoutSessionCalls()[0];
      expect(request.method).toBe("POST");
      expect(JSON.parse(request.body)).toEqual({
        cartId: "cart_123",
        cartFullName: "Ada Lovelace",
      });
      expect(request.headers).toEqual({
        "Content-Type": "application/json",
        Store: "de_store",
      });

      expect(block.Stripe).toHaveBeenCalledTimes(1);
      expect(block.Stripe).toHaveBeenCalledWith("pk_test_123", {
        locale: "auto",
      });
      expect(block.stripeInstance.registerAppInfo).toHaveBeenCalledWith({
        name: "Stripe Adobe Commerce App Builder",
      });
      expect(block.stripeInstance.initCheckoutElementsSdk).toHaveBeenCalledWith(
        {
          clientSecret: "cs_test_1_secret_abc",
          adaptivePricing: { allowed: false },
          elementsOptions: {
            savedPaymentMethod: {
              enableSave: "never",
              enableRedisplay: "never",
            },
          },
        },
      );
      expect(block.checkouts[0].createPaymentElement).toHaveBeenCalledWith({
        layout: "accordion",
        fields: {
          billingDetails: {
            name: "never",
            email: "never",
            phone: "auto",
            address: "never",
          },
        },
      });
      expect(block.paymentElements[0].mount).toHaveBeenCalledWith(
        "#stripe-elements-container",
      );
      expect(
        block.document.querySelector("#stripe-elements-container").className,
      ).not.toContain("stripe-elements-loading");
    });

    test("uses the Checkout Session flow only: no deferred Elements, PaymentIntent or init-params call", async () => {
      const block = loadStripePaymentBlock();

      await renderAndMount(block);

      expect(block.fetch).toHaveBeenCalledTimes(1);
      expect(block.fetch.mock.calls[0][0]).toBe(CHECKOUT_SESSION_URL);
      expect(block.stripeInstance.elements).not.toHaveBeenCalled();
      expect(block.mocks.checkoutApi.setPaymentMethod).not.toHaveBeenCalled();
    });

    test("loads its stylesheet and the Stripe.js release that supports Checkout Sessions in Elements mode", async () => {
      const block = loadStripePaymentBlock({ stripeLoaded: false });

      // Loading starts on import, before any checkout event, and the loading
      // promise is shared with the other Stripe blocks on the page.
      expect(block.document.head.children).toHaveLength(1);
      expect(typeof block.window.__stripeJsLoadingPromise?.then).toBe("function");

      await block.events.emit("checkout/initialized", checkoutPayload());

      expect(block.mocks.loadCSS).toHaveBeenCalledWith(
        "/blocks/stripe-payment-ewcs/stripe-payment-ewcs.css",
      );
      expect(block.document.head.children).toHaveLength(1);
      expect(block.document.head.children[0].src).toBe(
        "https://js.stripe.com/dahlia/stripe.js",
      );
    });

    test("reuses the Stripe.js load another Stripe block started first", async () => {
      const block = loadStripePaymentBlock({
        stripeLoaded: false,
        sharedLoadingPromise: new Promise(() => {}),
      });

      await block.events.emit("checkout/initialized", checkoutPayload());

      expect(block.document.head.children).toHaveLength(0);
    });

    test("forwards the authenticated customer token", async () => {
      const block = loadStripePaymentBlock();
      block.document.cookie = "auth_dropin_user_token=customer%20token";

      await renderAndMount(block);

      expect(block.checkoutSessionCalls()[0][1].headers.Authorization).toBe(
        "Bearer customer token",
      );
    });

    test("shows what the cart lacks while it is incomplete, then mounts", async () => {
      let incomplete = true;
      const block = loadStripePaymentBlock({
        onCheckoutSession: () =>
          incomplete
            ? checkoutSessionErrorResponse(400, {
                error:
                  "Cart email is required to save payment method. Please set the email on the cart.",
                code: "cart_incomplete",
              })
            : checkoutSessionResponse(),
      });

      await renderAndMount(block);

      expect(block.paymentElements).toHaveLength(0);
      expect(block.errorText()).toBeNull();
      expect(block.cartIncompleteText()).toBe(
        "Cart email is required to save payment method. Please set the email on the cart. The payment form loads once the checkout details above are complete.",
      );
      expect(
        block.document.querySelector("#stripe-elements-container").className,
      ).not.toContain("stripe-elements-loading");

      incomplete = false;
      const callsBeforeUpdate = block.checkoutSessionCalls().length;
      await block.events.emit("checkout/updated", checkoutPayload());

      // The update waits for the checkout to settle, as for a mounted form.
      expect(block.checkoutSessionCalls()).toHaveLength(callsBeforeUpdate);
      await block.runSessionSyncTimer();

      expect(block.paymentElements).toHaveLength(1);
      expect(block.paymentElements[0].mount).toHaveBeenCalled();
    });

    test("does not send a request for each field while the cart is incomplete", async () => {
      const block = loadStripePaymentBlock({
        onCheckoutSession: () =>
          checkoutSessionErrorResponse(400, {
            error:
              "Customer name is required to create a payment for this cart.",
            code: "cart_incomplete",
          }),
      });
      await renderAndMount(block);

      await block.events.emit(
        "checkout/updated",
        checkoutPayload({ email: "a" }),
      );
      await block.events.emit(
        "checkout/updated",
        checkoutPayload({ email: "ad" }),
      );
      await block.events.emit(
        "checkout/updated",
        checkoutPayload({ email: "ada" }),
      );
      await block.runSessionSyncTimer();

      // The slot render, then one request for the settled form.
      expect(block.checkoutSessionCalls()).toHaveLength(2);
      // Each answer updates the one notice.
      expect(
        block.document.querySelector("#stripe-elements-container").children,
      ).toHaveLength(1);
      expect(block.cartIncompleteText()).toBe(
        "Customer name is required to create a payment for this cart. The payment form loads once the checkout details above are complete.",
      );
    });

    test("sends no request until a guest has entered an email and a name", async () => {
      const block = loadStripePaymentBlock();
      const emptyAddress = { firstName: "", lastName: "" };

      await renderAndMount(block, {
        checkout: checkoutPayload({
          email: "",
          billingAddress: emptyAddress,
          shippingAddress: emptyAddress,
        }),
      });
      await block.runSessionSyncTimer();

      expect(block.checkoutSessionCalls()).toHaveLength(0);
      expect(block.errorText()).toBeNull();
      expect(block.cartIncompleteText()).toBe(
        "The payment form loads once the checkout details above are complete.",
      );

      // The email alone is not enough.
      await block.events.emit(
        "checkout/updated",
        checkoutPayload({
          billingAddress: emptyAddress,
          shippingAddress: emptyAddress,
        }),
      );
      await block.runSessionSyncTimer();
      expect(block.checkoutSessionCalls()).toHaveLength(0);

      await block.events.emit("checkout/updated", checkoutPayload());
      await block.runSessionSyncTimer();

      expect(block.checkoutSessionCalls()).toHaveLength(1);
      expect(block.paymentElements).toHaveLength(1);
    });

    test("does not wait for contact details when the customer is logged in", async () => {
      const block = loadStripePaymentBlock();
      block.document.cookie = "auth_dropin_user_token=customer%20token";
      const emptyAddress = { firstName: "", lastName: "" };

      await renderAndMount(block, {
        checkout: checkoutPayload({
          email: "",
          billingAddress: emptyAddress,
          shippingAddress: {
            ...emptyAddress,
            selectedShippingMethod: shippingMethodPayload(),
          },
        }),
      });

      expect(block.checkoutSessionCalls()).toHaveLength(1);
      expect(block.paymentElements).toHaveLength(1);
    });

    test("waits for the shipping address and method, also for a logged-in customer", async () => {
      const block = loadStripePaymentBlock();
      block.document.cookie = "auth_dropin_user_token=customer%20token";
      const noMethod = {
        ...checkoutPayload().shippingAddress,
        selectedShippingMethod: undefined,
      };

      await renderAndMount(block, {
        checkout: checkoutPayload({ shippingAddress: noMethod }),
      });
      await block.runSessionSyncTimer();

      // The total is not final until the shipping method is selected.
      expect(block.checkoutSessionCalls()).toHaveLength(0);
      expect(block.errorText()).toBeNull();
      expect(block.cartIncompleteText()).toBe(
        "The payment form loads once the checkout details above are complete.",
      );

      await block.events.emit("checkout/updated", checkoutPayload());
      await block.runSessionSyncTimer();

      expect(block.checkoutSessionCalls()).toHaveLength(1);
      expect(block.paymentElements).toHaveLength(1);
    });

    test("reads the shipping address from the shipping addresses list of the checkout", async () => {
      const block = loadStripePaymentBlock();
      // The Checkout drop-in reports the address in this list, not as a single address.
      const listed = checkoutPayload({
        shippingAddress: undefined,
        shippingAddresses: [checkoutPayload().shippingAddress],
      });

      await renderAndMount(block, { checkout: listed });

      expect(block.checkoutSessionCalls()).toHaveLength(1);
      expect(block.paymentElements).toHaveLength(1);

      // The listed address reaches the confirmation of a cart that ships.
      block.emitPaymentComplete();
      await block.exports.handleStripePayment("cart_123");
      expect(block.confirm.mock.calls[0][0].shippingAddress).toEqual({
        name: "Ada Lovelace",
        address: expect.objectContaining({ line1: "1 Algorithm Way", country: "GB" }),
      });
    });

    test("does not wait for a shipping method on a virtual cart", async () => {
      const block = loadStripePaymentBlock();

      await renderAndMount(block, {
        checkout: checkoutPayload({ isVirtual: true, shippingAddress: undefined }),
      });

      expect(block.checkoutSessionCalls()).toHaveLength(1);
      expect(block.paymentElements).toHaveLength(1);
    });

    test("replaces the session when the shipping method changes, before the cart total does", async () => {
      const block = loadStripePaymentBlock({
        onCheckoutSession: (() => {
          let count = 0;
          return () => {
            count += 1;
            return checkoutSessionResponse(
              checkoutSessionPayload({
                id: `cs_test_${count}`,
                client_secret: `cs_test_${count}_secret_abc`,
              }),
            );
          };
        })(),
      });
      await renderAndMount(block);
      expect(block.paymentElements).toHaveLength(1);

      // The cart event with the new total comes later; the checkout reports the method first.
      await block.events.emit(
        "checkout/updated",
        checkoutPayload({
          shippingAddress: {
            ...checkoutPayload().shippingAddress,
            selectedShippingMethod: shippingMethodPayload(9),
          },
        }),
      );
      await block.runSessionSyncTimer();

      expect(block.checkoutSessionCalls()).toHaveLength(2);
      expect(block.paymentElements).toHaveLength(2);
    });

    test("shows the session total Stripe requires before confirmation", async () => {
      const block = loadStripePaymentBlock();
      await renderAndMount(block);

      expect(block.getSession).toHaveBeenCalled();
      expect(
        block.document.querySelector(".stripe-checkout-total-label").textContent,
      ).toBe("Amount due");
      expect(
        block.document.querySelector(".stripe-checkout-total-amount").textContent,
      ).toBe("$42.00");
    });

    test("shows an error when the session cannot be created", async () => {
      expectedConsoleErrors = 1;
      const block = loadStripePaymentBlock({
        onCheckoutSession: () =>
          checkoutSessionErrorResponse(500, { error: "server error" }),
      });

      await renderAndMount(block);

      expect(block.paymentElements).toHaveLength(0);
      expect(block.errorText()).toBe(
        "Unable to load payment form. Please refresh and try again.",
      );
      expect(
        block.document.querySelector("#stripe-elements-container").className,
      ).not.toContain("stripe-elements-loading");
    });

    test("shows an error when the loaded Stripe.js cannot run Checkout Sessions in Elements mode", async () => {
      expectedConsoleErrors = 1;
      const block = loadStripePaymentBlock({ supportsCheckoutSessions: false });

      await renderAndMount(block);

      expect(block.paymentElements).toHaveLength(0);
      expect(block.errorText()).toBe(
        "Unable to load payment form. Please refresh and try again.",
      );
      expect(console.error.mock.calls[0][1].message).toContain(
        "https://js.stripe.com/dahlia/stripe.js",
      );
    });

    test("shows an error when the loaded Stripe.js is the v3 release, which has the method but refuses to run it", async () => {
      expectedConsoleErrors = 1;
      // What js.stripe.com/v3/ throws from initCheckoutElementsSdk (observed 2026-11-12).
      const v3Error = new Error(
        "You must upgrade to the Basil release or higher to use initCheckout. Read more about versioning: https://docs.stripe.com/sdks/stripejs-versioning",
      );
      v3Error.name = "IntegrationError";
      const block = loadStripePaymentBlock({ initCheckoutError: v3Error });

      await renderAndMount(block);

      expect(block.paymentElements).toHaveLength(0);
      // The shopper sees the generic message; the console has Stripe's own error.
      expect(block.errorText()).toBe(
        "Unable to load payment form. Please refresh and try again.",
      );
      expect(console.error.mock.calls[0][1]).toBe(v3Error);
    });

    test("shows an error when Stripe cannot load the session", async () => {
      expectedConsoleErrors = 1;
      const block = loadStripePaymentBlock();
      block.setLoadActionsResult({
        type: "error",
        error: { message: "This Checkout Session has expired." },
      });

      await renderAndMount(block);

      expect(block.paymentElements).toHaveLength(0);
      expect(block.errorText()).toBe(
        "Unable to load payment form. Please refresh and try again.",
      );
    });

    test("does not request a session when Stripe is not an available payment method", async () => {
      const block = loadStripePaymentBlock();

      await renderAndMount(block, {
        checkout: checkoutPayload({
          availablePaymentMethods: [{ code: "checkmo" }],
        }),
      });

      expect(block.fetch).not.toHaveBeenCalled();
    });
  });

  describe("cart changes", () => {
    test("replaces the Payment Element when the cart total changes the session", async () => {
      let payload = checkoutSessionPayload();
      const block = loadStripePaymentBlock({
        onCheckoutSession: () => checkoutSessionResponse(payload),
      });
      await renderAndMount(block);

      payload = checkoutSessionPayload({
        id: "cs_test_2",
        client_secret: "cs_test_2_secret_def",
      });
      await block.events.emit("cart/updated", cartPayload({ value: 47 }));

      // The refresh waits for the checkout to settle.
      expect(block.checkoutSessionCalls()).toHaveLength(1);
      expect(await block.runSessionSyncTimer()).toBe(1);

      expect(block.checkoutSessionCalls()).toHaveLength(2);
      expect(block.paymentElements[0].destroy).toHaveBeenCalled();
      expect(
        block.stripeInstance.initCheckoutElementsSdk,
      ).toHaveBeenLastCalledWith(
        expect.objectContaining({ clientSecret: "cs_test_2_secret_def" }),
      );
      expect(block.paymentElements[1].mount).toHaveBeenCalledWith(
        "#stripe-elements-container",
      );
      // One Stripe.js instance serves every session.
      expect(block.Stripe).toHaveBeenCalledTimes(1);
      expect(block.exports.validateStripePayment()).toBe(false);
    });

    test("keeps the Payment Element when App Builder answers with the same session", async () => {
      const block = loadStripePaymentBlock();
      await renderAndMount(block);

      await block.events.emit(
        "checkout/updated",
        checkoutPayload({ email: "other@example.com" }),
      );
      await block.runSessionSyncTimer();

      expect(block.checkoutSessionCalls()).toHaveLength(2);
      expect(block.paymentElements).toHaveLength(1);
      expect(block.paymentElements[0].destroy).not.toHaveBeenCalled();
    });

    test("does not request a session for updates that leave the total, email and shipping address unchanged", async () => {
      const block = loadStripePaymentBlock();
      await renderAndMount(block);

      await block.events.emit("cart/updated", cartPayload());
      await block.events.emit("checkout/updated", checkoutPayload());

      expect(await block.runSessionSyncTimer()).toBe(0);
      expect(block.checkoutSessionCalls()).toHaveLength(1);
    });

    test("checks the session again when the shipping address changes the total does not", async () => {
      const block = loadStripePaymentBlock();
      await renderAndMount(block);

      await block.events.emit(
        "checkout/updated",
        checkoutPayload({
          shippingAddress: {
            ...checkoutPayload().shippingAddress,
            country: { code: "NL" },
            postcode: "1012 AB",
          },
        }),
      );

      expect(await block.runSessionSyncTimer()).toBe(1);
      expect(block.checkoutSessionCalls()).toHaveLength(2);
    });

    test("collapses a burst of updates into one refresh", async () => {
      const block = loadStripePaymentBlock();
      await renderAndMount(block);

      await block.events.emit("cart/updated", cartPayload({ value: 45 }));
      await block.events.emit("cart/updated", cartPayload({ value: 47 }));
      await block.events.emit("cart/updated", cartPayload({ value: 49 }));

      expect(await block.runSessionSyncTimer()).toBe(1);
      expect(block.checkoutSessionCalls()).toHaveLength(2);
    });

    test("keeps the mounted form when a refresh fails", async () => {
      let fail = false;
      const block = loadStripePaymentBlock({
        onCheckoutSession: () =>
          fail
            ? checkoutSessionErrorResponse(500, { error: "server error" })
            : checkoutSessionResponse(),
      });
      await renderAndMount(block);

      fail = true;
      await block.events.emit("cart/updated", cartPayload({ value: 47 }));
      await block.runSessionSyncTimer();

      expect(block.paymentElements).toHaveLength(1);
      expect(block.paymentElements[0].destroy).not.toHaveBeenCalled();
      expect(block.errorText()).toBeNull();
    });
  });

  describe("placing the order", () => {
    async function mountCompleteForm(block, options) {
      await renderAndMount(block, options);
      block.emitPaymentComplete();
    }

    test("verifies the session, stores its client secret on the cart, then confirms", async () => {
      const block = loadStripePaymentBlock();
      await mountCompleteForm(block);

      const result = await block.exports.handleStripePayment("cart_123");

      expect(result).toBe(true);
      // Mount + the check that the session still matches the cart.
      expect(block.checkoutSessionCalls()).toHaveLength(2);
      expect(block.mocks.checkoutApi.setPaymentMethod).toHaveBeenCalledWith({
        code: "oope_stripe",
        additional_data: [
          { key: "client_secret", value: "cs_test_1_secret_abc" },
        ],
      });
      expect(block.confirm).toHaveBeenCalledTimes(1);
      expect(block.confirm).toHaveBeenCalledWith({
        redirect: "if_required",
        billingAddress: {
          name: "Ada Lovelace",
          address: {
            line1: "1 Algorithm Way",
            city: "London",
            country: "GB",
            postal_code: "SW1A 1AA",
          },
        },
        shippingAddress: {
          name: "Ada Lovelace",
          address: {
            line1: "1 Algorithm Way",
            city: "London",
            country: "GB",
            postal_code: "SW1A 1AA",
          },
        },
      });
      expect(
        block.mocks.checkoutApi.setPaymentMethod.mock.invocationCallOrder[0],
      ).toBeLessThan(block.confirm.mock.invocationCallOrder[0]);
      expect(block.errorText()).toBeNull();
    });

    test("passes the email on confirmation only when the session has none", async () => {
      const block = loadStripePaymentBlock({
        onCheckoutSession: () =>
          checkoutSessionResponse(
            checkoutSessionPayload({ email_required: true }),
          ),
      });
      await mountCompleteForm(block);

      await block.exports.handleStripePayment("cart_123");

      expect(block.confirm.mock.calls[0][0].email).toBe("customer@example.com");
    });

    test("does not confirm an incomplete payment form", async () => {
      const block = loadStripePaymentBlock();
      await renderAndMount(block);

      const result = await block.exports.handleStripePayment("cart_123");

      expect(result).toBe(false);
      expect(block.errorText()).toBe("Please complete your payment details");
      expect(block.checkoutSessionCalls()).toHaveLength(1);
      expect(block.confirm).not.toHaveBeenCalled();
    });

    test("fails validation while Stripe is selected and its form has not loaded", async () => {
      const block = loadStripePaymentBlock({
        onCheckoutSession: () =>
          checkoutSessionErrorResponse(400, {
            error: "Complete shipping address is required.",
            code: "cart_incomplete",
          }),
      });
      await renderAndMount(block, {
        checkout: checkoutPayload({
          selectedPaymentMethod: { code: "oope_stripe" },
        }),
      });

      expect(block.paymentElements).toHaveLength(0);
      expect(block.exports.validateStripePayment()).toBe(false);

      await block.events.emit(
        "checkout/updated",
        checkoutPayload({ selectedPaymentMethod: { code: "checkmo" } }),
      );

      expect(block.exports.validateStripePayment()).toBe(true);
    });

    test("does not confirm a session the cart no longer matches", async () => {
      let payload = checkoutSessionPayload();
      const block = loadStripePaymentBlock({
        onCheckoutSession: () => checkoutSessionResponse(payload),
      });
      await mountCompleteForm(block);

      // The cart changed without the block having refreshed the session.
      payload = checkoutSessionPayload({
        id: "cs_test_2",
        client_secret: "cs_test_2_secret_def",
      });
      const result = await block.exports.handleStripePayment("cart_123");

      expect(result).toBe(false);
      expect(block.confirm).not.toHaveBeenCalled();
      expect(block.mocks.checkoutApi.setPaymentMethod).not.toHaveBeenCalled();
      expect(block.paymentElements).toHaveLength(2);
      expect(block.paymentElements[0].destroy).toHaveBeenCalled();
      expect(block.errorText()).toBe(
        "Your order details changed. Please enter your payment details again.",
      );

      // The next attempt pays with the current session.
      block.emitPaymentComplete();
      expect(await block.exports.handleStripePayment("cart_123")).toBe(true);
      expect(block.mocks.checkoutApi.setPaymentMethod).toHaveBeenCalledWith({
        code: "oope_stripe",
        additional_data: [
          { key: "client_secret", value: "cs_test_2_secret_def" },
        ],
      });
    });

    test("shows the App Builder message when the cart was already paid", async () => {
      let paid = false;
      const block = loadStripePaymentBlock({
        onCheckoutSession: () =>
          paid
            ? checkoutSessionErrorResponse(409, {
                error: "Payment was already processed for this cart.",
                code: "stale_paid_cart_requires_reset",
              })
            : checkoutSessionResponse(),
      });
      await mountCompleteForm(block);

      paid = true;
      const result = await block.exports.handleStripePayment("cart_123");

      expect(result).toBe(false);
      expect(block.errorText()).toBe(
        "Payment was already processed for this cart.",
      );
      expect(block.confirm).not.toHaveBeenCalled();
    });

    test("shows why the form could not load when the cart is still incomplete", async () => {
      const block = loadStripePaymentBlock({
        onCheckoutSession: () =>
          checkoutSessionErrorResponse(400, {
            error:
              "Complete shipping address is required to save the payment method for this cart.",
            code: "cart_incomplete",
          }),
      });
      await renderAndMount(block, {
        checkout: checkoutPayload({
          selectedPaymentMethod: { code: "oope_stripe" },
        }),
      });

      const result = await block.exports.handleStripePayment("cart_123");

      expect(result).toBe(false);
      expect(block.errorText()).toBe(
        "Complete shipping address is required to save the payment method for this cart.",
      );
    });

    test("does not confirm when the payment method cannot be stored on the cart", async () => {
      const block = loadStripePaymentBlock();
      block.mocks.checkoutApi.setPaymentMethod.mockResolvedValue(null);
      await mountCompleteForm(block);

      const result = await block.exports.handleStripePayment("cart_123");

      expect(result).toBe(false);
      expect(block.errorText()).toBe("Failed to set the payment method.");
      expect(block.confirm).not.toHaveBeenCalled();
    });

    test.each([
      [
        "an error result",
        (confirm) =>
          confirm.mockResolvedValue({
            type: "error",
            error: { message: "Your card was declined." },
          }),
        "Your card was declined.",
      ],
      [
        "a rejected confirmation",
        (confirm) => confirm.mockRejectedValue(new Error("Network error")),
        "Network error",
      ],
    ])("stops order placement on %s", async (name, arrange, message) => {
      const block = loadStripePaymentBlock();
      arrange(block.confirm);
      await mountCompleteForm(block);

      const result = await block.exports.handleStripePayment("cart_123");

      expect(result).toBe(false);
      expect(block.errorText()).toBe(message);
    });

    test("stops requesting sessions once the payment is confirmed", async () => {
      const block = loadStripePaymentBlock();
      await mountCompleteForm(block);
      expect(await block.exports.handleStripePayment("cart_123")).toBe(true);
      const callsAfterConfirm = block.checkoutSessionCalls().length;

      // Commerce replaces the cart while the storefront places the order.
      await block.events.emit("cart/updated", cartPayload({ value: 0 }));
      await block.runSessionSyncTimer();

      expect(block.checkoutSessionCalls()).toHaveLength(callsAfterConfirm);
    });
  });

  test("starts over when the payment method slot is rendered again", async () => {
    const block = loadStripePaymentBlock();
    await renderAndMount(block);
    block.emitPaymentComplete();

    block.exports.renderStripePaymentMethod(createCtx(block));
    await flushPromises();

    expect(block.paymentElements[0].destroy).toHaveBeenCalled();
    expect(block.paymentElements).toHaveLength(2);
    expect(block.exports.validateStripePayment()).toBe(false);
  });

  test("mounts the form when the slot renders again while the first session request is pending", async () => {
    let resolveFirstRequest;
    let requestCount = 0;
    const block = loadStripePaymentBlock({
      onCheckoutSession: () => {
        requestCount += 1;
        if (requestCount === 1) {
          return new Promise((resolve) => {
            resolveFirstRequest = () => resolve(checkoutSessionResponse());
          });
        }
        return checkoutSessionResponse();
      },
    });
    await block.events.emit("checkout/initialized", checkoutPayload());
    await block.events.emit("cart/initialized", cartPayload());

    block.exports.renderStripePaymentMethod(createCtx(block));
    await flushPromises();
    // The checkout re-renders the slot before App Builder answers.
    block.exports.renderStripePaymentMethod(createCtx(block));
    await flushPromises();
    expect(block.paymentElements).toHaveLength(0);

    resolveFirstRequest();
    await flushPromises();
    await flushPromises();

    expect(block.checkoutSessionCalls()).toHaveLength(2);
    expect(block.paymentElements).toHaveLength(1);
    expect(block.paymentElements[0].mount).toHaveBeenCalledWith(
      "#stripe-elements-container",
    );
  });

  test("keeps the session while a confirmation is in progress, then applies the updates", async () => {
    const block = loadStripePaymentBlock({
      onCheckoutSession: () => checkoutSessionResponse(),
    });
    await renderAndMount(block);
    block.emitPaymentComplete();

    let finishConfirmation;
    block.confirm.mockImplementation(
      () =>
        new Promise((resolve) => {
          finishConfirmation = () =>
            resolve({ type: "error", error: { message: "Declined" } });
        }),
    );

    const placing = block.exports.handleStripePayment("cart_123");
    await flushPromises();
    const callsDuringConfirmation = block.checkoutSessionCalls().length;

    // A 3D Secure challenge is open while the checkout publishes updates.
    await block.events.emit("cart/updated", cartPayload({ value: 55 }));
    expect(await block.runSessionSyncTimer()).toBe(0);
    expect(block.checkoutSessionCalls()).toHaveLength(callsDuringConfirmation);
    expect(block.paymentElements[0].destroy).not.toHaveBeenCalled();

    finishConfirmation();
    expect(await placing).toBe(false);

    // The update that arrived meanwhile is applied after the attempt.
    expect(await block.runSessionSyncTimer()).toBe(1);
    expect(block.checkoutSessionCalls()).toHaveLength(
      callsDuringConfirmation + 1,
    );
  });

  test("keeps the Payment Element when the slot renders again during a confirmation, then mounts the new slot's form", async () => {
    const block = loadStripePaymentBlock();
    await renderAndMount(block);
    block.emitPaymentComplete();

    let finishConfirmation;
    block.confirm.mockImplementation(
      () =>
        new Promise((resolve) => {
          finishConfirmation = () =>
            resolve({ type: "error", error: { message: "Declined" } });
        }),
    );

    const placing = block.exports.handleStripePayment("cart_123");
    await flushPromises();

    // The checkout re-renders the payment slot during a 3D Secure challenge.
    block.exports.renderStripePaymentMethod(createCtx(block));
    await flushPromises();
    expect(block.paymentElements[0].destroy).not.toHaveBeenCalled();
    expect(block.paymentElements).toHaveLength(1);

    finishConfirmation();
    expect(await placing).toBe(false);
    await flushPromises();

    expect(block.paymentElements[0].destroy).toHaveBeenCalled();
    expect(block.paymentElements).toHaveLength(2);
  });

  test("does not mount a new form after a confirmed payment when the slot rendered again meanwhile", async () => {
    const block = loadStripePaymentBlock();
    await renderAndMount(block);
    block.emitPaymentComplete();

    let finishConfirmation;
    block.confirm.mockImplementation(
      () =>
        new Promise((resolve) => {
          finishConfirmation = () =>
            resolve({ type: "success", session: { id: "cs_test_1" } });
        }),
    );

    const placing = block.exports.handleStripePayment("cart_123");
    await flushPromises();
    block.exports.renderStripePaymentMethod(createCtx(block));
    await flushPromises();

    finishConfirmation();
    expect(await placing).toBe(true);
    await flushPromises();

    expect(block.paymentElements[0].destroy).not.toHaveBeenCalled();
    expect(block.paymentElements).toHaveLength(1);
  });

  test("lets a session refresh that is mounting finish before Place Order checks the form", async () => {
    let payload = checkoutSessionPayload();
    const block = loadStripePaymentBlock({
      onCheckoutSession: () => checkoutSessionResponse(payload),
    });
    await renderAndMount(block);
    block.emitPaymentComplete();

    // The cart total changes; the refresh gets a new session whose actions
    // are still loading when the shopper clicks Place Order.
    payload = checkoutSessionPayload({
      id: "cs_test_2",
      client_secret: "cs_test_2_secret_def",
    });
    let finishLoadingActions;
    block.setLoadActionsResult(
      new Promise((resolve) => {
        finishLoadingActions = () =>
          resolve({
            type: "success",
            actions: { confirm: block.confirm, getSession: block.getSession },
          });
      }),
    );
    await block.events.emit("cart/updated", cartPayload({ value: 55 }));
    await block.runSessionSyncTimer();

    const placing = block.exports.handleStripePayment("cart_123");
    await flushPromises();
    expect(block.confirm).not.toHaveBeenCalled();

    finishLoadingActions();
    // The form of the new session is empty, so nothing is confirmed.
    expect(await placing).toBe(false);
    expect(block.paymentElements).toHaveLength(2);
    expect(block.errorText()).toBe("Please complete your payment details");
    expect(block.confirm).not.toHaveBeenCalled();
  });

  test("does not send a shipping address on confirmation for a virtual cart", async () => {
    const block = loadStripePaymentBlock();
    await renderAndMount(block, {
      cart: { ...cartPayload(), isVirtual: true },
    });
    block.emitPaymentComplete();

    await block.exports.handleStripePayment("cart_123");

    expect(block.confirm.mock.calls[0][0]).not.toHaveProperty(
      "shippingAddress",
    );
  });
});
