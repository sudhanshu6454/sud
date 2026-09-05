<?php
/**
 * Customizer: social profiles, newsletter, media kit numbers (placeholders per HANDOVER.md §11
 * "open decision for the owner"), and the sponsor ad slot - same empty-renders-nothing pattern
 * as marketing-junkies' mj_ad_slot.
 *
 * @package marketing-mentalist
 */

defined( 'ABSPATH' ) || exit;

function mm_customize_register( WP_Customize_Manager $wp_customize ): void {
	$wp_customize->add_panel( 'mm', array( 'title' => 'Marketing Mentalist', 'priority' => 30 ) );

	$wp_customize->add_section( 'mm_social', array( 'title' => 'Social profiles', 'panel' => 'mm' ) );
	foreach ( array( 'instagram' => 'Instagram', 'linkedin' => 'LinkedIn', 'youtube' => 'YouTube', 'x' => 'X', 'facebook' => 'Facebook' ) as $key => $label ) {
		$wp_customize->add_setting( 'mm_social_' . $key, array( 'default' => '', 'sanitize_callback' => 'esc_url_raw' ) );
		$wp_customize->add_control( 'mm_social_' . $key, array( 'label' => $label, 'section' => 'mm_social', 'type' => 'url' ) );
	}

	$wp_customize->add_section( 'mm_newsletter', array( 'title' => 'Newsletter', 'panel' => 'mm', 'description' => 'Leave the form action empty to collect subscribers inside WordPress (Subscribers menu). Set it to your provider\'s form URL to post there instead.' ) );
	foreach ( array(
		'mm_newsletter_name'    => array( 'Name', 'The Brand Briefing', 'sanitize_text_field' ),
		'mm_newsletter_cadence' => array( 'Cadence line', 'every Wednesday', 'sanitize_text_field' ),
		'mm_newsletter_action'  => array( 'Form action URL (optional)', '', 'esc_url_raw' ),
		'mm_newsletter_field'   => array( 'Email field name for that provider', 'EMAIL', 'sanitize_text_field' ),
	) as $id => list( $label, $default, $sanitize ) ) {
		$wp_customize->add_setting( $id, array( 'default' => $default, 'sanitize_callback' => $sanitize ) );
		$wp_customize->add_control( $id, array( 'label' => $label, 'section' => 'mm_newsletter', 'type' => 'text' ) );
	}

	$wp_customize->add_section( 'mm_media_kit', array( 'title' => 'Media kit numbers', 'panel' => 'mm', 'description' => 'Shown on /advertise/. Leave as em-dash until the real media kit is ready.' ) );
	foreach ( array(
		'mm_stat_readers'      => 'Monthly readers',
		'mm_stat_social'       => 'Social followers',
		'mm_stat_subscribers'  => 'Newsletter subscribers',
		'mm_stat_campaigns'    => 'Campaigns decoded',
	) as $id => $label ) {
		$wp_customize->add_setting( $id, array( 'default' => '—', 'sanitize_callback' => 'sanitize_text_field' ) );
		$wp_customize->add_control( $id, array( 'label' => $label, 'section' => 'mm_media_kit', 'type' => 'text' ) );
	}

	$wp_customize->add_section( 'mm_ads', array( 'title' => 'Sponsor slot', 'panel' => 'mm', 'description' => 'Ad tag for the 300x250 sponsor slot on breakdown pages. Empty renders nothing.' ) );
	$wp_customize->add_setting( 'mm_ad_sidebar', array( 'default' => '', 'sanitize_callback' => fn( $v ) => current_user_can( 'unfiltered_html' ) ? $v : wp_kses_post( $v ) ) );
	$wp_customize->add_control( 'mm_ad_sidebar', array( 'label' => 'Sidebar sponsor tag (300x250)', 'section' => 'mm_ads', 'type' => 'textarea' ) );
}
add_action( 'customize_register', 'mm_customize_register' );

function mm_social_links(): array {
	$out = array();
	foreach ( array( 'instagram' => 'Instagram', 'linkedin' => 'LinkedIn', 'youtube' => 'YouTube', 'x' => 'X', 'facebook' => 'Facebook' ) as $key => $label ) {
		$url = get_theme_mod( 'mm_social_' . $key, '' );
		if ( $url ) {
			$out[ $label ] = $url;
		}
	}
	return $out;
}

function mm_ad_slot( string $slot, int $width, int $height ): void {
	$html = trim( (string) get_theme_mod( 'mm_ad_' . $slot, '' ) );
	if ( '' === $html ) {
		return;
	}
	printf( '<div style="width:%1$dpx;max-width:100%%;height:%2$dpx" data-ad-slot="mm_%3$s">%4$s</div>', $width, $height, esc_attr( $slot ), $html ); // phpcs:ignore WordPress.Security.EscapeOutput -- administrator-provided ad tag.
}
