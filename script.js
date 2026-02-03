/**
 * OroClass Finance - Script.js
 * Fintech UX/UI 2026 Edition - Multi-Karat Calculator
 * Features: Dynamic Pricing, API Integration, Animated Total
 */

document.addEventListener('DOMContentLoaded', () => {
    // --- Mobile Menu Toggle ---
    const menuToggle = document.querySelector('.menu-toggle');
    const navMenu = document.querySelector('.nav-menu');

    if (menuToggle && navMenu) {
        menuToggle.addEventListener('click', () => {
            const isExpanded = menuToggle.getAttribute('aria-expanded') === 'true';
            menuToggle.setAttribute('aria-expanded', !isExpanded);
            navMenu.classList.toggle('active');
        });
    }

    // --- Multi-Karat Calculator Engine ---
    const allInputs = document.querySelectorAll('.karat-input');
    const resultDisplay = document.getElementById('result-display');
    const sectionTitle = document.getElementById('calc-title');

    // State object: Prices per Gram for each metal/purity (AFTER 40% Markdown)
    let prices = {
        gold: { '0.999': 0, '0.916': 0, '0.750': 0, '0.585': 0, '0.375': 0 },
        silver: { '0.999': 0, '0.925': 0, '0.800': 0 }
    };

    const MARKDOWN = 0.60; // We pay 60% of market (40% Margin)

    // Rolling Numbers Animation (CountUp)
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

    function calculateTotal() {
        let totalPayout = 0;

        allInputs.forEach(input => {
            const metal = input.dataset.metal; // 'gold' or 'silver'
            const purity = input.dataset.purity; // e.g., '0.750'
            const weight = parseFloat(input.value) || 0;

            if (prices[metal] && prices[metal][purity]) {
                totalPayout += weight * prices[metal][purity];
            }
        });

        if (resultDisplay) {
            animateValue(resultDisplay, previousTotal, totalPayout, 500);
        }
        previousTotal = totalPayout;
    }

    // --- SMART API FETCHING ---
    async function updatePrices() {
        try {
            const response = await fetch('resources/api/get_metals_smart.php');
            const data = await response.json();

            if (data && data.gold) {
                // 1. Timestamp Display
                const date = new Date(data.updated_at * 1000);
                const dateString = date.toLocaleDateString('it-IT', {
                    day: 'numeric',
                    month: 'short',
                    hour: '2-digit',
                    minute: '2-digit'
                });

                const badge = document.createElement('span');
                badge.className = 'ticker-trend';
                badge.style.display = 'inline-block';
                badge.style.marginLeft = '12px';
                badge.style.fontSize = '0.75rem';
                badge.style.verticalAlign = 'middle';
                badge.style.color = 'var(--color-text-muted)';
                badge.innerHTML = `• Aggiornato: ${dateString}`;

                if (!document.getElementById('price-badge') && sectionTitle) {
                    badge.id = 'price-badge';
                    sectionTitle.appendChild(badge);
                }

                // 2. Populate Price State (Apply Markdown)

                // --- GOLD ---
                const gold24k = data.gold.price_gram_24k;

                if (gold24k) {
                    const baseGold = gold24k * MARKDOWN; // This is the discounted price for pure gold

                    prices.gold['0.999'] = baseGold; // 24kt
                    // Calculate other karats from base (or use API if available)
                    prices.gold['0.916'] = data.gold.price_gram_22k ? (data.gold.price_gram_22k * MARKDOWN) : (baseGold * 0.916);
                    prices.gold['0.750'] = data.gold.price_gram_18k ? (data.gold.price_gram_18k * MARKDOWN) : (baseGold * 0.750);
                    prices.gold['0.585'] = data.gold.price_gram_14k ? (data.gold.price_gram_14k * MARKDOWN) : (baseGold * 0.585);
                    prices.gold['0.375'] = data.gold.price_gram_10k ? (data.gold.price_gram_10k * MARKDOWN) : (baseGold * 0.375);
                }

                // --- SILVER ---
                const silver999 = data.silver && data.silver.price_gram_24k;
                if (silver999) {
                    const baseSilver = silver999 * MARKDOWN;

                    prices.silver['0.999'] = baseSilver;
                    prices.silver['0.925'] = baseSilver * 0.925;
                    prices.silver['0.800'] = baseSilver * 0.800;
                }

                // Initial calculation after prices loaded
                calculateTotal();
            }
        } catch (error) {
            console.warn('Smart API fetch failed:', error);
            // Set fallback static prices (example values)
            prices.gold['0.999'] = 50;
            prices.gold['0.750'] = 37.5;
            prices.silver['0.999'] = 0.50;
            prices.silver['0.800'] = 0.40;
        }
    }

    // Event Listeners for all inputs
    allInputs.forEach(input => {
        input.addEventListener('input', calculateTotal);
    });

    // Initialize
    updatePrices();

    // --- Lock Price Handler (WhatsApp Integration) ---
    const lockBtn = document.getElementById('lock-btn');
    if (lockBtn) {
        lockBtn.addEventListener('click', () => {
            const total = resultDisplay ? resultDisplay.textContent : '€ 0,00';
            let details = '';

            // Build summary string from all filled inputs
            allInputs.forEach(input => {
                const weight = parseFloat(input.value);
                if (weight > 0) {
                    const row = input.closest('.karat-row');
                    const label = row ? row.querySelector('.karat-label').textContent.trim() : input.dataset.purity;
                    details += `• ${label}: ${weight}g\n`;
                }
            });

            if (!details) details = 'Nessun peso inserito.';

            const message = `Buongiorno Sabrina! Ho fatto una valutazione sul vostro sito:\n\n${details}\n📊 TOTALE STIMATO: ${total}\n\nVorrei bloccare questa quotazione. Quando posso passare?`;
            const waLink = `https://wa.me/393494408810?text=${encodeURIComponent(message)}`;

            if (navigator.vibrate) navigator.vibrate(50);
            window.open(waLink, '_blank');
        });
    }

    // --- FAQ Accordion ---
    const faqQuestions = document.querySelectorAll('.faq-question');
    faqQuestions.forEach(btn => {
        btn.addEventListener('click', () => {
            const isExpanded = btn.getAttribute('aria-expanded') === 'true';
            const answerId = btn.getAttribute('aria-controls');
            const answer = document.getElementById(answerId);

            btn.setAttribute('aria-expanded', !isExpanded);
            if (answer) {
                answer.hidden = isExpanded;
            }
        });
    });

    // --- Countdown Timer (Optional) ---
    let countdownSeconds = 15 * 60;
    const countdownDisplay = document.getElementById('ticker-countdown');

    function updateCountdown() {
        const mins = Math.floor(countdownSeconds / 60);
        const secs = countdownSeconds % 60;
        if (countdownDisplay) {
            countdownDisplay.textContent = `${mins}:${secs < 10 ? '0' : ''}${secs}`;
        }
        countdownSeconds--;
        if (countdownSeconds < 0) countdownSeconds = 15 * 60; // Reset
    }
    if (countdownDisplay) {
        setInterval(updateCountdown, 1000);
    }
});
