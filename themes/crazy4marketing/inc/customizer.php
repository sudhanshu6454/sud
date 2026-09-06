<?php
if ( ! defined( 'ABSPATH' ) ) exit;

function c4_customize( $wp_customize ) {
	$wp_customize->add_section( 'c4_brand', array( 'title' => __( 'Crazy4 Marketing', 'crazy4marketing' ), 'priority' => 30 ) );

	$fields = array(
		'c4_show_ticker'     => array( 'checkbox', __( 'Show breaking ticker', 'crazy4marketing' ), true ),
		'c4_ticker_text'     => array( 'textarea', __( 'Ticker items (one per line; leave empty to use the "breaking" category)', 'crazy4marketing' ), '' ),
		'c4_instagram'       => array( 'text', __( 'Instagram handle (without @)', 'crazy4marketing' ), 'crazy4marketing' ),
		'c4_show_instagram'  => array( 'checkbox', __( 'Show Instagram strip on homepage', 'crazy4marketing' ), true ),
		'c4_newsletter_action' => array( 'url', __( 'Newsletter form action URL (Mailchimp / Beehiiv / Substack embed endpoint)', 'crazy4marketing' ), '' ),
		'c4_newsletter_title' => array( 'text', __( 'Newsletter headline', 'crazy4marketing' ), __( 'The Marketing Edit, in your inbox before your 10 AM.', 'crazy4marketing' ) ),
		'c4_newsletter_body' => array( 'text', __( 'Newsletter subline', 'crazy4marketing' ), __( 'One email a day. Five stories. No synergy.', 'crazy4marketing' ) ),
		'c4_hot_take_cat'    => array( 'text', __( 'Hot Take category slug', 'crazy4marketing' ), 'hot-takes' ),
		'c4_rail_cats'       => array( 'text', __( 'Homepage rail category slugs (comma separated)', 'crazy4marketing' ), 'news,viral,brands,trends' ),
		'c4_footer_tagline'  => array( 'textarea', __( 'Footer tagline', 'crazy4marketing' ), __( 'An Instagram publication for marketing & brand culture. News, viral campaigns, and the sharpest takes — every day.', 'crazy4marketing' ) ),
	);
	foreach ( $fields as $id => $f ) {
		$wp_customize->add_setting( $id, array( 'default' => $f[2], 'sanitize_callback' => $f[0] === 'checkbox' ? 'wp_validate_boolean' : ( $f[0] === 'url' ? 'esc_url_raw' : 'sanitize_textarea_field' ) ) );
		$wp_customize->add_control( $id, array( 'section' => 'c4_brand', 'label' => $f[1], 'type' => $f[0] ) );
	}
	for ( $i = 1; $i <= 6; $i++ ) {
		$wp_customize->add_setting( "c4_ig_$i", array( 'default' => '', 'sanitize_callback' => 'esc_url_raw' ) );
		$wp_customize->add_control( new WP_Customize_Image_Control( $wp_customize, "c4_ig_$i", array( 'section' => 'c4_brand', 'label' => sprintf( __( 'Instagram tile %d', 'crazy4marketing' ), $i ) ) ) );
	}
}
add_action( 'customize_register', 'c4_customize' );

/** Instagram tiles: customizer uploads, falling back to bundled brand post templates */
function c4_instagram_tiles() {
	$defaults = array( 'ig_breaking.png', 'ig_hottake.png', 'ig_viral.png', 'ig_carousel.png', 'hl_brands.png', 'hl_trends.png' );
	$out = array();
	for ( $i = 1; $i <= 6; $i++ ) {
		$u = get_theme_mod( "c4_ig_$i", '' );
		$out[] = $u ? $u : get_template_directory_uri() . '/assets/' . $defaults[ $i - 1 ];
	}
	return $out;
}
