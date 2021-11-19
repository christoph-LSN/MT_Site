// Add any custom javascript here.
   
opensdg.tableConfigAlter(function(config) {
    var overrides = {
        "order": [[ 0, "desc" ]]
    };
    $.extend(true, config, overrides);
});
