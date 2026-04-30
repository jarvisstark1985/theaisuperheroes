/**
 * SuperHero Referral Tracking â v3.0
 * Drop this script on ALL 10 SuperHero websites.
 * Captures ?ref=CODE from URL, stores in cookie + localStorage,
 * tracks clicks to S3 + GA4, and exposes code for Stripe checkout.
 *
 * Usage: <script src="https://www.theaisuperheroes.com/referral-tracking.js"></script>
 */
(function() {
  'use strict';

  var COOKIE_DAYS = 30;
  var COOKIE_NAME = 'sh_ref';
  var LS_KEY = 'sh_ref';
  var LS_SITE_KEY = 'sh_ref_site';
  var LS_TIME_KEY = 'sh_ref_time';

  // Central S3 config for referral click storage
  var S3_CONFIG = {
    region: 'us-east-2',
    cognitoIdentityPoolId: 'us-east-2:662dfd2a-8d86-4ee3-875b-cd55d0acff8d',
    bucket: 'superhero-clients-theaisuperheroes',
    clickPrefix: 'referral-clicks/',
    conversionPrefix: 'referral-conversions/'
  };

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
    var cookieRef = getCookie(COOKIE_NAME);
    if (cookieRef) return cookieRef;
    try {
      var code = localStorage.getItem(LS_KEY);
      var time = parseInt(localStorage.getItem(LS_TIME_KEY) || '0');
      var thirtyDays = COOKIE_DAYS * 24 * 60 * 60 * 1000;
      if (code && (Date.now() - time) < thirtyDays) return code;
      localStorage.removeItem(LS_KEY);
      localStorage.removeItem(LS_SITE_KEY);
      localStorage.removeItem(LS_TIME_KEY);
    } catch (e) {}
    return null;
  }

  // ===== Save to S3 (non-blocking) =====
  function saveToS3(prefix, data) {
    try {
      var sdkUrl = 'https://sdk.amazonaws.com/js/aws-sdk-2.1600.0.min.js';

      function doSave() {
        if (!window.AWS) return;
        window.AWS.config.region = S3_CONFIG.region;
        window.AWS.config.credentials = new window.AWS.CognitoIdentityCredentials({
          IdentityPoolId: S3_CONFIG.cognitoIdentityPoolId
        });
        window.AWS.config.credentials.get(function(err) {
          if (err) return;
          var s3 = new window.AWS.S3({ region: S3_CONFIG.region });
          var ts = new Date().toISOString().replace(/[:.]/g, '-');
          var rand = Math.random().toString(36).substring(2, 8);
          var key = prefix + data.ref_code + '_' + ts + '_' + rand + '.json';

          s3.putObject({
            Bucket: S3_CONFIG.bucket,
            Key: key,
            Body: JSON.stringify(data),
            ContentType: 'application/json'
          }, function(err) {
            if (!err) console.log('[ReferralTracking] Saved to S3: ' + key);
          });
        });
      }

      if (window.AWS) {
        doSave();
      } else {
        var script = document.createElement('script');
        script.src = sdkUrl;
        script.onload = doSave;
        document.head.appendChild(script);
      }
    } catch (e) {}
  }

  // ===== Track referral click â saves to S3 + fires GA4 event =====
  function trackClick(code) {
    var clickData = {
      ref_code: code,
      site: window.location.hostname.replace(/^www\./, ''),
      page: window.location.pathname,
      referrer: document.referrer || '',
      timestamp: new Date().toISOString(),
      user_agent: navigator.userAgent,
      screen: (screen.width || 0) + 'x' + (screen.height || 0),
      language: navigator.language || '',
      _type: 'referral-click'
    };

    // Add UTM params if present
    try {
      var params = new URLSearchParams(window.location.search);
      ['utm_source','utm_medium','utm_campaign'].forEach(function(k) {
        var v = params.get(k);
        if (v) clickData[k] = v;
      });
    } catch(e) {}

    // Save click to S3
    saveToS3(S3_CONFIG.clickPrefix, clickData);

    // POST click to affiliate backend
    try {
      var xhr = new XMLHttpRequest();
      xhr.open('POST', 'https://seo-backend.replit.app/api/affiliate/track-click', true);
      xhr.setRequestHeader('Content-Type', 'application/json');
      xhr.send(JSON.stringify({
        ref_code: code,
        site: clickData.site,
        referrer_url: clickData.referrer
      }));
    } catch(e) {}

    // Fire GA4 event
    try {
      if (window.gtag) {
        window.gtag('event', 'referral_click', {
          ref_code: code,
          landing_site: clickData.site,
          landing_page: clickData.page,
          referrer: clickData.referrer
        });
      }
    } catch(e) {}
  }

  // ===== Public API for Stripe integration =====
  window.SuperHeroReferral = {
    getCode: function() {
      return getStoredRef();
    },

    getSite: function() {
      try {
        return localStorage.getItem(LS_SITE_KEY) || null;
      } catch (e) { return null; }
    },

    appendToCheckout: function(checkoutUrl) {
      var code = getStoredRef();
      if (!code) return checkoutUrl;
      try {
        var url = new URL(checkoutUrl);
        url.searchParams.set('client_reference_id', code);
        return url.toString();
      } catch (e) {
        var sep = checkoutUrl.indexOf('?') >= 0 ? '&' : '?';
        return checkoutUrl + sep + 'client_reference_id=' + encodeURIComponent(code);
      }
    },

    trackConversion: function(product, amount) {
      var code = getStoredRef();
      if (!code || !amount || amount <= 0) return;

      var conversionData = {
        ref_code: code,
        product: product,
        amount: amount,
        site: window.location.hostname.replace(/^www\./, ''),
        timestamp: new Date().toISOString(),
        _type: 'referral-conversion'
      };

      // Save conversion to S3
      saveToS3(S3_CONFIG.conversionPrefix, conversionData);

      // Fire GA4 event
      try {
        if (window.gtag) {
          window.gtag('event', 'referral_conversion', {
            ref_code: code,
            product: product,
            value: amount / 100
          });
        }
      } catch(e) {}
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
