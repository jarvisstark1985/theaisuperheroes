/**
 * SuperHero Identity Graph — v1.0
 * Tracks anonymous visitors with a fingerprint ID, links them to known
 * identities (affiliate/customer) on signup, stores visit history in S3.
 *
 * Drop on ALL 10 SuperHero websites alongside referral-tracking.js
 * Usage: <script src="https://www.theaisuperheroes.com/identity-graph.js"></script>
 */
(function() {
  'use strict';

  var SH_ID_KEY = 'sh_visitor_id';
  var SH_VISITS_KEY = 'sh_visits';
  var SH_IDENTITY_KEY = 'sh_identity';
  var SH_FIRST_SEEN_KEY = 'sh_first_seen';
  var SH_SESSION_KEY = 'sh_session';

  // ===== Generate a unique visitor ID =====
  function generateVisitorId() {
    var ts = Date.now().toString(36);
    var rand = Math.random().toString(36).substring(2, 10);
    var screen_fp = (screen.width || 0) + 'x' + (screen.height || 0);
    var hash = 0;
    var str = navigator.userAgent + screen_fp + (navigator.language || '');
    for (var i = 0; i < str.length; i++) {
      hash = ((hash << 5) - hash) + str.charCodeAt(i);
      hash |= 0;
    }
    return 'sh_' + ts + '_' + rand + '_' + Math.abs(hash).toString(36);
  }

  // ===== Get or create visitor ID =====
  function getVisitorId() {
    try {
      var id = localStorage.getItem(SH_ID_KEY);
      if (id) return id;
      id = generateVisitorId();
      localStorage.setItem(SH_ID_KEY, id);
      localStorage.setItem(SH_FIRST_SEEN_KEY, new Date().toISOString());
      return id;
    } catch(e) {
      return 'sh_anon_' + Date.now().toString(36);
    }
  }

  // ===== Session tracking =====
  function getSessionId() {
    try {
      var session = sessionStorage.getItem(SH_SESSION_KEY);
      if (session) return session;
      session = 'sess_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 6);
      sessionStorage.setItem(SH_SESSION_KEY, session);
      return session;
    } catch(e) {
      return 'sess_' + Date.now().toString(36);
    }
  }

  // ===== Get visit history =====
  function getVisitHistory() {
    try {
      var data = localStorage.getItem(SH_VISITS_KEY);
      return data ? JSON.parse(data) : [];
    } catch(e) { return []; }
  }

  // ===== Record a page visit =====
  function recordVisit() {
    try {
      var visits = getVisitHistory();
      var visit = {
        ts: new Date().toISOString(),
        site: window.location.hostname.replace(/^www\./, ''),
        page: window.location.pathname,
        ref: document.referrer || '',
        session: getSessionId()
      };

      // Add referral code if present
      var refCode = null;
      try {
        var match = document.cookie.match(/(^| )sh_ref=([^;]+)/);
        if (match) refCode = decodeURIComponent(match[2]);
        else refCode = localStorage.getItem('sh_ref') || null;
      } catch(e) {}
      if (refCode) visit.affiliate_ref = refCode;

      // UTM params
      try {
        var params = new URLSearchParams(window.location.search);
        var utms = {};
        ['utm_source','utm_medium','utm_campaign','utm_content','utm_term'].forEach(function(k) {
          var v = params.get(k);
          if (v) utms[k] = v;
        });
        if (Object.keys(utms).length > 0) visit.utm = utms;
      } catch(e) {}

      visits.push(visit);

      // Keep last 200 visits max (prevent localStorage bloat)
      if (visits.length > 200) visits = visits.slice(-200);

      localStorage.setItem(SH_VISITS_KEY, JSON.stringify(visits));
      return visit;
    } catch(e) { return null; }
  }

  // ===== Link identity (called when user signs up / logs in) =====
  function linkIdentity(identityData) {
    try {
      var identity = {
        visitor_id: getVisitorId(),
        linked_at: new Date().toISOString(),
        type: identityData.type || 'unknown', // 'affiliate' or 'customer'
        email: identityData.email || '',
        name: identityData.name || '',
        referral_code: identityData.referral_code || '',
        affiliate_ref: identityData.affiliate_ref || localStorage.getItem('sh_ref') || '',
        site: window.location.hostname.replace(/^www\./, '')
      };

      localStorage.setItem(SH_IDENTITY_KEY, JSON.stringify(identity));

      // Save identity graph to S3 if saveClientData is available
      if (window.saveClientData) {
        var graphData = {
          visitor_id: identity.visitor_id,
          identity: identity,
          first_seen: localStorage.getItem(SH_FIRST_SEEN_KEY) || '',
          visit_count: getVisitHistory().length,
          visit_history: getVisitHistory().slice(-50), // Last 50 visits
          sites_visited: getUniqueSites(),
          total_sessions: getUniqueSessions(),
          device: {
            screen: (screen.width || 0) + 'x' + (screen.height || 0),
            language: navigator.language || '',
            platform: navigator.platform || '',
            touch: 'ontouchstart' in window
          }
        };

        var filename = 'identity-graph/' + identity.visitor_id + '.json';
        window.saveClientData(graphData, filename).catch(function() {});
      }

      return identity;
    } catch(e) { return null; }
  }

  // ===== Helper: unique sites visited =====
  function getUniqueSites() {
    var visits = getVisitHistory();
    var sites = {};
    visits.forEach(function(v) { if (v.site) sites[v.site] = (sites[v.site] || 0) + 1; });
    return sites;
  }

  // ===== Helper: unique sessions =====
  function getUniqueSessions() {
    var visits = getVisitHistory();
    var sessions = {};
    visits.forEach(function(v) { if (v.session) sessions[v.session] = true; });
    return Object.keys(sessions).length;
  }

  // ===== Get identity summary =====
  function getIdentitySummary() {
    var visitorId = getVisitorId();
    var identity = null;
    try {
      var stored = localStorage.getItem(SH_IDENTITY_KEY);
      if (stored) identity = JSON.parse(stored);
    } catch(e) {}

    return {
      visitor_id: visitorId,
      is_known: !!identity,
      identity: identity,
      first_seen: localStorage.getItem(SH_FIRST_SEEN_KEY) || null,
      visit_count: getVisitHistory().length,
      sites_visited: getUniqueSites(),
      total_sessions: getUniqueSessions(),
      current_ref: localStorage.getItem('sh_ref') || null,
      is_returning: getVisitHistory().length > 1
    };
  }

  // ===== Public API =====
  window.SuperHeroIdentity = {
    getVisitorId: getVisitorId,
    getVisitHistory: getVisitHistory,
    linkIdentity: linkIdentity,
    getSummary: getIdentitySummary,
    getUniqueSites: getUniqueSites,
    isReturningVisitor: function() { return getVisitHistory().length > 1; },
    isKnownUser: function() {
      try { return !!localStorage.getItem(SH_IDENTITY_KEY); } catch(e) { return false; }
    }
  };

  // ===== INIT: Record this page visit =====
  var visitorId = getVisitorId();
  recordVisit();

  // ===== Auto-link identity when forms are submitted =====
  document.addEventListener('submit', function(e) {
    var form = e.target;
    if (!form || form.tagName !== 'FORM') return;

    // Look for email and name fields
    var emailInput = form.querySelector('input[type="email"], input[name="email"], input[name*="email"]');
    var nameInput = form.querySelector('input[name="name"], input[name="first_name"], input[name*="name"]');

    if (emailInput && emailInput.value) {
      // Determine type based on form context
      var type = 'customer';
      if (form.id && form.id.toLowerCase().indexOf('affiliate') >= 0) type = 'affiliate';
      if (form.id && form.id.toLowerCase().indexOf('register') >= 0) type = 'affiliate';
      if (form.action && form.action.toLowerCase().indexOf('affiliate') >= 0) type = 'affiliate';

      var refInput = form.querySelector('input[name="referral_code"]');

      linkIdentity({
        type: type,
        email: emailInput.value,
        name: nameInput ? nameInput.value : '',
        referral_code: refInput ? refInput.value : '',
        affiliate_ref: localStorage.getItem('sh_ref') || ''
      });
    }
  }, true);

  // ===== Patch saveClientData to always include visitor_id =====
  document.addEventListener('DOMContentLoaded', function() {
    if (window.saveClientData) {
      var _origSave = window.saveClientData;
      // Only patch if not already patched by identity graph
      if (!window._shIdentityPatched) {
        window._shIdentityPatched = true;
        window.saveClientData = function(data, filename) {
          if (data && typeof data === 'object') {
            data._visitor_id = visitorId;
            data._visit_count = getVisitHistory().length;
            data._is_returning = getVisitHistory().length > 1;
            data._first_seen = localStorage.getItem(SH_FIRST_SEEN_KEY) || '';
            data._sites_visited = Object.keys(getUniqueSites());
          }
          return _origSave(data, filename);
        };
      }
    }
  });

})();
