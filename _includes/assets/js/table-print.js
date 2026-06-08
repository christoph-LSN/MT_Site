(function () {
  'use strict';

  function log(message, data) {
    if (window.console && console.log) {
      if (typeof data !== 'undefined') {
        console.log('[table-print] ' + message, data);
      } else {
        console.log('[table-print] ' + message);
      }
    }
  }

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
   * Find the visible table inside the Open SDG table tab.
   */
  function getTableElement() {
    return document.querySelector('#selectionsTable table');
  }

  /**
   * Read the indicator title from the page heading.
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
   * Read the HTML table caption if present.
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
   * where the native DataTables print button will be rendered.
   *
   * Note:
   * This is the simple rollback version.
   * It works for the initial table view, but the button may disappear
   * if Open SDG rebuilds the table area after a disaggregation change.
   */
  function ensureButtonHost() {
    var selectionsTable = document.getElementById('selectionsTable');
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
   * Attach the native DataTables print button to the existing DataTable.
   *
   * Important:
   * - We do not re-initialise the table.
   * - We attach Buttons to the already existing DataTable instance.
   * - We guard against duplicate attachment.
   *
   * DataTables Buttons supports creating a Buttons instance and then moving the
   * button container into the DOM with standard jQuery methods. 【1-37a6c5】【2-414eb5】【5-5eb6e0】
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

    if (settings._mtTablePrintAttached) {
      log('Print button already attached.');
      return true;
    }

    var buttonHost = ensureButtonHost();
    if (!buttonHost) {
      warn('Could not create button host inside #selectionsTable.');
      return false;
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

    dataTable.buttons('mtTablePrint', null).container().appendTo(buttonHost);
    settings._mtTablePrintAttached = true;

    log('Print button attached to the existing DataTable.');
    return true;
  }

  /**
   * Open SDG / DataTables initialisation may complete slightly after DOM ready.
   * Therefore we retry attachment for a short period.
   */
  function bootstrapWithRetry() {
    var attempts = 0;
    var maxAttempts = 30;

    var timer = window.setInterval(function () {
      attempts += 1;

      var attached = attachPrintButton();
      if (attached || attempts >= maxAttempts) {
        window.clearInterval(timer);

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