(function () {
  'use strict';

  /**
   * Runtime state for the table print integration.
   */
  var state = {
    attached: false,
    observer: null,
    retryTimer: null
  };

  /**
   * Log helper for debugging.
   */
  function log(message, data) {
    if (window.console && console.log) {
      if (typeof data !== 'undefined') {
        console.log('[table-print] ' + message, data);
      } else {
        console.log('[table-print] ' + message);
      }
    }
  }

  /**
   * Warning helper for debugging.
   */
  function warn(message, data) {
    if (window.console && console.warn) {
      if (typeof data !== 'undefined') {
        console.warn('[table-print] ' + message, data);
      } else {
        console.warn('[table-print] ' + message);
      }
    }
  }

  /**
   * Find the current visible table inside the Open SDG table tab.
   */
  function getTableElement() {
    return document.querySelector('#selectionsTable table');
  }

  /**
   * Get the selections table wrapper element.
   */
  function getSelectionsTable() {
    return document.getElementById('selectionsTable');
  }

  /**
   * Read the indicator title from the heading.
   */
  function getIndicatorTitle() {
    var el =
      document.querySelector('.heading h1') ||
      document.querySelector('h1');

    if (el && el.textContent) {
      return el.textContent.trim();
    }

    return document.title || 'Table';
  }

  /**
   * Read the table caption from the HTML table.
   * Example: "Bevölkerung in Niedersachsen"
   */
  function getTableCaptionText(tableEl) {
    if (!tableEl) return '';

    var caption = tableEl.querySelector('caption');
    if (caption && caption.textContent) {
      return caption.textContent.trim();
    }

    return '';
  }

  /**
   * Create or reuse a host container above the table
   * where the print button will be inserted.
   */
  function ensureButtonHost() {
    var selectionsTable = getSelectionsTable();
    if (!selectionsTable) return null;

    var existing = selectionsTable.querySelector('.table-print-buttons');
    if (existing) {
      return existing;
    }

    var host = document.createElement('div');
    host.className = 'table-print-buttons';

    selectionsTable.insertBefore(host, selectionsTable.firstChild);
    return host;
  }

  /**
   * Check whether the table is already an active DataTable.
   */
  function isDataTableReady($table) {
    return !!(
      window.jQuery &&
      jQuery.fn &&
      jQuery.fn.dataTable &&
      $table &&
      $table.length &&
      jQuery.fn.dataTable.isDataTable($table.get(0))
    );
  }

  /**
   * Check whether the Buttons extension and the print button type are loaded.
   */
  function isButtonsReady() {
    return !!(
      window.jQuery &&
      jQuery.fn &&
      jQuery.fn.dataTable &&
      jQuery.fn.dataTable.Buttons &&
      jQuery.fn.dataTable.ext &&
      jQuery.fn.dataTable.ext.buttons &&
      jQuery.fn.dataTable.ext.buttons.print
    );
  }

  /**
   * Re-insert the already created Buttons container into the DOM.
   *
   * This is important because Open SDG / DataTables redraws can replace
   * or rebuild the table section, causing our host element to disappear.
   *
   * DataTables explicitly supports getting a Buttons container and inserting
   * it into the document with standard jQuery methods. See buttons().container()
   * and buttons().containers().
   */
  function reattachButtonsContainer(dataTable) {
    var host = ensureButtonHost();
    if (!host) {
      warn('Could not create button host.');
      return false;
    }

    // Remove old button container if present in this host,
    // then append the current one again.
    jQuery(host).empty();
    dataTable.buttons('mtTablePrint', null).container().appendTo(host);

    return true;
  }

  /**
   * Attach the print button to the existing DataTable.
   *
   * We intentionally do NOT reinitialise the table.
   * We attach Buttons to the already existing DataTable instance.
   */
  function attachPrintButton() {
    var tableEl = getTableElement();
    if (!tableEl) {
      warn('No table found in #selectionsTable.');
      return false;
    }

    if (!window.jQuery) {
      warn('jQuery is not available.');
      return false;
    }

    var $table = jQuery(tableEl);

    if (!isDataTableReady($table)) {
      warn('The table exists, but is not an active DataTable yet.');
      return false;
    }

    if (!isButtonsReady()) {
      warn('DataTables Buttons / print extension is not available.');
      return false;
    }

    var dataTable = $table.DataTable();
    var settings = dataTable.settings()[0];

    // If the button set already exists, just make sure it is visible again.
    if (settings._mtTablePrintAttached) {
      reattachButtonsContainer(dataTable);
      return true;
    }

    var printTitle = getIndicatorTitle();
    var tableCaption = getTableCaptionText(tableEl);

    new jQuery.fn.dataTable.Buttons(dataTable, {
      name: 'mtTablePrint',
      buttons: [
        {
          extend: 'print',
          text: 'Tabelle drucken',
          className: 'buttons-print',
          autoPrint: false,
          title: printTitle,
          exportOptions: {
            columns: ':visible',
            modifier: {
              search: 'applied',
              order: 'applied'
            }
          },
          customize: function (win) {
            var doc = win.document;
            var body = doc.body;

            body.classList.add('mt-table-print');

            if (tableCaption) {
              var caption = doc.createElement('div');
              caption.className = 'mt-table-print-caption';
              caption.textContent = tableCaption;
              body.insertBefore(caption, body.firstChild.nextSibling);
            }

            var source = doc.createElement('div');
            source.className = 'mt-table-print-source';
            source.textContent = 'Quelle: Integrationsmonitoring Niedersachsen';
            body.appendChild(source);

            var printedTable = body.querySelector('table');
            if (printedTable) {
              printedTable.classList.add(
                'table',
                'table-bordered',
                'table-sm',
                'mt-table-print-table'
              );
            }
          }
        }
      ]
    });

    // First insertion into our custom host
    reattachButtonsContainer(dataTable);

    /**
     * Re-attach the button after every DataTables draw.
     *
     * The draw event fires every time the table is redrawn, which is exactly
     * what happens on filters, ordering, search, etc.
     */
    dataTable.on('draw', function () {
      reattachButtonsContainer(dataTable);
    });

    settings._mtTablePrintAttached = true;
    state.attached = true;

    log('Print button attached to the existing DataTable.');
    return true;
  }

  /**
   * Observe the selections table container for DOM rebuilds.
   *
   * Open SDG may fully replace or rebuild parts of the table area
   * when user selections change.
   */
  function observeSelectionsTable() {
    var root = getSelectionsTable();
    if (!root || state.observer) return;

    state.observer = new MutationObserver(function () {
      if (state.attached) {
        // Re-run attachment to make sure the host exists and the button
        // is placed back into the current DOM.
        attachPrintButton();
      }
    });

    state.observer.observe(root, {
      childList: true,
      subtree: true
    });
  }

  /**
   * Retry bootstrap for a short period, because Open SDG may finish rendering
   * the table after DOM ready.
   */
  function bootstrapWithRetry() {
    var attempts = 0;
    var maxAttempts = 40;

    state.retryTimer = window.setInterval(function () {
      attempts += 1;

      var attached = attachPrintButton();
      observeSelectionsTable();

      if (attached || attempts >= maxAttempts) {
        window.clearInterval(state.retryTimer);
        state.retryTimer = null;

        if (!attached) {
          warn('Giving up after retrying to attach the table print button.');
        }
      }
    }, 500);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrapWithRetry);
  } else {
    bootstrapWithRetry();
  }
})();
