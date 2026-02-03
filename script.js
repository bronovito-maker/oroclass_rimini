/**
 * OroClass Finance - Script.js
 * Fintech UX/UI 2026 Edition
 * Features: Transparent Calculator, Real-Time Ticker, Haptic Feedback, Accessibility
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

    // --- Fintech Transparent Calculator ---
    const weightSlider = document.getElementById('weight-slider');
    const weightValDisplay = document.getElementById('weight-val');
    const metalSelect = document.getElementById('metal-type');
    const resultDisplay = document.getElementById('result-display');

    // Breakdown Elements
    const bdSpot = document.getElementById('bd-spot');
    const bdPurity = document.getElementById('bd-purity');
    const bdGross = document.getElementById('bd-gross');
    const bdSpread = document.getElementById('bd-spread');

    const SPREAD_PER_GRAM = 0.25; // Our transparent fee

    function calculateFintechValue() {
        const weight = parseFloat(weightSlider.value);
        const selectedOption = metalSelect.options[metalSelect.selectedIndex];
        const spotPrice = parseFloat(selectedOption.value);
        const purityFactor = parseFloat(selectedOption.getAttribute('data-purity'));
        const purityLabel = selectedOption.getAttribute('data-label');

        // Update Weight Display
        if (weightValDisplay) weightValDisplay.textContent = weight.toFixed(1);

        // Calculate breakdown
        const grossPerGram = spotPrice * purityFactor;
        const netPerGram = grossPerGram - SPREAD_PER_GRAM;
        const totalPayout = netPerGram * weight;

        // Format currency
        const formatter = new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' });

        // Update UI breakdown (Anchoring Effect)
        if (bdSpot) bdSpot.textContent = `€ ${spotPrice.toFixed(2)} /gr`;
        if (bdPurity) bdPurity.textContent = `× ${purityFactor.toFixed(3)} (${purityLabel})`;
        if (bdGross) bdGross.textContent = `€ ${grossPerGram.toFixed(2)}`;
        if (bdSpread) bdSpread.textContent = `- € ${SPREAD_PER_GRAM.toFixed(2)} /gr`;
        if (resultDisplay) resultDisplay.textContent = formatter.format(totalPayout);

        // Haptic feedback on significant recalculation
        if (navigator.vibrate) navigator.vibrate(5);
    }

    // Event Listeners for Calculator
    if (weightSlider) {
        weightSlider.addEventListener('input', calculateFintechValue);
    }
    if (metalSelect) {
        metalSelect.addEventListener('change', calculateFintechValue);
    }
    // Initial calculation on load
    calculateFintechValue();

    // --- Lock Price Handler (Haptic) ---
    const lockBtn = document.getElementById('lock-btn');
    if (lockBtn) {
        lockBtn.addEventListener('click', () => {
            if (navigator.vibrate) navigator.vibrate([50, 30, 50]); // Success pattern
            const code = `FIN-${Date.now().toString().slice(-6)}`;
            alert(`🔒 PREZZO BLOCCATO!\n\nCodice Voucher: ${code}\n\nMostra questo codice in negozio entro 24h per mantenere la quotazione.`);
        });
    }

    // --- FAQ Accordion (Accessibility) ---
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

    // --- Real-Time Ticker Simulation ---
    function updateTicker() {
        const tickerItems = document.querySelectorAll('.ticker-value');
        tickerItems.forEach(item => {
            let text = item.textContent.replace('€', '').trim();
            let val = parseFloat(text);
            if (!isNaN(val)) {
                const fluctuation = (Math.random() - 0.5) * 0.1;
                let newVal = val + fluctuation;
                item.textContent = `€ ${newVal.toFixed(2)}`;

                // Color feedback
                item.style.transition = 'color 0.3s';
                item.style.color = fluctuation > 0 ? 'var(--color-success)' : 'var(--color-danger)';
                setTimeout(() => { item.style.color = ''; }, 1500);
            }
        });
        // Also recalculate if calculator is visible
        calculateFintechValue();
    }
    setInterval(updateTicker, 20000); // Every 20 seconds

    // --- Countdown Timer ---
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
