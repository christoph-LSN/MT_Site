(function () {
  'use strict';

  var reattachTimer = null;

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
   * Create or reuse a host container inside #selectionsTable
   * where the native DataTables print button will be rendered.
   *
   * The button intentionally stays in the same dynamic area as the table.
   * If Open SDG / DataTables rebuilds the area, we reinsert it afterwards.
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
   * Move / reinsert the button container into the current host.
   *
   * DataTables Buttons supports retrieving the button container through the API
   * and inserting it back into the document with standard jQuery methods. 
   */
  function placeButtonsContainer(dataTable) {
    var buttonHost = ensureButtonHost();
    if (!buttonHost) {
      warn('Could not create button host inside #selectionsTable.');
      return false;
    }

    jQuery(buttonHost).empty();
    dataTable.buttons('mtTablePrint', null).container().appendTo(buttonHost);
    return true;
  }

  /**
   * Attach (or reattach) the native DataTables print button
   * to the current DataTable instance.
   */
  function attachPrintButton() {
    var tableEl = getTableElement();
    if (!tableEl) {
      return false;
    }

    if (!window.jQuery) {
      warn('jQuery is not available.');
      return false;
    }

    var $table = jQuery(tableEl);

    if (!isDataTableReady($table)) {
      return false;
    }

    if (!isButtonsReady()) {
      warn('DataTables Buttons / print extension is not available.');
      return false;
    }

    var dataTable = $table.DataTable();
    var settings = dataTable.settings()[0];

    // If already attached for this table instance, simply reinsert the container.
    if (settings._mtTablePrintAttached) {
      return placeButtonsContainer(dataTable);
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

    settings._mtTablePrintAttached = true;
    log('Native table print button attached.', { tableId: tableEl.id });

    return placeButtonsContainer(dataTable);
  }

  /**
   * Start a short retry cycle.
   *
   * Why?
   * Your logs showed that after region selection, DataTables fires draw/init
   * and then the DOM inside #selectionsTable is still being rebuilt.
   * So we retry briefly until the new table is fully ready again. 【1-dd0660】【2-7bd0ae】
   */
  function scheduleReattach() {
    if (reattachTimer) {
      window.clearInterval(reattachTimer);
      reattachTimer = null;
    }

    var attempts = 0;
    var maxAttempts = 12;

    reattachTimer = window.setInterval(function () {
      attempts += 1;

      var attached = attachPrintButton();
      if (attached || attempts >= maxAttempts) {
        window.clearInterval(reattachTimer);
        reattachTimer = null;

        if (!attached) {
          warn('Reattach attempt finished without visible print button.');
        }
      }
    }, 250);
  }

  /**
   * Listen globally for DataTables lifecycle events.
   *
   * DataTables documents:
   * - draw: fired whenever the table is redrawn
   * - init: fired whenever a DataTable is initialised
   * - order: fired whenever the table data is ordered / sorted
   * - these events bubble and can be listened for centrally. 【1-dd0660】【2-7bd0ae】【3-0e3429】
   */
  function bindGlobalDataTableEvents() {
    if (!window.jQuery) return;

    jQuery(document).off('.mtTablePrint');

    jQuery(document).on(
      'init.dt.mtTablePrint draw.dt.mtTablePrint order.dt.mtTablePrint',
      function (e, settings) {
        try {
          if (!settings || !settings.nTable) return;

          var tableNode = settings.nTable;
          var selectionsTable = document.getElementById('selectionsTable');

          if (!selectionsTable || !selectionsTable.contains(tableNode)) {
            return;
          }

          scheduleReattach();
        } catch (error) {
          warn('Error while reacting to DataTables lifecycle event.', error);
        }
      }
    );
  }

  /**
   * React to checkbox changes in the region selection.
   */
  function bindSelectionChangeEvents() {
    document.addEventListener(
      'change',
      function (e) {
        var target = e.target;

        if (
          target &&
          target.tagName === 'INPUT' &&
          target.type === 'checkbox'
        ) {
          scheduleReattach();
        }
      },
      true
    );
  }

  /**
   * React to sorting clicks on table headers.
   *
   * This complements the DataTables order/draw/init events and follows
   * the same pattern as the region-selection handling.
   */
  function bindSortingEvents() {
    document.addEventListener(
      'click',
      function (e) {
        var headerCell = e.target && e.target.closest
          ? e.target.closest('#selectionsTable th')
          : null;

        if (headerCell) {
          scheduleReattach();
        }
      },
      true
    );
  }

  /**
   * Initial bootstrap.
   */
  function bootstrap() {
    bindGlobalDataTableEvents();
    bindSelectionChangeEvents();
    bindSortingEvents();
    scheduleReattach();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrap);
  } else {
    bootstrap();
  }
})();