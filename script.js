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
    const sectionTitle = document.getElementById('calc-title');
    const countdownDisplay = document.getElementById('ticker-countdown');
    const marketStatusWidget = document.getElementById('market-status-widget');
    const statusDot = marketStatusWidget?.querySelector('.status-dot');
    const statusText = marketStatusWidget?.querySelector('.status-text');
    const statusSubtext = marketStatusWidget?.querySelector('.status-subtext');

    // --- 2. TRADINGVIEW WIDGET INJECTION (Fixes HTML Linting) ---
    // --- 2. TRADINGVIEW WIDGET INJECTION (Financial Terminal) ---
    const tvContainer = document.getElementById('tv-hero-chart') || document.getElementById('tv-mini-chart');
    if (tvContainer) {
        const script = document.createElement('script');
        script.type = 'text/javascript';
        script.src = 'https://s3.tradingview.com/external-embedding/embed-widget-mini-symbol-overview.js';
        script.async = true;
        script.innerHTML = JSON.stringify({
            "symbol": "FX_IDC:XAUEUR",
            "width": "100%",
            "height": "100%",
            "locale": "it",
            "dateRange": "1M",
            "colorTheme": "dark",
            "isTransparent": true,
            "autosize": true,
            "largeChartUrl": ""
        });
        tvContainer.appendChild(script);
    }

    // --- 2.1 SOCIAL PROOF SLIDER (Mobile) ---
    const swiperEl = document.querySelector('.social-proof-slider');
    if (swiperEl) {
        new Swiper('.social-proof-slider', {
            loop: true,
            speed: 600,
            autoplay: {
                delay: 3000,
                disableOnInteraction: false,
            },
            slidesPerView: 'auto',
            centeredSlides: true,
            spaceBetween: 16,
            pagination: {
                el: '.swiper-pagination',
                clickable: true,
            },
            effect: 'slide',
            grabCursor: true
        });
    }

    // --- 3. MOBILE MENU TOGGLE ---
    const menuToggle = document.querySelector('.menu-toggle');
    const navMenu = document.querySelector('.mobile-nav-overlay');

    function closeMenu() {
        if (navMenu && menuToggle) {
            navMenu.classList.remove('active');
            menuToggle.setAttribute('aria-expanded', 'false');

            // Simple unlock & cleanup
            document.body.style.overflow = '';
            navMenu.style.position = '';
            navMenu.style.top = '';
            navMenu.style.height = '';
        }
    }

    function openMenu() {
        if (navMenu && menuToggle) {
            navMenu.classList.add('active');
            menuToggle.setAttribute('aria-expanded', 'true');

            // ROBUST LAYOUT FIX:
            // Force absolute positioning + scrollY to bypass any 'transform' on body
            // which breaks specific mobile browsers' 'position: fixed'.
            const scrollY = window.scrollY;
            navMenu.style.position = 'absolute';
            navMenu.style.top = `${scrollY}px`;
            navMenu.style.height = `${window.innerHeight}px`;

            // Lock body
            document.body.style.overflow = 'hidden';

            // Reset internal scroll list
            navMenu.scrollTop = 0;
        }
    }

    if (menuToggle && navMenu) {
        menuToggle.addEventListener('click', (e) => {
            e.stopPropagation();
            const isExpanded = menuToggle.getAttribute('aria-expanded') === 'true';
            if (isExpanded) {
                closeMenu();
            } else {
                openMenu();
            }
        });
    }

    // Close button event listener
    const closeBtn = document.querySelector('.close-menu-btn');
    if (closeBtn) {
        closeBtn.addEventListener('click', closeMenu);
    }

    // Close menu when clicking on nav links (Desktop & Mobile)
    const navLinks = document.querySelectorAll('.nav-link, .mobile-nav-item');
    navLinks.forEach(link => {
        link.addEventListener('click', () => {
            closeMenu();
        });
    });

    // Close menu when clicking on Mobile CTA
    const mobileCtaLink = document.querySelector('.mobile-nav-footer a');
    if (mobileCtaLink) {
        mobileCtaLink.addEventListener('click', closeMenu);
    }

    // Close menu when clicking on the overlay (outside nav links)
    if (navMenu) {
        navMenu.addEventListener('click', (e) => {
            // Only close if clicking directly on nav-menu (not on children)
            if (e.target === navMenu) {
                closeMenu();
            }
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

    // --- 6. SMART PRICING FETCH ---
    async function updatePrices() {
        try {
            const response = await fetch(API_URL);
            const data = await response.json();

            if (data && data.gold && data.silver) {
                // Normalize prices to EUR per GRAM (handles oz conversion if needed)
                const rawGold24k = normalizePricePerGram(data.gold, 'gold');
                const rawSilver999 = normalizePricePerGram(data.silver, 'silver');

                // Apply Market-Based Spreads to Base Prices
                basePrices.gold = rawGold24k * PAYOUT_GOLD;
                basePrices.silver = rawSilver999 * PAYOUT_SILVER;

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

                    if (sectionTitle && document.getElementById('price-badge')) {
                        const badge = document.getElementById('price-badge');
                        if (badge) badge.remove();
                    }

                    // Start countdown to next market open
                    const nextMarketOpen = getNextMarketOpenTimestamp();
                    startCountdown(nextMarketOpen);
                }

            } else {
                throw new Error('Invalid JSON structure');
            }
        } catch (error) {
            console.error('Price Fetch Error:', error);
            // Fallback values (Approximate safe values to prevent 0)
            basePrices.gold = 50.00; // ~83 spot * 0.60
            basePrices.silver = 0.50; // ~0.83 spot * 0.60
        }
    }

    // --- 7. EVENT LISTENERS ---

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

    // --- 1. HEADER SCROLL EFFECT (Optimized) ---
    const header = document.querySelector('.site-header');

    function updateHeader() {
        if (!header) return;
        if (window.scrollY > 50) {
            header.classList.add('scrolled');
        } else {
            header.classList.remove('scrolled');
        }
    }

    if (header) {
        window.addEventListener('scroll', updateHeader, { passive: true });
        // Initial check
        updateHeader();
    }

    // --- 10. INITIALIZATION ---
    updatePrices();

    // Check market status immediately and update every minute
    checkMarketStatus();
    setInterval(checkMarketStatus, 60000);
});

