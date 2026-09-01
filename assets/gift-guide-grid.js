/* ==========================================================================
   Gift Guide grid - quick view + add to cart
   Behaviour for sections/gift-guide-grid.liquid. Vanilla JS, no libraries.

   Flow
     1. Click a "+" hotspot.
     2. Fetch the product from its storefront JSON (`<product-url>.js`), cached.
     3. Render the popup: image, title, price, description, variant controls.
        - option named "Color" -> row of toggle buttons
        - every other option    -> a <select> dropdown
     4. Selecting options recalculates the active variant and price.
     5. "Add to cart" posts to the cart and refreshes the header count.

   Companion rule
     When the active variant's colour and size match the trigger values
     (Black / M by default, set in the customizer) the companion product
     (Soft Winter Jacket) is added too. The companion never triggers itself.
   ========================================================================== */

(function () {
  'use strict';

  var COLOR_OPTION = /colou?r/i;
  var DEFAULT_MONEY_FORMAT = '${{amount}}';

  /* ----------------------------------------------------------------------
     Money formatting (Shopify's algorithm, trimmed to the tokens we need)
     ---------------------------------------------------------------------- */
  function formatMoney(cents, format) {
    var template = String(format || DEFAULT_MONEY_FORMAT).replace(/<[^>]+>/g, '');
    var amount = (cents / 100).toFixed(2);

    function group(value, decimalCount, thousandsSep, decimalSep) {
      var fixed = Math.abs(Number(value)).toFixed(decimalCount);
      var parts = fixed.split('.');
      var whole = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, thousandsSep);
      var fraction = parts[1] ? decimalSep + parts[1] : '';
      return whole + fraction;
    }

    return template.replace(/\{\{\s*(\w+)\s*\}\}/g, function (_, token) {
      switch (token) {
        case 'amount_no_decimals':
          return group(amount, 0, ',', '.');
        case 'amount_with_comma_separator':
          return group(amount, 2, '.', ',');
        case 'amount_no_decimals_with_comma_separator':
          return group(amount, 0, '.', ',');
        case 'amount_with_space_separator':
          return group(amount, 2, ' ', ',');
        case 'amount':
        default:
          return group(amount, 2, ',', '.');
      }
    });
  }

  /* ----------------------------------------------------------------------
     Small DOM helpers
     ---------------------------------------------------------------------- */
  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function normalizeOptions(product) {
    // The product JSON may expose `options` as strings or as objects.
    return (product.options || []).map(function (option, index) {
      if (typeof option === 'string') {
        var key = 'option' + (index + 1);
        var values = [];
        product.variants.forEach(function (variant) {
          if (variant[key] != null && values.indexOf(variant[key]) === -1) {
            values.push(variant[key]);
          }
        });
        return { name: option, position: index + 1, values: values };
      }
      return {
        name: option.name,
        position: option.position || index + 1,
        values: option.values || [],
      };
    });
  }

  /* ----------------------------------------------------------------------
     One grid section
     ---------------------------------------------------------------------- */
  function GiftGuideGrid(root) {
    this.root = root;
    this.popup = root.querySelector('[data-gg-popup]');
    this.popupBody = root.querySelector('[data-gg-popup-body]');
    this.dialog = root.querySelector('.gg-popup__dialog');

    this.moneyFormat = root.dataset.moneyFormat || DEFAULT_MONEY_FORMAT;
    this.cartAddUrl =
      root.dataset.cartAddUrl ||
      (window.routes && window.routes.cart_add_url) ||
      '/cart/add.js';

    this.companion = {
      handle: (root.dataset.companionHandle || '').trim(),
      color: (root.dataset.companionColor || '').trim().toLowerCase(),
      size: (root.dataset.companionSize || '').trim().toLowerCase(),
    };

    this.productCache = {};
    this.active = null; // { product, options: {position: value} }
    this.lastFocused = null;

    this.bindEvents();
  }

  GiftGuideGrid.prototype.bindEvents = function () {
    var self = this;

    this.root.querySelectorAll('[data-gg-hotspot]').forEach(function (hotspot) {
      hotspot.addEventListener('click', function () {
        self.open(hotspot.dataset.productUrl);
      });
    });

    this.popup.querySelectorAll('[data-gg-popup-dismiss]').forEach(function (node) {
      node.addEventListener('click', function () {
        self.close();
      });
    });

    document.addEventListener('keydown', function (event) {
      if (self.popup.hidden) return;
      if (event.key === 'Escape') self.close();
      if (event.key === 'Tab') self.trapFocus(event);
    });
  };

  /** Keep Tab focus inside the open dialog. */
  GiftGuideGrid.prototype.trapFocus = function (event) {
    var focusable = this.dialog.querySelectorAll(
      'button, [href], select, input, [tabindex]:not([tabindex="-1"])'
    );
    if (!focusable.length) return;

    var first = focusable[0];
    var last = focusable[focusable.length - 1];

    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  /* ---- open / close ---------------------------------------------------- */
  GiftGuideGrid.prototype.open = function (productUrl) {
    if (!productUrl) return;
    var self = this;

    this.lastFocused = document.activeElement;
    this.popup.hidden = false;
    document.body.style.overflow = 'hidden';
    this.renderLoading();

    this.fetchProduct(productUrl)
      .then(function (product) {
        self.renderProduct(product);
      })
      .catch(function () {
        self.renderError('Sorry, this product could not be loaded.');
      });
  };

  GiftGuideGrid.prototype.close = function () {
    this.popup.hidden = true;
    document.body.style.overflow = '';
    this.active = null;
    if (this.lastFocused && this.lastFocused.focus) this.lastFocused.focus();
  };

  /* ---- data ----------------------------------------------------------- */
  GiftGuideGrid.prototype.fetchProduct = function (productUrl) {
    var cacheKey = productUrl;
    if (this.productCache[cacheKey]) {
      return Promise.resolve(this.productCache[cacheKey]);
    }

    var url = productUrl.split('?')[0].replace(/\/$/, '') + '.js';
    var self = this;

    return fetch(url, { headers: { Accept: 'application/json' } })
      .then(function (response) {
        if (!response.ok) throw new Error('Request failed: ' + response.status);
        return response.json();
      })
      .then(function (product) {
        self.productCache[cacheKey] = product;
        return product;
      });
  };

  /* ---- rendering ----------------------------------------------------- */
  GiftGuideGrid.prototype.renderLoading = function () {
    this.popupBody.innerHTML = '';
    this.popupBody.appendChild(el('p', 'gg-popup__loading', 'Loading...'));
  };

  GiftGuideGrid.prototype.renderError = function (message) {
    this.popupBody.innerHTML = '';
    this.popupBody.appendChild(el('p', 'gg-popup__status gg-popup__status--error', message));
  };

  GiftGuideGrid.prototype.renderProduct = function (product) {
    var options = normalizeOptions(product);

    // Default selection: colour shows its first value pre-selected (as in the
    // Figma design); the size dropdown starts empty so it reads "Choose your
    // size" until the shopper picks one.
    var selection = {};
    options.forEach(function (option) {
      selection[option.position] = COLOR_OPTION.test(option.name)
        ? option.values[0]
        : '';
    });

    this.active = { product: product, options: selection, optionMeta: options };

    this.popupBody.innerHTML = '';

    var layout = el('div', 'gg-popup__layout');

    // Media
    var media = el('div', 'gg-popup__media');
    if (product.featured_image) {
      var img = el('img');
      img.src = product.featured_image;
      img.alt = product.title;
      img.loading = 'lazy';
      media.appendChild(img);
    }
    layout.appendChild(media);

    // Details
    var details = el('div', 'gg-popup__details');
    var title = el('h3', 'gg-popup__title', product.title);
    title.id = this.dialog.getAttribute('aria-labelledby');
    details.appendChild(title);

    var price = el('p', 'gg-popup__price');
    price.setAttribute('data-gg-price', '');
    details.appendChild(price);

    if (product.description) {
      var description = el('div', 'gg-popup__description');
      description.innerHTML = product.description;
      details.appendChild(description);
    }

    var self = this;
    options.forEach(function (option) {
      details.appendChild(self.buildOptionControl(option, selection));
    });

    var addButton = el('button', 'gg-popup__add');
    addButton.type = 'button';
    addButton.setAttribute('data-gg-add', '');
    addButton.appendChild(el('span', null, 'Add to cart'));
    addButton.appendChild(el('span', 'gg-popup__add-arrow', '→'));
    addButton.addEventListener('click', function () {
      self.addToCart();
    });
    details.appendChild(addButton);

    details.appendChild(el('p', 'gg-popup__status', ''));

    layout.appendChild(details);
    this.popupBody.appendChild(layout);

    this.updateVariantState();

    // Move focus into the dialog for keyboard users.
    var closeButton = this.popup.querySelector('.gg-popup__close');
    if (closeButton) closeButton.focus();
  };

  GiftGuideGrid.prototype.buildOptionControl = function (option, selection) {
    var self = this;
    var field = el('div', 'gg-field');
    field.appendChild(el('span', 'gg-field__label', option.name));

    if (COLOR_OPTION.test(option.name)) {
      // Toggle buttons
      var group = el('div', 'gg-swatches');
      group.setAttribute('role', 'group');
      group.setAttribute('aria-label', option.name);

      option.values.forEach(function (value) {
        var swatch = el('button', 'gg-swatch', value);
        swatch.type = 'button';
        swatch.setAttribute('aria-pressed', String(value === selection[option.position]));
        swatch.addEventListener('click', function () {
          selection[option.position] = value;
          group.querySelectorAll('.gg-swatch').forEach(function (node) {
            node.setAttribute('aria-pressed', String(node === swatch));
          });
          self.updateVariantState();
        });
        group.appendChild(swatch);
      });

      field.appendChild(group);
    } else {
      // Dropdown
      var select = el('select', 'gg-select');
      select.setAttribute('aria-label', option.name);

      // The design shows a "Choose your <option>" prompt until a value is picked.
      var prompt = el('option', null, 'Choose your ' + option.name.toLowerCase());
      prompt.value = '';
      select.appendChild(prompt);

      option.values.forEach(function (value) {
        var opt = el('option', null, value);
        opt.value = value;
        select.appendChild(opt);
      });

      // Keep the visible value in step with our state (empty = show the prompt).
      select.value = selection[option.position] || '';

      select.addEventListener('change', function () {
        selection[option.position] = select.value;
        self.updateVariantState();
      });

      field.appendChild(select);
    }

    return field;
  };

  /* ---- variant maths ------------------------------------------------- */
  GiftGuideGrid.prototype.currentVariant = function () {
    if (!this.active) return null;
    var selection = this.active.options;

    return (
      this.active.product.variants.filter(function (variant) {
        return Object.keys(selection).every(function (position) {
          return variant['option' + position] === selection[position];
        });
      })[0] || null
    );
  };

  GiftGuideGrid.prototype.updateVariantState = function () {
    var variant = this.currentVariant();
    var selection = this.active.options;
    var priceNode = this.popupBody.querySelector('[data-gg-price]');
    var addButton = this.popupBody.querySelector('[data-gg-add]');
    var status = this.popupBody.querySelector('.gg-popup__status');

    if (status) {
      status.textContent = '';
      status.classList.remove('gg-popup__status--error');
    }

    if (priceNode) {
      var cents = variant ? variant.price : this.active.product.price;
      priceNode.textContent = formatMoney(cents, this.moneyFormat);
    }

    if (addButton) {
      // The design keeps the button labelled "Add to cart" at all times; it is
      // only dimmed when a fully chosen variant is sold out. Incomplete choices
      // are handled with a message on click (see addToCart).
      var complete = Object.keys(selection).every(function (position) {
        return selection[position];
      });
      addButton.disabled = complete && variant && !variant.available;
      addButton.firstChild.textContent =
        complete && variant && !variant.available ? 'Sold out' : 'Add to cart';
    }
  };

  /* ---- add to cart -------------------------------------------------- */
  GiftGuideGrid.prototype.addToCart = function () {
    var self = this;
    var selection = this.active.options;
    var variant = this.currentVariant();
    var status = this.popupBody.querySelector('.gg-popup__status');
    var addButton = this.popupBody.querySelector('[data-gg-add]');

    var missing = this.active.optionMeta.filter(function (option) {
      return !selection[option.position];
    });
    if (missing.length) {
      status.textContent = 'Please choose a ' + missing[0].name.toLowerCase() + '.';
      status.classList.add('gg-popup__status--error');
      return;
    }

    if (!variant || !variant.available) {
      status.textContent = 'That combination is unavailable.';
      status.classList.add('gg-popup__status--error');
      return;
    }

    addButton.disabled = true;
    status.textContent = 'Adding...';
    status.classList.remove('gg-popup__status--error');

    this.postToCart([{ id: variant.id, quantity: 1 }])
      .then(function () {
        return self.maybeAddCompanion(variant);
      })
      .then(function () {
        return self.refreshCartCount();
      })
      .then(function () {
        status.textContent = 'Added to cart.';
        addButton.disabled = false;
      })
      .catch(function (error) {
        status.textContent =
          (error && error.message) || 'Could not add to cart. Please try again.';
        status.classList.add('gg-popup__status--error');
        addButton.disabled = false;
      });
  };

  GiftGuideGrid.prototype.postToCart = function (items) {
    return fetch(this.cartAddUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ items: items }),
    }).then(function (response) {
      return response.json().then(function (data) {
        if (!response.ok) {
          throw new Error(data.description || data.message || 'Add to cart failed.');
        }
        return data;
      });
    });
  };

  /**
   * Adds the companion product when the active variant matches the trigger
   * colour and size. Runs as a separate, best-effort request so a companion
   * problem never blocks the main add.
   */
  GiftGuideGrid.prototype.maybeAddCompanion = function (variant) {
    var companion = this.companion;
    if (!companion.handle) return Promise.resolve();

    var product = this.active.product;
    if (product.handle === companion.handle) return Promise.resolve();

    var values = [variant.option1, variant.option2, variant.option3]
      .filter(Boolean)
      .map(function (value) {
        return String(value).toLowerCase();
      });

    var matchesColor = !companion.color || values.indexOf(companion.color) !== -1;
    var matchesSize = !companion.size || values.indexOf(companion.size) !== -1;
    if (!matchesColor || !matchesSize) return Promise.resolve();

    var self = this;
    return this.fetchProduct('/products/' + companion.handle)
      .then(function (companionProduct) {
        var companionVariant =
          companionProduct.variants.filter(function (v) { return v.available; })[0] ||
          companionProduct.variants[0];
        if (!companionVariant) return null;
        return self.postToCart([{ id: companionVariant.id, quantity: 1 }]);
      })
      .catch(function () {
        // Swallow: the main product is already in the cart.
        return null;
      });
  };

  /**
   * Re-renders the header cart bubble using the Section Rendering API so the
   * count stays in sync without touching Dawn's own scripts.
   */
  GiftGuideGrid.prototype.refreshCartCount = function () {
    var target = document.getElementById('cart-icon-bubble');
    if (!target) return Promise.resolve();

    return fetch('/?section_id=cart-icon-bubble')
      .then(function (response) {
        return response.ok ? response.text() : null;
      })
      .then(function (html) {
        if (!html) return;
        var parsed = new DOMParser().parseFromString(html, 'text/html');
        var fresh = parsed.querySelector('.shopify-section') || parsed.body;
        if (fresh) target.innerHTML = fresh.innerHTML;
      })
      .catch(function () {
        /* non-critical */
      });
  };

  /* ----------------------------------------------------------------------
     Boot
     ---------------------------------------------------------------------- */
  function init() {
    document.querySelectorAll('[data-gg-grid]').forEach(function (root) {
      if (root.dataset.ggReady) return;
      root.dataset.ggReady = 'true';
      new GiftGuideGrid(root);
    });
  }

  init();

  // Re-init when the section is re-rendered in the theme editor.
  document.addEventListener('shopify:section:load', init);
})();
