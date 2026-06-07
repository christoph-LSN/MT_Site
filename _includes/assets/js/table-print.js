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

  function getTableElement() {
    return document.querySelector('#selectionsTable table');
  }

  function getIndicatorTitle() {
    var el =
      document.querySelector('.heading h1') ||
      document.querySelector('h1');

    if (el && el.textContent) {
      return el.textContent.trim();
    }

    return document.title || 'Table';
  }

  function getTableCaptionText(tableEl) {
    if (!tableEl) return '';

    var caption = tableEl.querySelector('caption');
    if (caption && caption.textContent) {
      return caption.textContent.trim();
    }

    return '';
  }

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

  function attachPrintButton() {
    var tableEl = getTableElement();
    if (!tableEl) {
      warn('No table found in #selectionsTable.');
      return;
    }

    var $table = jQuery(tableEl);

    if (!isDataTableReady($table)) {
      warn('The table exists, but is not an active DataTable yet.');
      return;
    }

    if (!isButtonsReady()) {
      warn('DataTables Buttons / print extension is not available.');
      return;
    }

    var dataTable = $table.DataTable();
    var settings = dataTable.settings()[0];

    // Prevent duplicate button attachment if the script runs more than once.
    if (settings._mtTablePrintAttached) {
      log('Print button already attached.');
      return;
    }

    var buttonHost = ensureButtonHost();
    if (!buttonHost) {
      warn('Could not create button host inside #selectionsTable.');
      return;
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

            // Add table caption as a subheading if available.
            if (tableCaption) {
              var caption = doc.createElement('div');
              caption.className = 'mt-table-print-caption';
              caption.textContent = tableCaption;
              body.insertBefore(caption, body.firstChild.nextSibling);
            }

            // Add fixed source line.
            var source = doc.createElement('div');
            source.className = 'mt-table-print-source';
            source.textContent = 'Quelle: Integrationsmonitoring Niedersachsen';
            body.appendChild(source);

            // Make the exported table easier to style.
            var printedTable = body.querySelector('table');
            if (printedTable) {
              printedTable.classList.add('table', 'table-bordered', 'table-sm', 'mt-table-print-table');
            }
          }
        }
      ]
    });

    dataTable.buttons('mtTablePrint', null).container().appendTo(buttonHost);
    settings._mtTablePrintAttached = true;

    log('Print button attached to the existing DataTable.');
  }

  function bootstrap() {
    if (!window.jQuery) {
      warn('jQuery is not available.');
      return;
    }

    attachPrintButton();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrap);
  } else {
    bootstrap();
  }
})();
