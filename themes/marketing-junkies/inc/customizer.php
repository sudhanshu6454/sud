<?php
/**
 * Customizer: newsletter, social profiles, ad slots.
 *
 * @package marketing-junkies
 */

defined( 'ABSPATH' ) || exit;

function mj_customize_register( WP_Customize_Manager $wp_customize ): void {
	$wp_customize->add_panel( 'mj', array( 'title' => __( 'Marketing Junkies', 'marketing-junkies' ), 'priority' => 30 ) );

	// -- Newsroom -----------------------------------------------------------
	$wp_customize->add_section( 'mj_newsroom', array( 'title' => __( 'Newsroom', 'marketing-junkies' ), 'panel' => 'mj' ) );
	$text = array(
		'mj_strip_text'      => array( __( 'Top strip label', 'marketing-junkies' ), 'marketing · daily' ),
		'mj_author_blurb'    => array( __( 'Default author blurb', 'marketing-junkies' ), __( 'Marketing Junkies covers agency moves, campaigns, martech and adtech launches with an Indian and global lens. Every story is written from a named source and links back to it.', 'marketing-junkies' ) ),
		'mj_footer_blurb'    => array( __( 'Footer blurb', 'marketing-junkies' ), __( 'Your daily fix of marketing, media and martech news. marketingjunkies.in', 'marketing-junkies' ) ),
		'mj_advertise_url'   => array( __( '"Advertise with us" URL', 'marketing-junkies' ), '' ),
	);
	foreach ( $text as $id => [ $label, $default ] ) {
		$wp_customize->add_setting( $id, array( 'default' => $default, 'sanitize_callback' => 'sanitize_text_field' ) );
		$wp_customize->add_control( $id, array( 'label' => $label, 'section' => 'mj_newsroom', 'type' => 'text' ) );
	}

	// -- Newsletter ---------------------------------------------------------
	$wp_customize->add_section( 'mj_newsletter', array( 'title' => __( 'Newsletter', 'marketing-junkies' ), 'panel' => 'mj', 'description' => __( 'Leave the form action empty to collect subscribers inside WordPress (Subscribers menu). Set it to your email provider\'s form URL to post there instead.', 'marketing-junkies' ) ) );
	$fields = array(
		'mj_newsletter_heading' => array( __( 'Heading', 'marketing-junkies' ), __( 'Your daily fix, 7 am IST.', 'marketing-junkies' ), 'sanitize_text_field' ),
		'mj_newsletter_text'    => array( __( 'Text', 'marketing-junkies' ), __( 'One email a day. Marketing, media and martech news in five minutes.', 'marketing-junkies' ), 'sanitize_text_field' ),
		'mj_newsletter_action'  => array( __( 'Form action URL (optional)', 'marketing-junkies' ), '', 'esc_url_raw' ),
		'mj_newsletter_field'   => array( __( 'Email field name for that provider', 'marketing-junkies' ), 'EMAIL', 'sanitize_text_field' ),
	);
	foreach ( $fields as $id => [ $label, $default, $sanitize ] ) {
		$wp_customize->add_setting( $id, array( 'default' => $default, 'sanitize_callback' => $sanitize ) );
		$wp_customize->add_control( $id, array( 'label' => $label, 'section' => 'mj_newsletter', 'type' => 'text' ) );
	}

	// -- Social -------------------------------------------------------------
	$wp_customize->add_section( 'mj_social', array( 'title' => __( 'Social profiles', 'marketing-junkies' ), 'panel' => 'mj' ) );
	foreach ( array( 'linkedin' => 'LinkedIn', 'x' => 'X', 'instagram' => 'Instagram', 'telegram' => 'Telegram', 'facebook' => 'Facebook', 'threads' => 'Threads' ) as $key => $label ) {
		$wp_customize->add_setting( 'mj_social_' . $key, array( 'default' => '', 'sanitize_callback' => 'esc_url_raw' ) );
		$wp_customize->add_control( 'mj_social_' . $key, array( 'label' => $label, 'section' => 'mj_social', 'type' => 'url' ) );
	}

	// -- Advertising --------------------------------------------------------
	$wp_customize->add_section( 'mj_ads', array( 'title' => __( 'Advertising', 'marketing-junkies' ), 'panel' => 'mj', 'description' => __( 'Paste the ad tag for each unit. Empty units render nothing (heights are reserved only when a tag is present).', 'marketing-junkies' ) ) );
	$wp_customize->add_setting( 'mj_show_ad_placeholders', array( 'default' => false, 'sanitize_callback' => 'rest_sanitize_boolean' ) );
	$wp_customize->add_control( 'mj_show_ad_placeholders', array( 'label' => __( 'Show dashed placeholders for empty units', 'marketing-junkies' ), 'section' => 'mj_ads', 'type' => 'checkbox' ) );
	$slots = array(
		'leaderboard'        => '970×90 leaderboard (below header, desktop)',
		'mobile_banner'      => '320×50 banner (below header, mobile)',
		'inarticle_1'        => '336×280 in-article (after the 2nd section)',
		'sidebar_top'        => '300×250 sidebar',
		'sidebar_sticky'     => '300×600 sidebar, sticky',
		'newsletter_sponsor' => 'Newsletter "Presented by" strip (text + 88×24 logo)',
	);
	foreach ( $slots as $slot => $label ) {
		$wp_customize->add_setting( 'mj_ad_' . $slot, array( 'default' => '', 'sanitize_callback' => 'mj_sanitize_ad_html' ) );
		$wp_customize->add_control( 'mj_ad_' . $slot, array( 'label' => $label, 'section' => 'mj_ads', 'type' => 'textarea' ) );
	}
}
add_action( 'customize_register', 'mj_customize_register' );

/**
 * Ad tags are trusted administrator input (they need <script>); only users with unfiltered_html may store them.
 */
function mj_sanitize_ad_html( string $value ): string {
	return current_user_can( 'unfiltered_html' ) ? $value : wp_kses_post( $value );
}
