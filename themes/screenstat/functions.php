<?php
/**
 * Screenstat theme functions.
 *
 * @package Screenstat
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

define( 'SCREENSTAT_VERSION', '1.0.0' );

/**
 * Theme setup.
 */
function screenstat_setup() {
	add_theme_support( 'title-tag' );
	add_theme_support( 'post-thumbnails' );
	add_theme_support( 'html5', array( 'style', 'script', 'caption', 'gallery' ) );
	add_theme_support( 'editor-styles' );
	add_editor_style( 'style.css' );

	add_theme_support(
		'custom-logo',
		array(
			'height'      => 68,
			'width'       => 360,
			'flex-height' => true,
			'flex-width'  => true,
		)
	);

	/*
	 * Block themes have no menu locations of their own, but the Navigation block's fallback builds
	 * its menu from the classic menu assigned to "primary". infra/wp/init-sites.sh maintains that
	 * classic menu (one item per section) on every site in the fleet, so registering the location
	 * is what makes the header show the real sections instead of a page list.
	 */
	register_nav_menus(
		array(
			'primary'         => __( 'Primary (header)', 'screenstat' ),
			'footer-sections' => __( 'Footer: Sections', 'screenstat' ),
		)
	);
}
add_action( 'after_setup_theme', 'screenstat_setup' );

/**
 * Cover images from the fleet's publisher are 1200x630 and carry a logo plate; keep the sizes
 * WordPress generates in that ratio so nothing is cropped away in the grids.
 */
function screenstat_image_sizes() {
	set_post_thumbnail_size( 1200, 630, true );
	add_image_size( 'screenstat-card', 600, 315, true );
}
add_action( 'after_setup_theme', 'screenstat_image_sizes' );

/**
 * Front-end styles.
 */
function screenstat_styles() {
	wp_enqueue_style(
		'screenstat-style',
		get_stylesheet_uri(),
		array(),
		SCREENSTAT_VERSION
	);
}
add_action( 'wp_enqueue_scripts', 'screenstat_styles' );

/**
 * Custom block styles, selectable in the editor sidebar.
 */
function screenstat_block_styles() {

	register_block_style(
		'core/group',
		array(
			'name'  => 'screenstat-figure',
			'label' => __( 'Figure', 'screenstat' ),
		)
	);

	register_block_style(
		'core/group',
		array(
			'name'  => 'screenstat-card',
			'label' => __( 'Stat card', 'screenstat' ),
		)
	);

	register_block_style(
		'core/paragraph',
		array(
			'name'  => 'screenstat-source',
			'label' => __( 'Source line', 'screenstat' ),
		)
	);
}
add_action( 'init', 'screenstat_block_styles' );

/**
 * Pattern category so the bundled patterns group together in the inserter.
 */
function screenstat_pattern_category() {
	if ( function_exists( 'register_block_pattern_category' ) ) {
		register_block_pattern_category(
			'screenstat',
			array(
				'label'       => __( 'Screenstat', 'screenstat' ),
				'description' => __( 'Data-first layouts for collections, rankings and buzz.', 'screenstat' ),
			)
		);
	}
}
add_action( 'init', 'screenstat_pattern_category' );

/**
 * Reading time, useful in post meta on longer analysis pieces.
 * Use with a shortcode block: [screenstat_read_time]
 */
function screenstat_read_time() {
	$content = get_post_field( 'post_content', get_the_ID() );
	$words   = str_word_count( wp_strip_all_tags( $content ) );
	$minutes = max( 1, (int) ceil( $words / 220 ) );

	return sprintf(
		/* translators: %d: number of minutes */
		esc_html( _n( '%d min read', '%d min read', $minutes, 'screenstat' ) ),
		$minutes
	);
}
add_shortcode( 'screenstat_read_time', 'screenstat_read_time' );
