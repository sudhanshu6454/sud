<?php
/**
 * Marketing Mentalist theme bootstrap.
 *
 * @package marketing-mentalist
 */

defined( 'ABSPATH' ) || exit;

define( 'MM_VERSION', '1.0.0' );
define( 'MM_DIR', get_template_directory() );
define( 'MM_URI', get_template_directory_uri() );

require MM_DIR . '/inc/cpt.php';
require MM_DIR . '/inc/taxonomies.php';
require MM_DIR . '/inc/meta.php';
require MM_DIR . '/inc/home.php';
require MM_DIR . '/inc/template-tags.php';
require MM_DIR . '/inc/customizer.php';
require MM_DIR . '/inc/newsletter.php';
require MM_DIR . '/inc/roles.php';
require MM_DIR . '/inc/seo.php';
require MM_DIR . '/inc/submit.php';

function mm_setup(): void {
	load_theme_textdomain( 'marketing-mentalist', MM_DIR . '/languages' );
	add_theme_support( 'title-tag' );
	add_theme_support( 'post-thumbnails' );
	add_theme_support( 'automatic-feed-links' );
	add_theme_support( 'html5', array( 'search-form', 'gallery', 'caption', 'style', 'script', 'navigation-widgets' ) );
	add_theme_support( 'responsive-embeds' );

	set_post_thumbnail_size( 1600, 900, true );
	add_image_size( 'mm-card', 800, 450, true );
	add_image_size( 'mm-cover', 800, 1000, true );
	add_image_size( 'mm-mobile-hero', 1080, 1350, true );

	register_nav_menus( array(
		'primary'         => 'Primary (header)',
		'mobile'          => 'Mobile menu',
		'footer-explore'  => 'Footer: Explore',
		'footer-company'  => 'Footer: Company',
		'footer-legal'    => 'Footer: Legal',
	) );
}
add_action( 'after_setup_theme', 'mm_setup' );

function mm_assets(): void {
	wp_enqueue_style( 'marketing-mentalist', get_stylesheet_uri(), array(), MM_VERSION );
	wp_enqueue_script( 'mm-carousel', MM_URI . '/assets/js/carousel.js', array(), MM_VERSION, array( 'strategy' => 'defer' ) );
	wp_enqueue_script( 'mm', MM_URI . '/assets/js/mm.js', array(), MM_VERSION, array( 'strategy' => 'defer' ) );
}
add_action( 'wp_enqueue_scripts', 'mm_assets' );

function mm_preloads(): void {
	foreach ( array( 'instrument-700-normal', 'literata-400-normal' ) as $font ) {
		printf( '<link rel="preload" href="%s" as="font" type="font/woff2" crossorigin>' . "\n", esc_url( MM_URI . "/assets/fonts/$font.woff2" ) );
	}
	if ( is_singular() && has_post_thumbnail() ) {
		$src = wp_get_attachment_image_url( get_post_thumbnail_id(), 'post-thumbnail' );
		if ( $src ) {
			printf( '<link rel="preload" as="image" href="%s">' . "\n", esc_url( $src ) );
		}
	}
}
add_action( 'wp_head', 'mm_preloads', 1 );

function mm_posts_per_page( WP_Query $query ): void {
	if ( is_admin() || ! $query->is_main_query() ) {
		return;
	}
	if ( $query->is_post_type_archive( 'mm_campaign' ) || $query->is_archive() || $query->is_search() ) {
		$query->set( 'posts_per_page', 12 );
	}
}
add_action( 'pre_get_posts', 'mm_posts_per_page' );

add_filter( 'excerpt_length', fn() => 28, 999 );
add_filter( 'excerpt_more', fn() => '…' );

function mm_body_class( array $classes ): array {
	if ( is_singular() && mm_is_sponsored( get_queried_object() ) ) {
		$classes[] = 'mm-is-sponsored';
	}
	return $classes;
}
add_filter( 'body_class', 'mm_body_class' );

add_filter( 'comments_open', '__return_false', 20 );
add_filter( 'pings_open', '__return_false', 20 );

remove_action( 'wp_head', 'wp_generator' );
remove_action( 'wp_head', 'print_emoji_detection_script', 7 );
remove_action( 'wp_print_styles', 'print_emoji_styles' );
add_filter( 'wp_lazy_loading_enabled', '__return_true' );

/** No jQuery on the front end (performance budget, HANDOVER.md §10). */
function mm_deregister_jquery(): void {
	if ( ! is_admin() ) {
		wp_deregister_script( 'jquery' );
	}
}
add_action( 'wp_enqueue_scripts', 'mm_deregister_jquery', 1 );

/** AI crawlers: default allow (HANDOVER.md §9 - owner's call, this theme's default is allow). */
function mm_robots_txt( string $output ): string {
	$output .= "\nUser-agent: GPTBot\nAllow: /\n";
	$output .= "\nUser-agent: ClaudeBot\nAllow: /\n";
	$output .= "\nUser-agent: PerplexityBot\nAllow: /\n";
	$output .= "\nUser-agent: Google-Extended\nAllow: /\n";
	$output .= "\nSitemap: " . home_url( '/wp-sitemap.xml' ) . "\n";
	$output .= "# llms.txt: " . home_url( '/llms.txt' ) . "\n";
	return $output;
}
add_filter( 'robots_txt', 'mm_robots_txt' );
