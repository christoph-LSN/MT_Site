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
   * Create or reuse a title/action bar inside #selectionsTable.
   *
   * Structure:
   * .table-print-bar
   *   .table-print-title
   *   .table-print-actions
   *
   * The native DataTables button container is inserted into .table-print-actions.
   */
  function ensureButtonHost() {
    var selectionsTable = document.getElementById('selectionsTable');
    if (!selectionsTable) return null;

    var existingActions = selectionsTable.querySelector('.table-print-actions');
    if (existingActions) {
      return existingActions;
    }

    var tableEl = getTableElement();
    var titleText = getTableCaptionText(tableEl) || getIndicatorTitle();

    var bar = document.createElement('div');
    bar.className = 'table-print-bar';

    var title = document.createElement('div');
    title.className = 'table-print-title';
    title.textContent = titleText;

    var actions = document.createElement('div');
    actions.className = 'table-print-actions';

    bar.appendChild(title);
    bar.appendChild(actions);

    selectionsTable.insertBefore(bar, selectionsTable.firstChild);

    // Mark the container so the original visible table caption
    // can be hidden via CSS without removing it from the DOM.
    selectionsTable.classList.add('has-table-print-bar');

    return actions;
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
   * Move / reinsert the button container into the title/action bar.
   */
  function placeButtonsContainer(dataTable) {
    var actionHost = ensureButtonHost();
    if (!actionHost) {
      warn('Could not create print action host inside #selectionsTable.');
      return false;
    }

    jQuery(actionHost).empty();
    dataTable.buttons('mtTablePrint', null).container().appendTo(actionHost);
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
          text: '🖨 {{ page.t.indicator.print_table | escape }}',
          className: 'buttons-print mt-table-print-button',
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

            var printedTable = body.querySelector('table');

            // Remove all table captions in the print document
            body.querySelectorAll('caption').forEach(function (el) {
              if (el.parentNode) {
                el.parentNode.removeChild(el);
              }
            });

            // Remove any custom caption blocks if present
            body.querySelectorAll('.mt-table-print-caption').forEach(function (el) {
              if (el.parentNode) {
                el.parentNode.removeChild(el);
              }
            });

            // Remove any plain text block directly before the table
            // that duplicates the caption
            if (printedTable && tableCaption) {
              var previous = printedTable.previousElementSibling;

              if (
                previous &&
                previous.textContent &&
                previous.textContent.trim() === tableCaption.trim()
              ) {
                previous.parentNode.removeChild(previous);
              }
            }

            var source = doc.createElement('div');
            source.className = 'mt-table-print-source';
            source.textContent = 'Quelle: Integrationsmonitoring Niedersachsen';
            body.appendChild(source);

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
   * This is mainly needed after area rebuilds triggered by the region selection.
   * We retry briefly until the current table is fully ready again.
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
   * Important:
   * - we only react to init.dt here
   * - we deliberately do NOT react to order.dt / draw.dt
   *
   * Reason:
   * Sorting keeps the same table instance and the explicit reattach
   * during sorting had broken the button action.
   * For the region-selection case, init.dt is the relevant signal for a newly
   * initialised table instance.
   */
  function bindGlobalDataTableEvents() {
    if (!window.jQuery) return;

    jQuery(document).off('.mtTablePrint');

    jQuery(document).on('init.dt.mtTablePrint', function (e, settings) {
      try {
        if (!settings || !settings.nTable) return;

        var tableNode = settings.nTable;
        var selectionsTable = document.getElementById('selectionsTable');

        if (!selectionsTable || !selectionsTable.contains(tableNode)) {
          return;
        }

        scheduleReattach();
      } catch (error) {
        warn('Error while reacting to DataTables init event.', error);
      }
    });
  }

  /**
   * React to checkbox changes in the region selection.
   *
   * This is the main trigger for the disaggregation / region workflow.
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
   * Initial bootstrap.
   */
  function bootstrap() {
    bindGlobalDataTableEvents();
    bindSelectionChangeEvents();
    scheduleReattach();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrap);
  } else {
    bootstrap();
  }
})();