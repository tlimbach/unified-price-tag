function extractProductPrice(data) {
    // Muster für Preis im Format X.XX, X,XX oder -.99
    let pricePattern = /(\d+[.,]\d{2}|[.,]\d{2})/;
    let priceCandidates = [];

    // Durchsuche die JSON-Daten nach Preiskandidaten und speichere deren Bounding Boxen
    data.ParsedResults[0].TextOverlay.Lines.forEach(line => {
        line.Words.forEach(word => {
            if (pricePattern.test(word.WordText)) {
                // Berechne die Größe der Bounding Box (Breite * Höhe)
                const boundingBoxSize = word.Width * word.Height;
                priceCandidates.push({
                    price: word.WordText,
                    size: boundingBoxSize
                });
            }
        });
    });

    // Falls keine Preiskandidaten gefunden wurden, gib eine entsprechende Meldung aus
    if (priceCandidates.length === 0) {
        return "Kein Preis gefunden";
    }

    // Wähle den Kandidaten mit der größten Bounding Box (der meiste Platz auf dem Preisschild)
    let largestPriceCandidate = priceCandidates.reduce((prev, curr) => {
        return (curr.size > prev.size) ? curr : prev;
    });

    let recognizedPrice = largestPriceCandidate.price;

    // Sonderfall: Preise wie -.99 werden zu 0.99€ interpretiert
    if (recognizedPrice.startsWith(".") || recognizedPrice.startsWith("-.") || recognizedPrice.startsWith(",")) {
        recognizedPrice = "0" + recognizedPrice;
    }

    // Rückgabe des Preises mit dem €-Symbol
    return recognizedPrice.replace(",", ".") + " €";
}


function extractProductWeight(data) {
    let weightPattern = /(\d+\s?-?\s?(g|kg|G|KG))/;  // Muster für Gewicht in Gramm oder Kilogramm
    let pricePerKgPattern = /1\s*kg\s*[=]?\s*([\d.,]+)/i; // Muster für "1 kg = X.XX"
    let weightCandidates = [];

    // Durchsuche die JSON-Daten nach Gewichtskandidaten und speichere deren Bounding Boxen
    data.ParsedResults[0].TextOverlay.Lines.forEach(line => {
        // Überprüfe, ob in der Zeile ein Preis pro Kilogramm vorkommt (wie "1 KG = 8.95")
        let containsPricePerKg = pricePerKgPattern.test(line.LineText);

        // Wenn ein Preis pro Kilo in der Zeile vorkommt, ignoriere diese Zeile als Gewichtskandidat
        if (!containsPricePerKg) {
            line.Words.forEach(word => {
                if (weightPattern.test(word.WordText)) {
                    // Berechne die Größe der Bounding Box (Breite * Höhe)
                    const boundingBoxSize = word.Width * word.Height;
                    weightCandidates.push({
                        weight: word.WordText,
                        size: boundingBoxSize
                    });
                }
            });

            // Zusätzliche Überprüfung für kombinierte Gewichtszeilen wie "250 g"
            let combinedWeights = line.LineText.match(weightPattern);
            if (combinedWeights) {
                combinedWeights.forEach(matchedWeight => {
                    const boundingBoxSize = line.Words.reduce((total, word) => total + word.Width * word.Height, 0);  // Größe der Bounding Box der gesamten Zeile
                    weightCandidates.push({
                        weight: matchedWeight,
                        size: boundingBoxSize
                    });
                });
            }
        }
    });

    // Falls keine Gewichtsangaben gefunden wurden, gib eine entsprechende Meldung aus
    if (weightCandidates.length === 0) {
        return "Kein Gewicht gefunden";
    }

    // Priorisiere "g"-Angaben über "kg"
    let selectedWeight = weightCandidates.find(candidate => /g|G/.test(candidate.weight)) || weightCandidates[0];

    // Sonderfallbehandlung für Fehlerkennungen (z.B. "100 9" statt "100 g")
    if (selectedWeight.weight.includes('9') && !selectedWeight.weight.toLowerCase().includes('kg')) {
        selectedWeight.weight = selectedWeight.weight.replace('9', 'g');
    }

    return selectedWeight.weight;
}

