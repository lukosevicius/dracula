<?php
/*
 * /sitemap.xml: the home page, the privacy page and every upcoming live event, so search engines find new events quickly.
 * Built from the public API and cached for an hour. If the API is unreachable, the last good copy is served.
 */
declare(strict_types=1);

require __DIR__ . '/common.php';

const SITEMAP_CACHE_SECONDS = 3600;
const PAGE_SIZE = 100;
const MAX_PAGES = 50;

header('Content-Type: application/xml; charset=utf-8');
header('Cache-Control: public, max-age=3600');

$cache = sys_get_temp_dir() . '/dracula-sitemap.xml';
$fresh = is_file($cache) && time() - (int) filemtime($cache) < SITEMAP_CACHE_SECONDS;
$xml = $fresh ? (string) file_get_contents($cache) : build_sitemap();
if ($xml === null || $xml === '') {
    $xml = is_file($cache) ? (string) file_get_contents($cache) : build_sitemap([]);
} elseif (!$fresh) {
    @file_put_contents($cache, $xml, LOCK_EX);
}
echo $xml;

/** All upcoming live events from the API, page by page; null if any page fails, so a partial list is never cached. */
function upcoming_events(): ?array
{
    $events = [];
    for ($page = 0; $page < MAX_PAGES; $page++) {
        $body = fetch(API_URL . '/v1/events?limit=' . PAGE_SIZE . '&offset=' . ($page * PAGE_SIZE), 10);
        $data = $body === null ? null : json_decode($body, true);
        if (!is_array($data) || !is_array($data['items'] ?? null)) {
            return null;
        }
        array_push($events, ...array_filter($data['items'], fn ($event) => is_array($event) && isset($event['id'], $event['title'])));
        if (count($data['items']) < PAGE_SIZE) {
            break;
        }
    }
    return $events;
}

function build_sitemap(?array $events = null): ?string
{
    $events ??= upcoming_events();
    if ($events === null) {
        return null;
    }
    $urls = [APP_URL . '/', APP_URL . '/privatumas'];
    foreach ($events as $event) {
        $urls[] = event_url($event);
    }
    $entries = implode('', array_map(fn ($url) => "  <url><loc>" . escape($url) . "</loc></url>\n", array_unique($urls)));
    return "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<urlset xmlns=\"http://www.sitemaps.org/schemas/sitemap/0.9\">\n" . $entries . "</urlset>\n";
}
