/**
 * OroClass Finance - Script.js
 * Fintech UX/UI 2026 Edition - Market-Based Pricing Engine
 * 
 * Features:
 * - Multi-Karat Evaluation (Gold: 24k, 18k, 14k | Silver: 999, 925, 800)
 * - Real-Time API Fetching with Smart 24h Cache
 * - Market-Based Spreads (Gold 15%, Silver 30%)
 * - Automatic Oz-to-Gram Detection & Conversion
 * - Live Market Status (LBMA Hours)
 * - Transparent Debug Logging
 */

document.addEventListener('DOMContentLoaded', () => {

    // --- 1. CONFIGURATION & STATE ---
    const API_URL = 'resources/api/get_metals_smart.php';

    // Market-Based Payout Percentages (Client receives)
    const PAYOUT_GOLD = 0.85;   // Gold: 15% spread (client gets 85%)
    const PAYOUT_SILVER = 0.573; // Silver: 42.7% spread (client gets 57.3%)

    const CACHE_DURATION = 24 * 60 * 60; // 24 hours in seconds
    const OZ_TO_GRAMS = 31.1035; // Conversion factor for troy ounce to grams

    // Detection thresholds for oz-to-gram conversion
    const SILVER_GRAM_THRESHOLD = 5.00;  // If > 5€, likely in oz
    const GOLD_GRAM_THRESHOLD = 150.00;  // If > 150€, likely in oz

    // Base Prices (Pure 24k/999) - Initialized to 0
    let basePrices = {
        gold: 0,
        silver: 0
    };

    // Countdown State
    let countdownInterval = null;
    let nextUpdateTime = null;

    // DOM Elements
    const allInputs = document.querySelectorAll('.karat-input');
    const resultDisplay = document.getElementById('result-display');
    const lockBtn = document.getElementById('lock-btn');
    const sectionTitle = document.getElementById('calc-title');
    const countdownDisplay = document.getElementById('ticker-countdown');
    const marketStatusWidget = document.getElementById('market-status-widget');
    const statusDot = marketStatusWidget?.querySelector('.status-dot');
    const statusText = marketStatusWidget?.querySelector('.status-text');
    const statusSubtext = marketStatusWidget?.querySelector('.status-subtext');

    // --- 2. TRADINGVIEW WIDGET INJECTION (Fixes HTML Linting) ---
    const tvContainer = document.getElementById('tv-mini-chart');
    if (tvContainer) {
        const script = document.createElement('script');
        script.type = 'text/javascript';
        script.src = 'https://s3.tradingview.com/external-embedding/embed-widget-mini-symbol-overview.js';
        script.async = true;
        script.innerHTML = JSON.stringify({
            "symbol": "FX_IDC:XAUEUR",
            "width": "100%",
            "height": "220",
            "locale": "it",
            "dateRange": "1M",
            "colorTheme": "dark",
            "isTransparent": false,
            "autosize": true,
            "largeChartUrl": ""
        });
        tvContainer.appendChild(script);
    }

    // --- 3. MOBILE MENU TOGGLE ---
    const menuToggle = document.querySelector('.menu-toggle');
    const navMenu = document.querySelector('.nav-menu');
    if (menuToggle && navMenu) {
        menuToggle.addEventListener('click', () => {
            const isExpanded = menuToggle.getAttribute('aria-expanded') === 'true';
            menuToggle.setAttribute('aria-expanded', !isExpanded);
            navMenu.classList.toggle('active');
        });
    }

    // --- 4. ANIMATION UTILS ---
    function animateValue(obj, start, end, duration) {
        let startTimestamp = null;
        const step = (timestamp) => {
            if (!startTimestamp) startTimestamp = timestamp;
            const progress = Math.min((timestamp - startTimestamp) / duration, 1);
            const easeProgress = 1 - Math.pow(1 - progress, 3); // Cubic ease-out
            const currentVal = start + (end - start) * easeProgress;

            obj.innerHTML = new Intl.NumberFormat('it-IT', {
                style: 'currency',
                currency: 'EUR'
            }).format(currentVal);

            if (progress < 1) window.requestAnimationFrame(step);
        };
        window.requestAnimationFrame(step);
    }

    // --- 5. PRICE NORMALIZATION HELPER ---
    /**
     * Normalizes API price to EUR per GRAM
     * Handles oz-to-gram conversion if needed
     * @param {object} metalData - API data for gold or silver
     * @param {string} metalType - 'gold' or 'silver'
     * @returns {number} - Price in EUR per gram
     */
    function normalizePricePerGram(metalData, metalType) {
        // Try to get price from API (prefer price_gram_24k, fallback to price)
        let rawPrice = metalData.price_gram_24k || metalData.price;

        if (!rawPrice || rawPrice === 0) {
            console.error(`❌ No valid price found for ${metalType}`);
            return 0;
        }

        // Smart detection: if price is suspiciously high, it's likely in oz
        const threshold = metalType === 'gold' ? GOLD_GRAM_THRESHOLD : SILVER_GRAM_THRESHOLD;

        if (rawPrice > threshold) {
            console.warn(`⚠️ ${metalType.toUpperCase()} price ${rawPrice.toFixed(2)}€ exceeds threshold ${threshold}€ - converting from oz to grams`);
            rawPrice = rawPrice / OZ_TO_GRAMS;
        }

        return rawPrice;
    }

    // --- 6. GET NEXT MARKET OPEN TIME ---
    function getNextMarketOpenTimestamp() {
        const now = new Date();
        const italyTime = new Date(now.toLocaleString('en-US', { timeZone: 'Europe/Rome' }));

        const day = italyTime.getDay(); // 0 = Sunday, 6 = Saturday
        const hours = italyTime.getHours();
        const minutes = italyTime.getMinutes();
        const currentTimeMinutes = hours * 60 + minutes;
        const marketOpen = 9 * 60; // 09:00 = 540 minutes

        // Create a date for next opening
        let nextOpen = new Date(italyTime);
        nextOpen.setHours(9, 0, 0, 0);

        // If it's a weekday and before 9am, market opens today
        if (day >= 1 && day <= 5 && currentTimeMinutes < marketOpen) {
            return Math.floor(nextOpen.getTime() / 1000);
        }

        // Otherwise, find next weekday at 9am
        let daysToAdd = 1;
        if (day === 0) daysToAdd = 1; // Sunday -> Monday
        else if (day === 5) daysToAdd = 3; // Friday -> Monday
        else if (day === 6) daysToAdd = 2; // Saturday -> Monday

        nextOpen.setDate(nextOpen.getDate() + daysToAdd);
        nextOpen.setHours(9, 0, 0, 0);

        return Math.floor(nextOpen.getTime() / 1000);
    }

    // --- 7. COUNTDOWN TIMER ---
    function startCountdown(targetTimestamp) {
        // Clear existing interval
        if (countdownInterval) clearInterval(countdownInterval);

        nextUpdateTime = targetTimestamp;

        countdownInterval = setInterval(() => {
            const now = Math.floor(Date.now() / 1000);
            const remaining = nextUpdateTime - now;

            if (remaining <= 0) {
                if (countdownDisplay) {
                    countdownDisplay.textContent = '00:00';
                }
                clearInterval(countdownInterval);
                // Restart countdown to next market open
                startCountdown(getNextMarketOpenTimestamp());
                checkMarketStatus(); // Update market status
                return;
            }

            // Format as HH:MM:SS or MM:SS
            const hours = Math.floor(remaining / 3600);
            const minutes = Math.floor((remaining % 3600) / 60);
            const seconds = remaining % 60;

            let timeString;
            if (hours > 0) {
                timeString = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
            } else {
                timeString = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
            }

            if (countdownDisplay) {
                countdownDisplay.textContent = timeString;
            }
        }, 1000);
    }

    // --- 8. MARKET STATUS CHECKER (LBMA Hours) ---
    function checkMarketStatus() {
        // Get current time in Europe/Rome timezone
        const now = new Date();
        const italyTime = new Date(now.toLocaleString('en-US', { timeZone: 'Europe/Rome' }));

        const day = italyTime.getDay(); // 0 = Sunday, 6 = Saturday
        const hours = italyTime.getHours();
        const minutes = italyTime.getMinutes();
        const currentTimeMinutes = hours * 60 + minutes;

        // Market hours: Monday (1) to Friday (5), 09:00 to 17:30
        const marketOpen = 9 * 60; // 09:00 = 540 minutes
        const marketClose = 17 * 60 + 30; // 17:30 = 1050 minutes

        const isWeekday = day >= 1 && day <= 5;
        const isDuringHours = currentTimeMinutes >= marketOpen && currentTimeMinutes < marketClose;
        const isOpen = isWeekday && isDuringHours;

        // Update UI
        if (!statusDot || !statusText) return;

        // Update countdown label
        const countdownLabel = document.getElementById('countdown-label');
        const countdownContainer = document.getElementById('countdown-container');

        if (isOpen) {
            // MARKET OPEN
            statusDot.classList.remove('market-closed');
            statusDot.classList.add('market-open');
            statusText.classList.remove('market-closed');
            statusText.classList.add('market-open');
            statusText.textContent = 'Mercato Live: APERTO';

            if (statusSubtext) {
                statusSubtext.textContent = 'Quotazioni LBMA in tempo reale';
            }

            // Hide countdown when market is open
            if (countdownContainer) {
                countdownContainer.style.display = 'none';
            }
        } else {
            // MARKET CLOSED
            statusDot.classList.remove('market-open');
            statusDot.classList.add('market-closed');
            statusText.classList.remove('market-open');
            statusText.classList.add('market-closed');
            statusText.textContent = 'Mercato: CHIUSO';

            // Determine when it reopens
            let reopenMessage = '';
            if (day === 0) { // Sunday
                reopenMessage = 'Riapre Lunedì alle 09:00';
            } else if (day === 6) { // Saturday
                reopenMessage = 'Riapre Lunedì alle 09:00';
            } else if (currentTimeMinutes >= marketClose) { // After hours on weekday
                reopenMessage = 'Riapre domani alle 09:00';
            } else { // Before hours on weekday
                reopenMessage = 'Apre oggi alle 09:00';
            }

            if (statusSubtext) {
                statusSubtext.textContent = reopenMessage;
            }

            // Show countdown when market is closed
            if (countdownContainer) {
                countdownContainer.style.display = 'block';
            }
            if (countdownLabel) {
                countdownLabel.textContent = 'Apertura in:';
            }
        }
    }

    let previousTotal = 0;

    // --- 5. CALCULATION LOGIC ---
    function calculateTotal() {
        let totalPayout = 0;

        allInputs.forEach(input => {
            const weight = parseFloat(input.value) || 0;
            const metalType = input.dataset.metal; // 'gold' or 'silver'
            const purity = parseFloat(input.dataset.purity); // e.g. 0.750, 0.999

            if (weight > 0) {
                // Get Base Price for this metal (already discounted by 40% if set)
                let basePrice = (metalType === 'gold') ? basePrices.gold : basePrices.silver;

                if (basePrice > 0) {
                    // Specific Logic per Karat (as requested)
                    // Price = Base (Discounted) * Purity
                    const pricePerGram = basePrice * purity;
                    totalPayout += weight * pricePerGram;
                }
            }
        });

        // Update Total Display
        if (resultDisplay) {
            animateValue(resultDisplay, previousTotal, totalPayout, 500);
        }
        previousTotal = totalPayout;
    }

    // --- 6. SMART PRICING FETCH ---
    async function updatePrices() {
        try {
            console.log('Fetching Smart Prices...');
            const response = await fetch(API_URL);
            const data = await response.json();

            if (data && data.gold && data.silver) {
                // Normalize prices to EUR per GRAM (handles oz conversion if needed)
                const rawGold24k = normalizePricePerGram(data.gold, 'gold');
                const rawSilver999 = normalizePricePerGram(data.silver, 'silver');

                // === DEBUG LOGGING (Transparency) ===
                console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
                console.log('📊 PREZZI API NORMALIZZATI (EUR/grammo):');
                console.log(`🥇 ORO PURO (24k): ${rawGold24k.toFixed(2)} €/g`);
                console.log(`🥈 ARGENTO PURO (999): ${rawSilver999.toFixed(4)} €/g`);
                console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

                // Apply Market-Based Spreads to Base Prices
                basePrices.gold = rawGold24k * PAYOUT_GOLD;
                basePrices.silver = rawSilver999 * PAYOUT_SILVER;

                console.log('💰 PREZZI CLIENTE (dopo spread):');
                console.log(`🥇 ORO: ${basePrices.gold.toFixed(2)} €/g (cliente riceve ${(PAYOUT_GOLD * 100).toFixed(0)}% del valore spot)`);
                console.log(`🥈 ARGENTO: ${basePrices.silver.toFixed(4)} €/g (cliente riceve ${(PAYOUT_SILVER * 100).toFixed(0)}% del valore spot)`);
                console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

                // Update Hero Section Ticker Prices
                const price24kt = document.getElementById('price-24kt');
                const price18kt = document.getElementById('price-18kt');
                const priceSilver = document.getElementById('price-silver');

                // Calculate 18kt gold price (75% purity)
                const gold18ktPrice = rawGold24k * 0.750 * PAYOUT_GOLD;

                if (price24kt) price24kt.textContent = `€ ${rawGold24k.toFixed(2)}`;
                if (price18kt) price18kt.textContent = `€ ${gold18ktPrice.toFixed(2)}`;
                if (priceSilver) priceSilver.textContent = `€ ${basePrices.silver.toFixed(2)}`;

                // Update Timestamp UI and Start Countdown
                if (data.updated_at) {
                    const date = new Date(data.updated_at * 1000);
                    const dateString = date.toLocaleDateString('it-IT', {
                        day: 'numeric',
                        month: 'short',
                        hour: '2-digit',
                        minute: '2-digit'
                    });

                    if (sectionTitle && !document.getElementById('price-badge')) {
                        const badge = document.createElement('span');
                        badge.id = 'price-badge';
                        badge.className = 'ticker-trend price-update-badge';
                        badge.style.marginLeft = '12px';
                        badge.style.fontSize = '0.75rem';
                        badge.style.color = 'var(--color-text-muted)';
                        badge.innerHTML = `• Aggiornato: ${dateString}`;
                        sectionTitle.appendChild(badge);
                    } else if (document.getElementById('price-badge')) {
                        // Update existing badge
                        document.getElementById('price-badge').innerHTML = `• Aggiornato: ${dateString}`;
                    }

                    // Start countdown to next market open
                    const nextMarketOpen = getNextMarketOpenTimestamp();
                    startCountdown(nextMarketOpen);
                }

                // Recalculate immediately with new prices
                calculateTotal();
            } else {
                throw new Error('Invalid JSON structure');
            }
        } catch (error) {
            console.error('Price Fetch Error:', error);
            // Fallback values (Approximate safe values to prevent 0)
            basePrices.gold = 50.00; // ~83 spot * 0.60
            basePrices.silver = 0.50; // ~0.83 spot * 0.60
            calculateTotal();
        }
    }

    // --- 7. EVENT LISTENERS ---

    // Input Listeners
    allInputs.forEach(input => {
        input.addEventListener('input', calculateTotal);
    });

    // Lock Price (WhatsApp)
    if (lockBtn) {
        lockBtn.addEventListener('click', () => {
            const total = resultDisplay.textContent;
            let details = '';

            allInputs.forEach(input => {
                const w = parseFloat(input.value);
                if (w > 0) {
                    // Try to find the label text nearby
                    const row = input.closest('.karat-row');
                    const labelText = row ? row.querySelector('.karat-label').innerText : input.dataset.purity;
                    // Clean up label text (remove newlines)
                    const cleanLabel = labelText.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim();

                    details += `• ${cleanLabel}: ${w}g\n`;
                }
            });

            if (!details) {
                alert('Inserisci almeno un peso per calcolare la quotazione.');
                return;
            }

            const message = `Buongiorno! Ho appena calcolato questa quotazione sul sito:\n\n${details}\n💰 TOTALE: ${total}\n\nVorrei fissare un appuntamento per bloccare il prezzo.`;
            const waLink = `https://wa.me/393494408810?text=${encodeURIComponent(message)}`;

            window.open(waLink, '_blank');
        });
    }

    // FAQ Accordion (Bonus)
    const faqQuestions = document.querySelectorAll('.faq-question');
    faqQuestions.forEach(btn => {
        btn.addEventListener('click', () => {
            const isExpanded = btn.getAttribute('aria-expanded') === 'true';
            const answerId = btn.getAttribute('aria-controls');
            const answer = document.getElementById(answerId);

            btn.setAttribute('aria-expanded', !isExpanded);
            if (answer) answer.hidden = isExpanded;
        });
    });

    // --- 9. INITIALIZATION ---
    updatePrices();

    // Check market status immediately and update every minute
    checkMarketStatus();
    setInterval(checkMarketStatus, 60000);
});
