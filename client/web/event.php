<?php
/*
 * Serves an event page (/renginiai/some-name-123) as the normal app page with that event's own link preview tags, because
 * Messenger, Facebook and other link previews read the HTML without running the app's JavaScript.
 * Anything unexpected serves the app page unchanged, so visitors are never affected.
 * It also adds the event's details in the schema.org format search engines read for event listings.
 * The build copies this file and common.php into dist/ (scripts/configure-web-output.ts).
 */
declare(strict_types=1);

require __DIR__ . '/common.php';

const CACHE_SECONDS = 600;
// Days after an event's last day that its page stays in search results; searchDaysAfterEnd in src/utils/event-url.ts.
const SEARCH_DAYS_AFTER_END = 3;

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

function with_preview(string $page, array $event): string
{
    $title = clean((string) $event['title']);
    $details = implode(' · ', array_filter([when($event), place($event), clean((string) ($event['price_text'] ?? '')) ?: (($event['price_type'] ?? '') === 'free' ? 'Nemokamas' : '')]));
    $summary = shorten(clean((string) ($event['description'] ?? '')), 160);
    $description = $details . ($details && $summary ? '. ' : '') . $summary;
    $image = is_string($event['image_url'] ?? null) && str_starts_with($event['image_url'], 'https://') ? $event['image_url'] : APP_URL . '/share.jpg';
    $url = event_url($event);
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
        . "\n    " . sprintf('<link rel="canonical" href="%s" />', escape($url))
        . (hidden_from_search($event) ? "\n    " . '<meta name="robots" content="noindex" />' : '')
        . structured_data($event, $url, $image, $summary);
    $page = preg_replace('/<!-- preview:.*?<!-- \/preview -->/s', $block, $page, 1) ?? $page;
    return preg_replace('/<title>.*?<\/title>/s', '<title>' . escape($title . ' · Dracula') . '</title>', $page, 1) ?? $page;
}

/**
 * Whether search engines should drop the page: the event's last day (end date or last showing) was more than
 * SEARCH_DAYS_AFTER_END days ago in Vilnius. The page itself keeps working for saved and shared links. Same rule as
 * hiddenFromSearch() in src/utils/event-url.ts.
 */
function hidden_from_search(array $event): bool
{
    $days = [$event['event_date'] ?? null, $event['event_end_date'] ?? null];
    foreach (is_array($event['times'] ?? null) ? $event['times'] : [] as $slot) {
        $days[] = is_array($slot) ? ($slot['date'] ?? null) : null;
    }
    $days = array_filter($days, fn ($day) => is_string($day) && preg_match('/^\d{4}-\d{2}-\d{2}$/', $day));
    if (!$days) {
        return false;
    }
    try {
        $until = (new DateTimeImmutable(max($days)))->modify('+' . SEARCH_DAYS_AFTER_END . ' days')->format('Y-m-d');
    } catch (Exception) {
        return false;
    }
    return (new DateTimeImmutable('now', new DateTimeZone('Europe/Vilnius')))->format('Y-m-d') > $until;
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

function place(array $event): string
{
    $venue = clean((string) ($event['venue'] ?? ''));
    $city = clean((string) ($event['city'] ?? ''));
    return $venue && $city && !str_contains(mb_strtolower($venue), mb_strtolower($city)) ? "$venue, $city" : ($venue ?: $city);
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

/**
 * The event as schema.org data, which search engines use for event listings (date, place, price, image).
 * Left out when the event has no date, since a date is required.
 */
function structured_data(array $event, string $url, string $image, string $summary): string
{
    $start = moment((string) ($event['event_date'] ?? ''), first_time($event));
    if ($start === null) {
        return '';
    }
    $endDate = (string) ($event['event_end_date'] ?? '') ?: (string) ($event['event_date'] ?? '');
    $end = moment($endDate, (string) ($event['event_end_time'] ?? ''));
    $venue = clean((string) ($event['venue'] ?? ''));
    $city = clean((string) ($event['city'] ?? '')) ?: 'Vilnius';
    $offer = ['@type' => 'Offer', 'url' => is_string($event['ticket_url'] ?? null) && str_starts_with($event['ticket_url'], 'https://') ? $event['ticket_url'] : $url, 'priceCurrency' => 'EUR'];
    if (($event['price_type'] ?? '') === 'free') {
        $offer['price'] = 0;
    }
    $data = array_filter([
        '@context' => 'https://schema.org',
        '@type' => 'MusicEvent',
        'name' => clean((string) $event['title']),
        'startDate' => $start,
        'endDate' => end_date($start, $end),
        'eventStatus' => 'https://schema.org/EventScheduled',
        'eventAttendanceMode' => 'https://schema.org/OfflineEventAttendanceMode',
        'location' => ['@type' => 'Place', 'name' => $venue ?: $city, 'address' => ['@type' => 'PostalAddress', 'addressLocality' => $city, 'addressCountry' => 'LT']],
        'image' => [$image],
        'description' => $summary ?: null,
        'url' => $url,
        'offers' => $offer,
    ], fn ($value) => $value !== null);
    $json = json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_HEX_TAG | JSON_HEX_AMP);
    return $json === false ? '' : "\n    <script type=\"application/ld+json\">" . $json . '</script>';
}

/**
 * The end for search engines. A date without a time means "ends that day": a same-day event with no end time gets its
 * own date, without making up a time. An end time earlier than the start (often one past midnight) is left out.
 */
function end_date(string $start, ?string $end): ?string
{
    if ($end === null) {
        return null;
    }
    if (strlen($end) === 10) {
        return $end >= substr($start, 0, 10) ? $end : null;
    }
    return $end > $start ? $end : null;
}

/** The first start time on the event's first day: a listed showing, or the event's own time. */
function first_time(array $event): string
{
    $date = (string) ($event['event_date'] ?? '');
    foreach (is_array($event['times'] ?? null) ? $event['times'] : [] as $slot) {
        if (is_array($slot) && ($slot['date'] ?? '') === $date && preg_match('/^\d{2}:\d{2}$/', (string) ($slot['time'] ?? ''))) {
            return (string) $slot['time'];
        }
    }
    return (string) ($event['event_time'] ?? '');
}

/** "2026-12-08T20:00:00+02:00" in Vilnius time, "2026-12-08" without a time, or null without a valid date. */
function moment(string $date, string $time): ?string
{
    if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $date)) {
        return null;
    }
    if (!preg_match('/^\d{2}:\d{2}$/', $time)) {
        return $date;
    }
    try {
        return (new DateTimeImmutable("$date $time", new DateTimeZone('Europe/Vilnius')))->format('c');
    } catch (Exception) {
        return $date;
    }
}
