<?php
/*
 * Serves an event page (/renginiai/some-name-123) as the normal app page with that event's own link preview tags, because
 * Messenger, Facebook and other link previews read the HTML without running the app's JavaScript.
 * Anything unexpected serves the app page unchanged, so visitors are never affected.
 * The build copies this file into dist/ and fills in the API address (scripts/configure-web-output.ts).
 */
declare(strict_types=1);

// A PHP notice printed into the page would break both the app and the preview.
ini_set('display_errors', '0');

const API_URL = '%API_URL%';
const APP_URL = 'https://dracula.lt';
const CACHE_SECONDS = 600;

header('Content-Type: text/html; charset=utf-8');
header('Cache-Control: no-cache');

$page = (string) @file_get_contents(__DIR__ . '/index.html');
$id = isset($_GET['id']) && is_string($_GET['id']) ? $_GET['id'] : '';
$event = preg_match('/^[1-9][0-9]{0,11}$/', $id) ? load_event($id) : null;
echo $event ? with_preview($page, $event) : $page;

/** The public event, cached briefly so repeated shares do not each wait for the API. */
function load_event(string $id): ?array
{
    $cache = sys_get_temp_dir() . '/dracula-preview-' . $id . '.json';
    if (is_file($cache) && time() - (int) filemtime($cache) < CACHE_SECONDS) {
        $cached = json_decode((string) file_get_contents($cache), true);
        return is_array($cached) ? $cached : null;
    }
    $body = fetch(API_URL . '/v1/events/' . $id);
    $event = $body === null ? null : json_decode($body, true);
    if (!is_array($event) || !isset($event['id'], $event['title'])) {
        return null;
    }
    @file_put_contents($cache, $body, LOCK_EX);
    return $event;
}

function fetch(string $url): ?string
{
    if (function_exists('curl_init')) {
        $curl = curl_init($url);
        curl_setopt_array($curl, [CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 3, CURLOPT_CONNECTTIMEOUT => 2, CURLOPT_FOLLOWLOCATION => false]);
        $body = curl_exec($curl);
        $status = curl_getinfo($curl, CURLINFO_RESPONSE_CODE);
        return is_string($body) && $status === 200 ? $body : null;
    }
    $context = stream_context_create(['http' => ['timeout' => 3, 'follow_location' => 0, 'ignore_errors' => true]]);
    $body = @file_get_contents($url, false, $context);
    $headers = function_exists('http_get_last_response_headers') ? (http_get_last_response_headers() ?? []) : ($http_response_header ?? []);
    return is_string($body) && isset($headers[0]) && str_contains($headers[0], ' 200') ? $body : null;
}

function with_preview(string $page, array $event): string
{
    $title = clean((string) $event['title']);
    $details = implode(' · ', array_filter([when($event), place($event), clean((string) ($event['price_text'] ?? '')) ?: (($event['price_type'] ?? '') === 'free' ? 'Nemokamas' : '')]));
    $summary = shorten(clean((string) ($event['description'] ?? '')), 160);
    $description = $details . ($details && $summary ? '. ' : '') . $summary;
    $image = is_string($event['image_url'] ?? null) && str_starts_with($event['image_url'], 'https://') ? $event['image_url'] : APP_URL . '/share.jpg';
    $url = APP_URL . '/renginiai/' . segment($event);
    $tags = [
        ['name', 'description', $description],
        ['property', 'og:site_name', 'Dracula'],
        ['property', 'og:type', 'website'],
        ['property', 'og:title', $title],
        ['property', 'og:description', $description],
        ['property', 'og:url', $url],
        ['property', 'og:image', $image],
        ['property', 'og:locale', 'lt_LT'],
        ['name', 'twitter:card', 'summary_large_image'],
    ];
    $block = implode("\n    ", array_map(fn ($tag) => sprintf('<meta %s="%s" content="%s" />', $tag[0], $tag[1], escape($tag[2])), $tags))
        . "\n    " . sprintf('<link rel="canonical" href="%s" />', escape($url));
    $page = preg_replace('/<!-- preview:.*?<!-- \/preview -->/s', $block, $page, 1) ?? $page;
    return preg_replace('/<title>.*?<\/title>/s', '<title>' . escape($title . ' · Dracula') . '</title>', $page, 1) ?? $page;
}

/** "Gruodžio 8 d., 20:00", the way the app writes dates. */
function when(array $event): string
{
    $date = (string) ($event['event_date'] ?? '');
    if (!preg_match('/^\d{4}-(\d{2})-(\d{2})$/', $date, $parts)) {
        return '';
    }
    $months = ['sausio', 'vasario', 'kovo', 'balandžio', 'gegužės', 'birželio', 'liepos', 'rugpjūčio', 'rugsėjo', 'spalio', 'lapkričio', 'gruodžio'];
    $text = $months[(int) $parts[1] - 1] . ' ' . (int) $parts[2] . ' d.';
    $text = mb_strtoupper(mb_substr($text, 0, 1)) . mb_substr($text, 1);
    $times = array_values(array_filter(array_map(fn ($slot) => is_array($slot) && ($slot['date'] ?? '') === $date ? (string) ($slot['time'] ?? '') : '', is_array($event['times'] ?? null) ? $event['times'] : [])));
    if ($times) {
        return $text . ', ' . implode(', ', $times);
    }
    $time = (string) ($event['event_time'] ?? '');
    return preg_match('/^\d{2}:\d{2}$/', $time) ? $text . ', ' . $time : $text;
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

function place(array $event): string
{
    $venue = clean((string) ($event['venue'] ?? ''));
    $city = clean((string) ($event['city'] ?? ''));
    return $venue && $city && !str_contains(mb_strtolower($venue), mb_strtolower($city)) ? "$venue, $city" : ($venue ?: $city);
}

/** Plain text: no markup, decoded entities, single spaces. */
function clean(string $text): string
{
    return trim((string) preg_replace('/\s+/u', ' ', html_entity_decode(strip_tags($text), ENT_QUOTES | ENT_HTML5, 'UTF-8')));
}

function shorten(string $text, int $length): string
{
    if (mb_strlen($text) <= $length) {
        return $text;
    }
    $cut = mb_substr($text, 0, $length);
    $space = mb_strrpos($cut, ' ');
    return rtrim($space ? mb_substr($cut, 0, $space) : $cut, " ,.;:–-") . '…';
}

function escape(string $text): string
{
    return htmlspecialchars($text, ENT_QUOTES | ENT_HTML5, 'UTF-8');
}
