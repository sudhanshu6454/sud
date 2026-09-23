<?php
/**
 * Render the bio page for one brand without WordPress, for a visual check:
 *   php tests/preview.php crazy4marketing.com > /tmp/bio-crazy.html
 * Stubs only the escapers the renderer uses; everything else is plain PHP.
 */
define( 'FLEET_BIO_PREVIEW', true );
function esc_html( $s ) { return htmlspecialchars( (string) $s, ENT_QUOTES | ENT_HTML5, 'UTF-8' ); }
function esc_attr( $s ) { return esc_html( $s ); }
function esc_url( $s ) { return esc_html( $s ); }
require __DIR__ . '/../includes/brands.php';
require __DIR__ . '/../includes/render.php';

$host  = $argv[1] ?? 'crazy4marketing.com';
$brand = fleet_bio_brand_for( $host );
$logo  = $brand['logo'] ? 'file://' . realpath( __DIR__ . '/../assets/' . $brand['logo'] ) : '';
$site  = array( 'name' => $brand['name'], 'tagline' => $brand['tagline'], 'home' => "https://$host/", 'logo_url' => $logo, 'generated' => gmdate( 'c' ) );
$titles = array(
	array( 'Why nobody buys media without a rulebook', 'Performance', '38 mins' ),
	array( 'Dollars no longer buy happiness, and brands are feeling it', 'Consumer Behaviour', '2 hours' ),
	array( 'IAA India wraps a two-year AI, skilling and ethics agenda', 'Agencies', '3 hours' ),
	array( 'Hanuman Ansh hits 350 crore worldwide on a 2 crore budget', 'Box Office', '4 hours' ),
	array( 'Google fined $403 million over location data: what it means for marketers', 'Privacy', '5 hours' ),
	array( 'The muddled class: the middle class is becoming too large and too diverse to target', 'Segmentation', '6 hours' ),
);
$posts = array();
foreach ( $titles as $i => [ $t, $c, $w ] ) {
	$hue = ( 30 + $i * 47 ) % 360;
	$svg = "<svg xmlns='http://www.w3.org/2000/svg' width='600' height='400'><rect width='600' height='400' fill='hsl($hue 30% 35%)'/><circle cx='430' cy='150' r='120' fill='hsl($hue 40% 55%)'/></svg>";
	$posts[] = array( 'url' => "https://$host/story-$i/", 'title' => $t, 'category' => $c, 'when' => "$w ago",
		'image' => $i === 3 ? '' : 'data:image/svg+xml;utf8,' . rawurlencode( $svg ) );
}
echo fleet_bio_render( $brand, $site, $posts );
