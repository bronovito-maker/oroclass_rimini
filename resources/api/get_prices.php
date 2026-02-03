<?php
/**
 * GoldAPI.io Integration for OroClass Rimini
 * 
 * Handles fetching live Gold prices (XAU/EUR) with strict caching 
 * to respect the 100 requests/month limit of the free tier.
 */

// Headers for security and CORS
header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *'); // Adjust in production for better security
header('Access-Control-Allow-Methods: GET');

// Configuration
$cacheFile = 'price_cache.json';
$cacheDuration = 12 * 60 * 60; // 12 Hours in seconds (43200)
$apiKey = 'goldapi-dpqtzq19ml6skwl5-io'; // API Token provided
$apiUrl = 'https://www.goldapi.io/api/XAU/EUR';

// Function to serve cached data
function serveCache($file) {
    if (file_exists($file)) {
        echo file_get_contents($file);
        exit;
    }
    return false;
}

// 1. Check if Cache exists and is fresh
if (file_exists($cacheFile)) {
    $age = time() - filemtime($cacheFile);
    
    // If cache is younger than 12 hours, serve it
    if ($age < $cacheDuration) {
        serveCache($cacheFile);
    }
}

// 2. Cache is old or missing -> Fetch from API
$ch = curl_init();
curl_setopt($ch, CURLOPT_URL, $apiUrl);
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
curl_setopt($ch, CURLOPT_FOLLOWLOCATION, true);
curl_setopt($ch, CURLOPT_TIMEOUT, 10); // Timeout after 10s
curl_setopt($ch, CURLOPT_HTTPHEADER, [
    "x-access-token: $apiKey",
    "Content-Type: application/json"
]);

$response = curl_exec($ch);
$httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
$curlError = curl_error($ch);
curl_close($ch);

// 3. Handle Response
if ($httpCode === 200 && $response) {
    
    // Validate JSON before saving
    $data = json_decode($response);
    
    if ($data && (isset($data->price) || isset($data->ask))) {
        // Success: Save to cache and return
        file_put_contents($cacheFile, $response);
        echo $response;
    } else {
        // API returned 200 but invalid data? Fallback to old cache if possible
        if (file_exists($cacheFile)) {
            // Log error here if needed
            serveCache($cacheFile);
        } else {
            http_response_code(502);
            echo json_encode(['error' => 'Invalid Data received from API']);
        }
    }
    
} else {
    // API Failure (Limit reached, Server down, etc.)
    
    // If we have an OLD cache, it's better to show old price than error
    if (file_exists($cacheFile)) {
        // Consider adding a specific header to indicate stale data?
        // header('X-Data-Source: Stale-Cache'); 
        serveCache($cacheFile);
    } else {
        // No cache, real error
        http_response_code(500);
        echo json_encode([
            'error' => 'Unable to fetch price',
            'details' => $curlError ? $curlError : "HTTP Code $httpCode"
        ]);
    }
}
?>
