import { overrideGQLOperations } from '@dropins/build-tools/gql-extend.js';

overrideGQLOperations([
  // ACCS does not have Downloadable Items
  {
    npm: '@dropins/storefront-cart',
    skipFragments: ['DOWNLOADABLE_CART_ITEMS_FRAGMENT'],
    operations: [],
  },
  {
    npm: '@dropins/storefront-order',
    skipFragments: ['DOWNLOADABLE_ORDER_ITEMS_FRAGMENT'],
    operations: [],
  },
  {
    npm: '@dropins/storefront-checkout',
    operations: [
      `
      fragment CHECKOUT_DATA_FRAGMENT on Cart {
        available_payment_methods {
          code
          title
          oope_payment_method_config {
            backend_integration_url
            custom_config {
              ... on CustomConfigKeyValue {
                key
                value
              }
            }
          }
        }
        selected_payment_method {
          code
          title
          oope_payment_method_config {
            backend_integration_url
            custom_config {
              ... on CustomConfigKeyValue {
                key
                value
              }
            }
          }
        }
      }
      `,
    ],
  },
  // {
  //   npm: '@dropins/storefront-pdp',
  //   operations: [
  //     `
  //     fragment PRODUCT_FRAGMENT on ProductView {
  //       lowStock
  //     }
  //     `,
  //   ],
  // },
]);
