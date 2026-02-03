<?php
/**
 * Smart Metals API - OroClass Rimini
 * 
 * Merges Gold (XAU) and Silver (XAG) fetching into a single request workflow.
 * Implements strict 24-HOUR caching to respect the 100 req/month limit.
 * 
 * Logic:
 * 1. Check Cache (valid for 24h).
 * 2. If expired -> Fetch XAU + XAG.
 * 3. Save merged JSON.
 * 4. Fallback to old cache on failure.
 */

header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *'); // Allow usage from frontend
header('Access-Control-Allow-Methods: GET');

// Configuration
$cacheFile = 'metals_cache.json';
$cacheDuration = 86400; // 24 Hours in seconds
$apiKey = 'goldapi-dpqtzq19ml6skwl5-io'; // Provided API Key

// Helper to send response and exit
function sendJSON($data)
{
    if (is_array($data) || is_object($data)) {
        echo json_encode($data, JSON_PRETTY_PRINT);
    } else {
        echo $data;
    }
    exit;
}

// --- 1. SMART CACHE CHECK ---
if (file_exists($cacheFile)) {
    $lastModified = filemtime($cacheFile);
    $age = time() - $lastModified;

    // If cache is fresh (less than 24h old), use it.
    if ($age < $cacheDuration) {
        $cachedContent = file_get_contents($cacheFile);
        // Basic validation to ensure file isn't empty/corrupt
        if (!empty($cachedContent) && json_decode($cachedContent)) {
            sendJSON($cachedContent); // STOP HERE
        }
    }
}

// --- 2. DATA FETCHING (Only if Cache Expired) ---

function fetchMetal($symbol, $apiKey)
{
    $url = "https://www.goldapi.io/api/{$symbol}/EUR";

    $ch = curl_init();
    curl_setopt_array($ch, [
        CURLOPT_URL => $url,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_TIMEOUT => 15, // Moderate timeout
        CURLOPT_HTTPHEADER => [
            "x-access-token: $apiKey",
            "Content-Type: application/json"
        ]
    ]);

    $response = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $error = curl_error($ch);
    curl_close($ch);

    if ($httpCode === 200 && $response) {
        $data = json_decode($response, true);
        if (isset($data['price'])) {
            return $data;
        }
    }

    return null; // Failure signal
}

// Execute Calls
$goldData = fetchMetal('XAU', $apiKey);
$silverData = fetchMetal('XAG', $apiKey);

// --- 3. MERGE & SAVE ---

// Only update if BOTH calls succeeded to ensure data consistency
if ($goldData && $silverData) {

    $mergedData = [
        'gold' => $goldData,
        'silver' => $silverData,
        'updated_at' => time(),
        'updated_human' => date('d/m/Y H:i:s')
    ];

    $jsonStr = json_encode($mergedData, JSON_PRETTY_PRINT);

    // Atomically write cache (or just standard overwrite)
    file_put_contents($cacheFile, $jsonStr);

    sendJSON($jsonStr);

} else {
    // --- 4. FALLBACK STRATEGY ---

    // One or both APIs failed (Limit reached? Maintenance?).
    // If we have an OLD cache file, serve that instead of breaking the site.

    if (file_exists($cacheFile)) {
        $staleContent = file_get_contents($cacheFile);
        if ($staleContent) {
            // Optional: Add a header to indicate stale data
            // header('X-Data-Status: Stale');
            sendJSON($staleContent);
        }
    }

    // Absolute Failure (No cache, API Error)
    http_response_code(503);
    echo json_encode([
        'error' => 'Service Unavailable',
        'message' => 'Unable to retrieve metal prices and no cache available.'
    ]);
}
?>