// =======================
// Lightbox Logic (Global)
// =======================
let currentLightboxImages = [];
let currentLightboxIndex = 0;

function initLightbox() {
    const lightboxHtml = `
        <div id="vetrina-lightbox" class="lightbox-modal" style="display: none;">
            <button class="lightbox-close" onclick="closeLightbox()">&times;</button>
            <button class="lightbox-prev" onclick="prevLightboxImage()">&#10094;</button>
            <img id="lightbox-img" class="lightbox-content" src="">
            <button class="lightbox-next" onclick="nextLightboxImage()">&#10095;</button>
            <div id="lightbox-caption" style="color: #ccc; margin-top: 10px; font-family: 'Inter', sans-serif;"></div>
        </div>
    `;
    document.body.insertAdjacentHTML('beforeend', lightboxHtml);

    document.getElementById('vetrina-lightbox').addEventListener('click', function (e) {
        if (e.target === this) closeLightbox();
    });

    document.addEventListener('keydown', function (e) {
        if (document.getElementById('vetrina-lightbox').style.display === 'flex') {
            if (e.key === 'Escape') closeLightbox();
            if (e.key === 'ArrowLeft') prevLightboxImage();
            if (e.key === 'ArrowRight') nextLightboxImage();
        }
    });
}

function openLightbox(images, index, title) {
    currentLightboxImages = images;
    currentLightboxIndex = index;
    const modal = document.getElementById('vetrina-lightbox');
    const imgEl = document.getElementById('lightbox-img');
    const caption = document.getElementById('lightbox-caption');

    imgEl.src = currentLightboxImages[currentLightboxIndex];
    caption.textContent = title;

    modal.style.display = 'flex';
    document.body.style.overflow = 'hidden';
}

function openItemLightbox(itemIndex, imgIndex) {
    if (!window.vetrinaData || !window.vetrinaData[itemIndex]) return;
    const item = window.vetrinaData[itemIndex];

    const imgList = (item.images && item.images.length > 0) ? item.images : [item.image || ''];
    const cleanImgs = imgList.filter(src => src);
    if (cleanImgs.length === 0) cleanImgs.push('https://placehold.co/600x400?text=No+Image');

    openLightbox(cleanImgs, imgIndex, item.title);
}

function closeLightbox() {
    document.getElementById('vetrina-lightbox').style.display = 'none';
    document.body.style.overflow = 'auto';
}

function nextLightboxImage() {
    currentLightboxIndex = (currentLightboxIndex + 1) % currentLightboxImages.length;
    document.getElementById('lightbox-img').src = currentLightboxImages[currentLightboxIndex];
}

function prevLightboxImage() {
    currentLightboxIndex = (currentLightboxIndex - 1 + currentLightboxImages.length) % currentLightboxImages.length;
    document.getElementById('lightbox-img').src = currentLightboxImages[currentLightboxIndex];
}

// =======================
// Vetrina Logic
// =======================
async function loadVetrina() {
    const grid = document.getElementById('vetrina-grid');
    if (!grid) return;

    try {
        const response = await fetch('data/articoli.json');
        if (!response.ok) throw new Error('Errore nel caricamento dati');

        const articoli = await response.json();

        if (articoli.length === 0) {
            grid.innerHTML = '<p class="text-muted text-center">Nessun articolo disponibile al momento.</p>';
            return;
        }

        // Store global for lightbox and pagination reference
        window.vetrinaData = articoli;

        renderVetrina(false);
    } catch (error) {
        console.error('Errore vetrina:', error);
        grid.innerHTML = '<p class="text-danger text-center">Impossibile caricare la vetrina. Riprova più tardi.</p>';
    }
}

