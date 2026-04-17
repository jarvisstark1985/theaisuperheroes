/**
 * SuperHero Referral Tracking â v2.0
 * Drop this script on ALL 10 SuperHero websites.
 * Captures ?ref=CODE from URL, stores in cookie + localStorage,
 * tracks clicks via API, and exposes code for Stripe checkout integration.
 *
 * Usage: <script src="https://theaisuperheroes.com/referral-tracking.js"></script>
 */
(function() {
  'use strict';

  var API_BASE = 'https://api.theaisuperheroes.com/v1/referral';
  var COOKIE_DAYS = 30;
  var COOKIE_NAME = 'sh_ref';
  var LS_KEY = 'sh_ref';
  var LS_SITE_KEY = 'sh_ref_site';
  var LS_TIME_KEY = 'sh_ref_time';

  // ===== Cookie helpers =====
  function setCookie(name, value, days) {
    var d = new Date();
    d.setTime(d.getTime() + (days * 24 * 60 * 60 * 1000));
    document.cookie = name + '=' + encodeURIComponent(value) +
      ';expires=' + d.toUTCString() +
      ';path=/;secure;samesite=lax';
  }

  function getCookie(name) {
    var match = document.cookie.match(new RegExp('(^| )' + name + '=([^;]+)'));
    return match ? decodeURIComponent(match[2]) : null;
  }

  // ===== Extract ref code from URL =====
  function getRefFromURL() {
    try {
      var params = new URLSearchParams(window.location.search);
      return params.get('ref') || null;
    } catch (e) {
      // Fallback for older browsers
      var match = window.location.search.match(/[?&]ref=([^&]+)/);
      return match ? decodeURIComponent(match[1]) : null;
    }
  }

  // ===== Store referral code =====
  function storeRef(code) {
    if (!code) return;
    setCookie(COOKIE_NAME, code, COOKIE_DAYS);
    try {
      localStorage.setItem(LS_KEY, code);
      localStorage.setItem(LS_SITE_KEY, window.location.hostname);
      localStorage.setItem(LS_TIME_KEY, Date.now().toString());
    } catch (e) {}
  }

  // ===== Get stored referral code (respects 30-day expiry) =====
  function getStoredRef() {
    // Try cookie first (auto-expires)
    var cookieRef = getCookie(COOKIE_NAME);
    if (cookieRef) return cookieRef;

    // Fallback to localStorage with manual expiry check
    try {
      var code = localStorage.getItem(LS_KEY);
      var time = parseInt(localStorage.getItem(LS_TIME_KEY) || '0');
      var thirtyDays = COOKIE_DAYS * 24 * 60 * 60 * 1000;
      if (code && (Date.now() - time) < thirtyDays) {
        return code;
      }
      // Expired â clean up
      localStorage.removeItem(LS_KEY);
      localStorage.removeItem(LS_SITE_KEY);
      localStorage.removeItem(LS_TIME_KEY);
    } catch (e) {}
    return null;
  }

  // ===== Track click to API =====
  function trackClick(code) {
    try {
      var data = JSON.stringify({
        code: code,
        site: window.location.hostname,
        page: window.location.pathname,
        referrer: document.referrer || ''
      });

      // Use sendBeacon if available (non-blocking)
      if (navigator.sendBeacon) {
        navigator.sendBeacon(API_BASE + '/click', data);
      } else {
        fetch(API_BASE + '/click', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: data,
          keepalive: true
        }).catch(function() {});
      }
    } catch (e) {}
  }

  // ===== Public API for Stripe integration =====
  window.SuperHeroReferral = {
    /**
     * Get the stored referral code (if any, within 30-day window)
     * @returns {string|null}
     */
    getCode: function() {
      return getStoredRef();
    },

    /**
     * Get the site where the referral originated
     * @returns {string|null}
     */
    getSite: function() {
      try {
        return localStorage.getItem(LS_SITE_KEY) || null;
      } catch (e) { return null; }
    },

    /**
     * Append referral code to a Stripe checkout URL
     * Works with both buy.stripe.com links and custom checkout URLs
     * @param {string} checkoutUrl - The Stripe checkout or payment link URL
     * @returns {string} URL with referral code appended
     */
    appendToCheckout: function(checkoutUrl) {
      var code = getStoredRef();
      if (!code) return checkoutUrl;
      try {
        var url = new URL(checkoutUrl);
        url.searchParams.set('client_reference_id', code);
        return url.toString();
      } catch (e) {
        // Fallback: simple string append
        var sep = checkoutUrl.indexOf('?') >= 0 ? '&' : '?';
        return checkoutUrl + sep + 'client_reference_id=' + encodeURIComponent(code);
      }
    },

    /**
     * Track a conversion event (called after successful Stripe payment)
     * Only call for actual paid events â commissions are only on purchases.
     * @param {string} product - Product key (e.g., 'urlsuperhero')
     * @param {number} amount - Payment amount in cents
     */
    trackConversion: function(product, amount) {
      var code = getStoredRef();
      if (!code || !amount || amount <= 0) return;

      fetch(API_BASE + '/convert', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ref_code: code,
          product: product,
          amount: amount,
          site: window.location.hostname
        })
      }).catch(function() {});
    }
  };

  // ===== INIT: Capture ref from URL on page load =====
  var ref = getRefFromURL();
  if (ref) {
    storeRef(ref);
    trackClick(ref);

    // Clean ref param from URL without page reload
    try {
      var cleanUrl = new URL(window.location.href);
      cleanUrl.searchParams.delete('ref');
      window.history.replaceState({}, '', cleanUrl.toString());
    } catch (e) {}
  }

  // ===== Auto-patch Stripe checkout links =====
  // Automatically adds referral code to any buy.stripe.com links on the page
  document.addEventListener('click', function(e) {
    var link = e.target.closest('a[href*="buy.stripe.com"], a[href*="checkout.stripe.com"]');
    if (link) {
      var code = getStoredRef();
      if (code) {
        e.preventDefault();
        window.location.href = window.SuperHeroReferral.appendToCheckout(link.href);
      }
    }
  }, true);

})();
