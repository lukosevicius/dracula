<?php
/*
 * Shared by event.php (link previews and event details for search engines) and sitemap.php.
 * The build copies it into dist/ and fills in the API address (scripts/configure-web-output.ts).
 */
declare(strict_types=1);

// A PHP notice printed into a page would break both the app and the preview.
ini_set('display_errors', '0');

const API_URL = '%API_URL%';
const APP_URL = 'https://dracula.lt';

/** The body of a 200 response, or null for anything else. */
function fetch(string $url, int $timeout = 3): ?string
{
    if (function_exists('curl_init')) {
        $curl = curl_init($url);
        curl_setopt_array($curl, [CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => $timeout, CURLOPT_CONNECTTIMEOUT => 2, CURLOPT_FOLLOWLOCATION => false]);
        $body = curl_exec($curl);
        $status = curl_getinfo($curl, CURLINFO_RESPONSE_CODE);
        return is_string($body) && $status === 200 ? $body : null;
    }
    $context = stream_context_create(['http' => ['timeout' => $timeout, 'follow_location' => 0, 'ignore_errors' => true]]);
    $body = @file_get_contents($url, false, $context);
    $headers = function_exists('http_get_last_response_headers') ? (http_get_last_response_headers() ?? []) : ($http_response_header ?? []);
    return is_string($body) && isset($headers[0]) && str_contains($headers[0], ' 200') ? $body : null;
}

/** "some-name-123", built the same way as eventSegment() in src/utils/event-url.ts. */
function segment(array $event): string
{
    $id = (string) (int) $event['id'];
    $text = clean(preg_replace(['/<[^>]*>/', '/&[a-z]+;/i'], ' ', (string) $event['title']) ?? '');
    if (class_exists('Normalizer')) {
        $text = (string) preg_replace('/\p{M}/u', '', (string) Normalizer::normalize($text, Normalizer::FORM_D));
    }
    $slug = trim((string) preg_replace('/[^a-z0-9]+/', '-', strtolower($text)), '-');
    if (strlen($slug) > 60) {
        $cut = substr($slug, 0, 61);
        $dash = strrpos($cut, '-');
        $slug = rtrim($dash ? substr($cut, 0, $dash) : substr($cut, 0, 60), '-');
    }
    return $slug === '' ? $id : $slug . '-' . $id;
}

function event_url(array $event): string
{
    return APP_URL . '/renginiai/' . segment($event);
}

/** Plain text: no markup, decoded entities, single spaces. */
function clean(string $text): string
{
    return trim((string) preg_replace('/\s+/u', ' ', html_entity_decode(strip_tags($text), ENT_QUOTES | ENT_HTML5, 'UTF-8')));
}

function escape(string $text): string
{
    return htmlspecialchars($text, ENT_QUOTES | ENT_HTML5, 'UTF-8');
}
