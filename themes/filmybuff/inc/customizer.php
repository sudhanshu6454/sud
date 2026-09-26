<?php
if ( ! defined( 'ABSPATH' ) ) exit;

function fb_customize( $wp_customize ) {
	$wp_customize->add_section( 'fb_brand', array( 'title' => __( 'Filmybuff', 'filmybuff' ), 'priority' => 30 ) );

	$fields = array(
		'fb_show_marquee'      => array( 'checkbox', __( 'Show the red marquee above the masthead', 'filmybuff' ), true ),
		'fb_marquee_text'      => array( 'textarea', __( 'Marquee items (one per line; empty = the newest stories)', 'filmybuff' ), '' ),
		'fb_instagram'         => array( 'text', __( 'Instagram handle (without @)', 'filmybuff' ), 'filmybuff' ),
		'fb_rail_cats'         => array( 'text', __( 'The reels: section slugs (comma separated)', 'filmybuff' ), 'bollywood,hollywood,south-cinema' ),
		'fb_boxoffice_cat'     => array( 'text', __( 'Box office board: section slug', 'filmybuff' ), 'box-office' ),
		'fb_ott_cat'           => array( 'text', __( 'Streaming tonight: section slug', 'filmybuff' ), 'ott-releases' ),
		'fb_trailers_cat'      => array( 'text', __( 'Trailers row: section slug', 'filmybuff' ), 'trailers' ),
		'fb_ledger_title'      => array( 'text', __( 'Box office note: headline', 'filmybuff' ), __( 'Opening day tells you the marketing. Day eight tells you the film.', 'filmybuff' ) ),
		'fb_ledger_body'       => array( 'textarea', __( 'Box office note: text', 'filmybuff' ), __( 'We report collections as the trade reports them, in crore, gross and net where both are known, and we say when they are estimates.', 'filmybuff' ) ),
		'fb_newsletter_action' => array( 'url', __( 'Newsletter form action URL (Mailchimp / Beehiiv / Substack embed endpoint)', 'filmybuff' ), '' ),
		'fb_newsletter_title'  => array( 'text', __( 'Newsletter headline', 'filmybuff' ), __( 'Friday releases. Sunday numbers.', 'filmybuff' ) ),
		'fb_newsletter_body'   => array( 'text', __( 'Newsletter subline', 'filmybuff' ), __( 'One email a week: what opened, what worked, what to watch.', 'filmybuff' ) ),
		'fb_footer_tagline'    => array( 'textarea', __( 'Footer tagline', 'filmybuff' ), __( 'For people who love the movies. Bollywood, Hollywood and South cinema: releases, trailers, box office and what to watch tonight.', 'filmybuff' ) ),
	);
	foreach ( $fields as $id => $f ) {
		$wp_customize->add_setting( $id, array( 'default' => $f[2], 'sanitize_callback' => $f[0] === 'checkbox' ? 'wp_validate_boolean' : ( $f[0] === 'url' ? 'esc_url_raw' : 'sanitize_textarea_field' ) ) );
		$wp_customize->add_control( $id, array( 'section' => 'fb_brand', 'label' => $f[1], 'type' => $f[0] ) );
	}
}
add_action( 'customize_register', 'fb_customize' );
