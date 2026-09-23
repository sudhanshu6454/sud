<?php
/**
 * The four brands, keyed by host. Mirrors the `brand:` blocks in autopub/config/sites.yaml so the
 * bio page is drawn in the same palette and typeface as the cards that send people to it.
 *
 * One plugin, four sites: the host the page is served from picks the row. An unknown host gets
 * a neutral fallback rather than an error, so a staging domain still renders.
 */
if ( ! defined( 'ABSPATH' ) && ! defined( 'FLEET_BIO_PREVIEW' ) ) { exit; }

function fleet_bio_brands(): array {
	return array(
		'marketingmentalist.in' => array(
			'name'      => 'Marketing Mentalist',
			'tagline'   => 'The psychology behind marketing that works',
			'primary'   => '#0a0908', 'accent' => '#b8492f', 'text' => '#f7f5ef',
			'font'      => 'Instrument Sans', 'font_query' => 'Instrument+Sans:wght@400;500;600;700',
			'logo'      => 'marketing-mentalist-logo.png',
			'instagram' => 'marketing_mentalist',
			'facebook'  => 'https://www.facebook.com/1348276788362150',
			'rail'      => 'solid',
		),
		'crazy4marketing.com' => array(
			'name'      => 'Crazy4Marketing',
			'tagline'   => 'Growth, performance and the ideas behind the numbers',
			'primary'   => '#0a0a0a', 'accent' => '#ff3366', 'text' => '#f5f1ea',
			'font'      => 'Space Grotesk', 'font_query' => 'Space+Grotesk:wght@400;500;600;700',
			'logo'      => 'crazy4marketing-logo.png',
			'instagram' => 'crazy4marketingg',
			'facebook'  => 'https://www.facebook.com/1424415010744386',
			'rail'      => 'double',
		),
		'marketingjunkies.in' => array(
			'name'      => 'Marketing Junkies',
			'tagline'   => 'Your daily fix of marketing, media and martech news',
			'primary'   => '#1c1b1a', 'accent' => '#8a6d47', 'text' => '#fbf8f3',
			'font'      => 'Archivo', 'font_query' => 'Archivo:wght@400;500;600;700;800',
			'logo'      => 'marketing-junkies-logo.png',
			'instagram' => 'marketing_junkies',
			'facebook'  => 'https://www.facebook.com/1324820977386206',
			'rail'      => 'inset',
		),
		'screenstat.in' => array(
			'name'      => 'ScreenStat',
			'tagline'   => 'Box office, streaming and the business of screens',
			'primary'   => '#16181D', 'accent' => '#EE5A3C', 'text' => '#FFFFFF',
			'font'      => 'Inter', 'font_query' => 'Inter:wght@400;500;600;700',
			'logo'      => 'screenstat-logo.png',
			'instagram' => 'screenstat',
			'facebook'  => 'https://www.facebook.com/788286924360990',
			'rail'      => 'bars',
		),
	);
}

function fleet_bio_brand_for( string $host ): array {
	$host   = strtolower( preg_replace( '/^www\./', '', $host ) );
	$brands = fleet_bio_brands();
	if ( isset( $brands[ $host ] ) ) {
		return $brands[ $host ];
	}
	return array(
		'name' => $host, 'tagline' => '', 'primary' => '#0f172a', 'accent' => '#f97316', 'text' => '#ffffff',
		'font' => 'Inter', 'font_query' => 'Inter:wght@400;500;600;700', 'logo' => '',
		'instagram' => '', 'facebook' => '', 'rail' => 'solid',
	);
}
