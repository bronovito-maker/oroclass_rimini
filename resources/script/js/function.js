function getDate() {

    var today = new Date();
    var giorno = ["Domenica", "Lunedi", "Martedi", "Mercoledi", "Giovedi", "Venerdi", "Sabato"];
    var mese = ["Gennaio", "Febbraio", "Marzo", "Aprile", "Maggio", "Giugno", "Luglio", "Agosto", "Settembre", "Ottobre", "Novembre", "Dicembre"];

    document.getElementById('today').innerHTML = giorno[today.getDay()] + ", " + today.getDate() + " " + mese[today.getMonth()] + " " + today.getFullYear();
}

function getUrlParam(sParam) {

    var sPageURL = window.location.search.substring(1);
    var sURLVariables = sPageURL.split('&');

    for (var i = 0; i < sURLVariables.length; i++) {
        var sParameterName = sURLVariables[i].split('=');
        if (sParameterName[0] == sParam) {
            document.getElementById(sParam).innerHTML = decodeURI(sParameterName[1]);
        }
    }
}

function loadShopSelect() {

    document.getElementById('sorting').value = document.getElementById('sortingSet').value;
    document.getElementById('distinct').value = document.getElementById('distinctSet').value;   
}

function createPriceSlider() {

    var min = parseInt(document.getElementById('minPrice').value);
    var max = parseInt(document.getElementById('maxPrice').value);
    var minSet = parseInt(document.getElementById('minPriceSet').value);
    var maxSet = parseInt(document.getElementById('maxPriceSet').value);
    var step = parseInt(document.getElementById('step').value);

    $(".js-range-slider").ionRangeSlider({
        type: "double",
        skin: "round",
        grid: true,
        min: min,
        max: max,
        from: minSet,
        to: maxSet,
        step: 10,
        prefix: "€"
    });
}

function onFilterPrice() {

    var slider = document.getElementById('priceSlider');
    valori = slider.value.split(";");
    minSet = valori[0];
    maxSet = valori[1];

    if (minSet && minSet > 0) {
        document.getElementById('minPriceSet').value = minSet;
    }
    if (maxSet && maxSet > 0) {
        document.getElementById('maxPriceSet').value = maxSet;
    }

    document.getElementById('shopForm').submit();  
}

function addProduct(id, name) {

    CustomConfirm({
        targets: 'a',
        title: 'Aggiungere al carrello ?',
        body: name,
        btn_yes: 'Conferma',
        btn_no: 'Annulla'
    }, function (confirmed, target_element) {
        if (confirmed) {
            const urlParams = new URLSearchParams(window.location.search);
            urlParams.set("addId", id);
            urlParams.set("path", location.pathname + location.search);
            history.replaceState(null, null, "?" + urlParams.toString());
            parent.window.location.reload(true);
        }
    });
}

function removeProduct(id, name, paramId) {

    CustomConfirm({
        targets: 'img',
        title: 'Rimuovere dal carrello ?',
        body: name,
        btn_yes: 'Conferma',
        btn_no: 'Annulla'
    }, function (confirmed, target_element) {
        if (confirmed) {
            const urlParams = new URLSearchParams(window.location.search);
            urlParams.set("removeId", id);
            urlParams.set("path", location.pathname+"?pId="+paramId);
            history.replaceState(null, null, "?" + urlParams.toString());
            parent.window.location.reload(true);
        }
    });
}

function cambiaStato(id, state) { // cambia ciclicamente la visibilità dell'elemento indicato

    if (document.getElementById) {

        if (state === "show") {
            document.getElementById(id).style.display = 'block'; // lo visualizza
        } else {
            document.getElementById(id).style.display = 'none'; // lo nasconde
        }
    }
}