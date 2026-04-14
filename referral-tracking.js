/**
 * Referral Tracking Script — The AI SuperHeroes
 * Add this script to every page on all 6 websites.
 * It captures ?ref=CODE from the URL and stores it,
 * then notifies the API when users sign up or purchase.
 */
(function() {
  const API_BASE = 'https://super-hero-api.replit.app/api/referral';

  // Extract ref code from URL
  function getRefFromURL() {
    const params = new URLSearchParams(window.location.search);
    return params.get('ref');
  }

  // Store ref code in localStorage (persists 30 days)
  function storeRef(refCode) {
    if (!refCode) return;
    const data = {
      code: refCode,
      timestamp: Date.now(),
      landing: window.location.href
    };
    localStorage.setItem('superhero_ref', JSON.stringify(data));
  }

  // Get stored ref code (if within 30 days)
  function getStoredRef() {
    try {
      const raw = localStorage.getItem('superhero_ref');
      if (!raw) return null;
      const data = JSON.parse(raw);
      const thirtyDays = 30 * 24 * 60 * 60 * 1000;
      if (Date.now() - data.timestamp > thirtyDays) {
        localStorage.removeItem('superhero_ref');
        return null;
      }
      return data.code;
    } catch (e) {
      return null;
    }
  }

  // Track a conversion event — ONLY call on actual purchases
  // Do NOT call for signups or trials. Commission is only earned when the referral pays.
  window.trackReferralConversion = function(event, product, amount) {
    // Only allow purchase events
    if (event !== 'subscription' && event !== 'one_time') {
      console.warn('Referral: commission only awarded on purchase events (subscription, one_time)');
      return;
    }
    var refCode = getStoredRef();
    if (!refCode) return;
    if (!amount || amount <= 0) return; // Must have a real payment amount

    fetch(API_BASE + '/convert', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ref_code: refCode,
        event: event,      // 'subscription' or 'one_time' ONLY
        product: product,   // 'resume', 'seo', 'shopify', 'startbiz', 'hub', 'mcp'
        amount: amount
      })
    }).catch(function() {});
  };

  // On page load: capture and store ref
  var ref = getRefFromURL();
  if (ref) {
    storeRef(ref);
    // Clean URL (remove ?ref= without page reload)
    var url = new URL(window.location.href);
    url.searchParams.delete('ref');
    window.history.replaceState({}, '', url.toString());
  }
})();
