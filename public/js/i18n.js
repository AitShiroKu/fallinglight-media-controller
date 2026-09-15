/**
 * I18n — Thai/English bilingual translation system.
 * 
 * Loads JSON translation files from /i18n/ and provides tr(key) function.
 * Language preference stored in localStorage.
 */
(function () {
  'use strict';

  var translations = { en: {}, th: {} };
  var currentLang = localStorage.getItem('fl_lang') || 'en';
  var loaded = false;

  // Load translations
  function init() {
    return Promise.all([
      fetch('/i18n/en.json').then(function (r) { return r.json(); }).then(function (d) { translations.en = d; }),
      fetch('/i18n/th.json').then(function (r) { return r.json(); }).then(function (d) { translations.th = d; }),
    ]).then(function () {
      loaded = true;
      applyAll();
    }).catch(function (e) {
      console.warn('[i18n] Failed to load translations:', e);
      loaded = true;
    });
  }

  function tr(key) {
    if (translations[currentLang] && translations[currentLang][key]) return translations[currentLang][key];
    if (translations.en && translations.en[key]) return translations.en[key];
    return key;
  }

  function toggle() {
    currentLang = currentLang === 'en' ? 'th' : 'en';
    localStorage.setItem('fl_lang', currentLang);
    applyAll();
  }

  function setLang(lang) {
    currentLang = lang;
    localStorage.setItem('fl_lang', lang);
    applyAll();
  }

  function applyAll() {
    // Update all elements with data-i18n attribute
    document.querySelectorAll('[data-i18n]').forEach(function (el) {
      var key = el.getAttribute('data-i18n');
      var text = tr(key);
      if (el.tagName === 'INPUT' && el.type !== 'button' && el.type !== 'submit') {
        el.placeholder = text;
      } else {
        el.textContent = text;
      }
    });

    // Update lang toggle button
    var langBtn = document.getElementById('btn-lang');
    if (langBtn) langBtn.textContent = currentLang === 'en' ? 'TH' : 'EN';

    // Update HTML lang attribute
    document.documentElement.lang = currentLang === 'th' ? 'th' : 'en';

    // Re-render dynamic content
    if (window.playlist) window.playlist.render();
    if (window.schedulerUI) window.schedulerUI.render();
    if (window.youtubeDownloader) window.youtubeDownloader.updateButtonText();
  }

  // Public API
  window.appI18n = {
    init: init,
    tr: tr,
    toggle: toggle,
    setLang: setLang,
    get lang() { return currentLang; },
  };
})();
