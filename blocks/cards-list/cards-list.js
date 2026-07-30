/**
 * Decorates a two-up editorial card list.
 * @param {Element} block The cards-list block.
 */
export default function decorate(block) {
  block.querySelectorAll(':scope > div').forEach((card) => {
    card.classList.add('card-item');

    const content = card.querySelectorAll(':scope > div')[1];
    const description = content?.querySelector('p:not(.button-container)');
    description?.classList.add('desc');
  });

  block.querySelectorAll('a').forEach((link) => {
    link.classList.add('button', 'alt');
  });
}
