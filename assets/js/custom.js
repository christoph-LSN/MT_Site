// Add any custom javascript here.


// table sorting desc.

opensdg.tableConfigAlter(function(config) {
    var overrides = {
        "order": [[ 0, "desc" ]],
        "buttons": [[ 'print' ]]

      };
    $.extend(true, config, overrides);


});


//Printing

$(document).ready(function() {
    $('#example').DataTable( {
        dom: 'Bfrtip',
        buttons: [
            'print'
        ]
    } );
} );