function renderVetrina(showAll = false) {
    const grid = document.getElementById('vetrina-grid');
    if (!grid || !window.vetrinaData) return;

    const isMobile = window.innerWidth <= 768;
    // Filter out sold items for the public site
    const articoli = (window.vetrinaData || []).filter(item => !item.sold);
    const renderAllArticoli = document.body.classList.contains('vetrina-page');
    // If on homepage, limit to 3. If on vetrina page, show all available.
    const limit = renderAllArticoli ? articoli.length : (isMobile ? 3 : 3);

    const visibleItems = articoli.slice(0, limit);

    grid.innerHTML = visibleItems.map((item, itemIdx) => {
        const imgList = (item.images && item.images.length > 0) ? item.images : [item.image || ''];
        // Filter empty
        const cleanImgs = imgList.filter(src => src);
        if (cleanImgs.length === 0) cleanImgs.push('https://placehold.co/600x400?text=No+Image');

        return `
            <div class="vetrina-card">
                <!-- 1. Title Top (Gold, Bold) -->
                <div class="vetrina-header">
                    <h3 class="vetrina-title">${item.title}</h3>
                </div>

                <!-- 2. Carousel / Image -->
                <div class="vetrina-carousel-wrapper">
                    <!-- Left Arrow (Hidden initially) -->
                    ${(cleanImgs.length > 1)
                ? '<div class="scroll-arrow prev" style="display: none;" onclick="const c = this.parentElement.querySelector(\'.vetrina-carousel\'); c.scrollBy({left: -c.offsetWidth, behavior: \'smooth\'})">←</div>'
                : ''}
                    
                    <div class="vetrina-carousel" onscroll="const p=this.parentElement.querySelector(\'.scroll-arrow.prev\'); const n=this.parentElement.querySelector(\'.scroll-arrow.next\'); if(p) p.style.display = this.scrollLeft > 20 ? \'flex\' : \'none\'; if(n) n.style.display = (this.scrollLeft + this.offsetWidth < this.scrollWidth - 20) ? \'flex\' : \'none\';">
                        ${cleanImgs.map((img, imgIdx) =>
                    `<img src="${img}" alt="${item.title}" loading="lazy"
                                 style="cursor: zoom-in;"
                                 onclick="openItemLightbox(${itemIdx}, ${imgIdx})">`
                ).join('')}
                    </div>
                    
                    <!-- Right Arrow -->
                    ${(cleanImgs.length > 1)
                ? '<div class="scroll-arrow next" onclick="const c = this.parentElement.querySelector(\'.vetrina-carousel\'); c.scrollBy({left: c.offsetWidth, behavior: \'smooth\'})">→</div>'
                : ''}
                </div>

                <!-- 3. Description & Footer -->
                <div class="vetrina-content">
                    <p class="vetrina-desc">${item.description}</p>
                    <div class="vetrina-footer">
                        <span class="vetrina-price">
                            ${(() => {
                const p = parseInt(String(item.price).replace(/[^0-9]/g, '')) || 0;
                if (p === 0) return 'Prezzo su richiesta';
                return new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(p);
            })()}
                        </span>
                        <a href="https://wa.me/393494408810?text=${encodeURIComponent('Salve, sono interessato all\'articolo: ' + item.title)}" 
                           class="btn-vetrina" target="_blank" aria-label="Richiedi info su ${item.title}">
                            Richiedi Info
                        </a>
                    </div>
                </div>
            </div>
        `;
    }).join('');

    // Discovery Button for Homepage
    const loadMoreContainer = document.getElementById('load-more-container');
    if (loadMoreContainer) loadMoreContainer.remove();

    if (!renderAllArticoli && articoli.length > limit) {
        const btnContainer = document.createElement('div');
        btnContainer.id = 'load-more-container';
        btnContainer.style.textAlign = 'center';
        btnContainer.style.marginTop = '4rem';
        btnContainer.innerHTML = `
            <a href="vetrina.html" class="btn btn-primary" style="border-radius: 50px; min-width: 240px;">
                Scopri la Vetrina
                <span style="font-size: 0.9rem; margin-left: 10px; opacity: 0.9;">→</span>
            </a>
            <p style="color: var(--color-text-muted); margin-top: 1rem; font-size: 0.9rem;">
                Tutti i ${articoli.length} articoli disponibili
            </p>
        `;
        grid.after(btnContainer);
    }
}

// Initialize Vetrina and Lightbox
document.addEventListener('DOMContentLoaded', () => {
    initLightbox();
    loadVetrina();

    // Handle screen resize for pagination limits
    let resizeTimer;
    window.addEventListener('resize', () => {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => {
            // Only re-render if we are NOT in "show all" mode
            // We can check if the button exists or use a simple flag if we had one
            renderVetrina(false);
        }, 250);
    });
});
