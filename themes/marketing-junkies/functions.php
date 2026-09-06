<?php
/**
 * Marketing Junkies theme bootstrap.
 *
 * @package marketing-junkies
 */

defined( 'ABSPATH' ) || exit;

define( 'MJ_VERSION', '1.0.0' );
define( 'MJ_DIR', get_template_directory() );
define( 'MJ_URI', get_template_directory_uri() );

require MJ_DIR . '/inc/template-tags.php';
require MJ_DIR . '/inc/content.php';
require MJ_DIR . '/inc/customizer.php';
require MJ_DIR . '/inc/newsletter.php';
require MJ_DIR . '/inc/seo.php';

/**
 * Theme supports, menus, image sizes.
 */
function mj_setup(): void {
	load_theme_textdomain( 'marketing-junkies', MJ_DIR . '/languages' );
	add_theme_support( 'title-tag' );
	add_theme_support( 'post-thumbnails' );
	add_theme_support( 'automatic-feed-links' );
	add_theme_support( 'html5', array( 'search-form', 'gallery', 'caption', 'style', 'script', 'navigation-widgets' ) );
	add_theme_support( 'responsive-embeds' );
	add_theme_support( 'post-formats', array( 'standard' ) );
	add_theme_support( 'custom-logo', array( 'height' => 32, 'width' => 32, 'flex-width' => true ) );

	// The autopub share image is 1200x630; cards use a half-size crop of it.
	set_post_thumbnail_size( 1200, 630, true );
	add_image_size( 'mj-card', 600, 315, true );

	register_nav_menus(
		array(
			'primary'         => __( 'Primary (header)', 'marketing-junkies' ),
			'footer-sections' => __( 'Footer: Sections', 'marketing-junkies' ),
			'footer-company'  => __( 'Footer: Company', 'marketing-junkies' ),
		)
	);
}
add_action( 'after_setup_theme', 'mj_setup' );

/**
 * Styles and scripts. The stylesheet is the design system; one small script adds share/copy/TOC highlighting.
 */
function mj_assets(): void {
	wp_enqueue_style( 'marketing-junkies', get_stylesheet_uri(), array(), MJ_VERSION );
	wp_enqueue_script( 'marketing-junkies', MJ_URI . '/assets/js/mj.js', array(), MJ_VERSION, array( 'strategy' => 'defer' ) );
	wp_localize_script(
		'marketing-junkies',
		'mjI18n',
		array(
			'copied'  => __( 'Link copied', 'marketing-junkies' ),
			'copy'    => __( 'Copy link', 'marketing-junkies' ),
		)
	);
}
add_action( 'wp_enqueue_scripts', 'mj_assets' );

/**
 * Preload the font and, on articles, the featured image (largest-contentful-paint element).
 */
function mj_preloads(): void {
	printf( '<link rel="preload" href="%s" as="font" type="font/woff2" crossorigin>' . "\n", esc_url( MJ_URI . '/assets/fonts/archivo-latin.woff2' ) );
	if ( is_singular( 'post' ) && has_post_thumbnail() ) {
		$src = wp_get_attachment_image_url( get_post_thumbnail_id(), 'post-thumbnail' );
		if ( $src ) {
			printf( '<link rel="preload" as="image" href="%s">' . "\n", esc_url( $src ) );
		}
	}
}
add_action( 'wp_head', 'mj_preloads', 1 );

/**
 * Home shows a lead story plus two rows of six cards; archives show a 3-column grid.
 */
function mj_posts_per_page( WP_Query $query ): void {
	if ( is_admin() || ! $query->is_main_query() ) {
		return;
	}
	if ( $query->is_home() ) {
		$query->set( 'posts_per_page', 13 );
	} elseif ( $query->is_archive() || $query->is_search() ) {
		$query->set( 'posts_per_page', 12 );
	}
}
add_action( 'pre_get_posts', 'mj_posts_per_page' );

add_filter( 'excerpt_length', fn() => 28, 999 );
add_filter( 'excerpt_more', fn() => '…' );

/**
 * Body classes the CSS keys off.
 */
function mj_body_class( array $classes ): array {
	if ( is_singular( 'post' ) && mj_is_sponsored() ) {
		$classes[] = 'mj-is-sponsored';
	}
	return $classes;
}
add_filter( 'body_class', 'mj_body_class' );

/**
 * Comments are closed site-wide by the setup script; make sure the theme never renders the form.
 */
add_filter( 'comments_open', '__return_false', 20 );
add_filter( 'pings_open', '__return_false', 20 );

// Keep WordPress from emitting things the design does not use.
remove_action( 'wp_head', 'wp_generator' );
remove_action( 'wp_head', 'print_emoji_detection_script', 7 );
remove_action( 'wp_print_styles', 'print_emoji_styles' );
add_filter( 'wp_lazy_loading_enabled', '__return_true' );
