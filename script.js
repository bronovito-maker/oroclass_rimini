/**
 * OroClass Finance - Script.js
 * Fintech UX/UI 2026 Edition - Smart Pricing Engine
 * Features: 
 * - Multi-Karat Evaluation
 * - Real-Time API Fetching (Smart 24h Cache)
 * - Automatic 40% Markdown Application
 * - Rolling Total Animation
 */

document.addEventListener('DOMContentLoaded', () => {

    // --- 1. CONFIGURATION & STATE ---
    const API_URL = 'resources/api/get_metals_smart.php';
    const MARKDOWN = 0.60; // 40% Margin (We pay 60% of Spot)

    // Base Prices (Pure 24k/999) - Initialized to 0
    let basePrices = {
        gold: 0,
        silver: 0
    };

    // DOM Elements
    const allInputs = document.querySelectorAll('.karat-input');
    const resultDisplay = document.getElementById('result-display');
    const lockBtn = document.getElementById('lock-btn');
    const sectionTitle = document.getElementById('calc-title');

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
                // Parse API Data
                // The API returns 'price' or 'price_gram_24k'. 
                // We use price_gram_24k or fallback to 'price' (per gram).

                const rawGold24k = data.gold.price_gram_24k || data.gold.price;
                const rawSilver999 = data.silver.price_gram_24k || data.silver.price;

                // Apply 40% SPREAD immediately to the Base Price
                basePrices.gold = rawGold24k * MARKDOWN;
                basePrices.silver = rawSilver999 * MARKDOWN;

                // Update Timestamp UI
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
                        badge.className = 'ticker-trend';
                        badge.style.marginLeft = '12px';
                        badge.style.fontSize = '0.75rem';
                        badge.style.color = 'var(--color-text-muted)';
                        badge.innerHTML = `• Aggiornato: ${dateString}`;
                        sectionTitle.appendChild(badge);
                    }
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

    // Initialize
    updatePrices();
});