function calculatePricePerKg(productPrice, productWeight) {
    // Überprüfen, ob der Produktpreis vorhanden und gültig ist
    if (!productPrice || isNaN(parseFloat(productPrice.replace(',', '.').replace('€', '').trim()))) {
        return "Ungültiger oder fehlender Produktpreis";
    }

    // Entferne mögliche Leerzeichen und konvertiere den Preis in einen numerischen Wert
    let price = parseFloat(productPrice.replace(',', '.').replace('€', '').trim());

    // Überprüfen, ob das Produktgewicht vorhanden und gültig ist
    if (!productWeight || (!productWeight.toLowerCase().includes('g') && !productWeight.toLowerCase().includes('kg'))) {
        return "Ungültiges oder fehlendes Produktgewicht";
    }

    // Konvertiere das Produktgewicht in Kilogramm, falls es in Gramm angegeben ist
    let weightInKg;
    if (productWeight.toLowerCase().includes('g')) {
        // Wenn das Gewicht in Gramm ist, entferne das 'g' und teile durch 1000, um in Kilogramm zu konvertieren
        weightInKg = parseFloat(productWeight.replace('g', '').trim()) / 1000;
    } else if (productWeight.toLowerCase().includes('kg')) {
        // Wenn das Gewicht in Kilogramm ist, entferne das 'kg' und nutze den Wert direkt
        weightInKg = parseFloat(productWeight.replace('kg', '').trim());
    }

    // Überprüfen, ob das Gewicht gültig ist
    if (isNaN(weightInKg) || weightInKg <= 0) {
        return "Ungültiges Produktgewicht";
    }

    // Berechne den Preis pro Kilogramm
    let pricePerKg = price / weightInKg;

    // Rückgabe des berechneten Preises pro Kilogramm in einem ansprechenden Format
    return ` ${pricePerKg.toFixed(2)} €`;
}

function extractProductName(data, productWeight) {
    let productName = "";
    let largestSize = 0;

    // Hilfsfunktion zur Berechnung des Anteils der Ziffern in einem Text
    function calculateDigitPercentage(text) {
        let digitCount = (text.match(/\d/g) || []).length;
        return (digitCount / text.length) * 100;
    }

    // Hilfsfunktion zum Entfernen des Produktgewichts aus dem Text
    function removeProductWeight(text, weight) {
        if (weight) {
            // Entferne das Produktgewicht (z.B. "250g" oder "250 g") aus dem Namen
            let weightPattern = new RegExp(weight.replace(/\s/g, '\\s?'), 'gi');
            text = text.replace(weightPattern, '').trim();
        }
        return text;
    }

    // Durchlaufe die JSON-Daten, um den längsten Text mit der größten Schriftgröße zu finden
    data.ParsedResults[0].TextOverlay.Lines.forEach(line => {
        let text = line.LineText;

        // Berechne die Breite und Höhe der Linie, um die Gesamtgröße der Bounding Box zu ermitteln
        let totalSize = line.MaxHeight * line.Words.reduce((totalWidth, word) => totalWidth + word.Width, 0);

        // Berechne den Anteil der Ziffern im Text
        let digitPercentage = calculateDigitPercentage(text);

        // Wähle nur Texte, die weniger als 40% Ziffern enthalten und kein "€"-Symbol
        if (digitPercentage < 40 && totalSize > largestSize && !text.includes('€')) {
            largestSize = totalSize;
            productName = text;  // Speichere den Text der Linie als Produktnamen
        }
    });

    // Entferne das Produktgewicht aus dem gefundenen Produktnamen
    productName = removeProductWeight(productName, productWeight);

    return productName ? productName : "Kein Produktname gefunden";
}



function extractPricePerKg(data) {

    // Muster für Preis pro Kilogramm im Format "1 kg = X.XX" oder "1 kg X,XX"
    let pricePerKgPattern = /1\s*kg\s*[:=]?\s*€?\s*([\d.,]+)/i;
    let pricePerKgCandidates = [];

    // Durchsuche die JSON-Daten nach Kandidaten für den Preis pro Kilo
    data.ParsedResults[0].TextOverlay.Lines.forEach(line => {

        console.log(line);

        let matched = line.LineText.match(pricePerKgPattern);
        if (matched) {
            // Berechne die Größe der Bounding Box (Breite * Höhe)
            const boundingBoxSize = line.MaxHeight * line.Words.reduce((totalWidth, word) => totalWidth + word.Width, 0);
            pricePerKgCandidates.push({
                price: matched[1], // Preis aus dem regulären Ausdruck extrahieren
                size: boundingBoxSize
            });
        }
    });

    // Falls keine Preis pro Kilo Angaben gefunden wurden, gib eine entsprechende Meldung aus
    if (pricePerKgCandidates.length === 0) {
        return "Kein Preis pro Kg gefunden";
    }

    // Wähle den Kandidaten mit der größten Bounding Box (der meiste Platz auf dem Preisschild)
    let largestPricePerKgCandidate = pricePerKgCandidates.reduce((prev, curr) => {
        return (curr.size > prev.size) ? curr : prev;
    });

    let recognizedPricePerKg = largestPricePerKgCandidate.price;

    // Rückgabe des Preises pro Kilogramm mit dem €-Symbol
    return recognizedPricePerKg.replace(",", ".") + " €";
}




