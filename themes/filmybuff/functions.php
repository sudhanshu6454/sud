<?php
/**
 * Filmybuff theme functions.
 */
if ( ! defined( 'ABSPATH' ) ) exit;

// the stylesheet's own Version header, so every release busts the browser and edge caches
define( 'FB_VERSION', wp_get_theme( 'filmybuff' )->get( 'Version' ) ?: '2.1.0' );

function fb_setup() {
	load_theme_textdomain( 'filmybuff', get_template_directory() . '/languages' );
	add_theme_support( 'title-tag' );
	add_theme_support( 'post-thumbnails' );
	add_theme_support( 'automatic-feed-links' );
	add_theme_support( 'html5', array( 'search-form', 'comment-form', 'comment-list', 'gallery', 'caption', 'style', 'script' ) );
	add_theme_support( 'responsive-embeds' );
	add_theme_support( 'custom-logo', array( 'height' => 88, 'width' => 160, 'flex-width' => true, 'flex-height' => true ) );
	add_theme_support( 'excerpt' );
	add_post_type_support( 'page', 'excerpt' );
	// every image on the site is the 3:4 poster autopub makes for the grid; two sizes of it, no other crop
	add_image_size( 'fb-poster', 600, 800, true );      // shelves, walls, prints, rows
	add_image_size( 'fb-poster-lg', 1200, 1600, true ); // the bill on the front page and the article
	register_nav_menus( array(
		'primary'         => __( 'Primary (header sections)', 'filmybuff' ),
		'footer-sections' => __( 'Footer: Sections', 'filmybuff' ),
		'footer-more'     => __( 'Footer: More', 'filmybuff' ),
		'footer-follow'   => __( 'Footer: Follow', 'filmybuff' ),
	) );
}
add_action( 'after_setup_theme', 'fb_setup' );

/** Every resized copy WordPress makes (thumbnails, the poster sizes) is saved at high quality; the default 82 softens the type on a poster. */
add_filter( 'jpeg_quality', function () { return 92; } );
add_filter( 'wp_editor_set_quality', function () { return 92; } );

function fb_scripts() {
	wp_enqueue_style( 'fb-fonts', 'https://fonts.googleapis.com/css2?family=Archivo:wght@400;500;700;800;900&display=swap', array(), null );
	wp_enqueue_style( 'fb-style', get_stylesheet_uri(), array( 'fb-fonts' ), FB_VERSION );
	wp_enqueue_script( 'fb-main', get_template_directory_uri() . '/js/main.js', array(), FB_VERSION, true );
	if ( is_singular() && comments_open() && get_option( 'thread_comments' ) ) wp_enqueue_script( 'comment-reply' );
}
add_action( 'wp_enqueue_scripts', 'fb_scripts' );

/** Excerpt: short, no [...] */
add_filter( 'excerpt_length', function () { return 26; } );
add_filter( 'excerpt_more', function () { return '…'; } );

/** Reading time */
function fb_reading_time( $post_id = null ) {
	$content = get_post_field( 'post_content', $post_id );
	$minutes = max( 1, (int) ceil( str_word_count( wp_strip_all_tags( $content ) ) / 220 ) );
	return sprintf( _n( '%d min read', '%d min read', $minutes, 'filmybuff' ), $minutes );
}

/** Primary category (first assigned) */
function fb_primary_cat( $post_id = null ) {
	$cats = get_the_category( $post_id );
	return $cats ? $cats[0] : null;
}

/** A category by slug, or by name when the slug differs (sections are created by name) */
function fb_cat( $slug ) {
	$cat = get_category_by_slug( $slug );
	if ( ! $cat ) $cat = get_term_by( 'name', ucwords( str_replace( '-', ' ', $slug ) ), 'category' );
	return $cat ?: null;
}

/** Track views for Trending */
function fb_track_views() {
	if ( ! is_singular( 'post' ) || is_user_logged_in() ) return;
	$id = get_the_ID();
	update_post_meta( $id, 'fb_views', (int) get_post_meta( $id, 'fb_views', true ) + 1 );
}
add_action( 'wp_head', 'fb_track_views' );

function fb_format_views( $n ) {
	$n = (int) $n;
	return $n >= 1000 ? round( $n / 1000, 1 ) . 'k' : (string) $n;
}

/** Open Graph: the featured image, else the brand's default card */
function fb_og() {
	if ( defined( 'WPSEO_VERSION' ) ) return;   // Yoast writes its own
	$img = is_singular() && has_post_thumbnail() ? get_the_post_thumbnail_url( null, 'fb-poster-lg' ) : get_template_directory_uri() . '/assets/img/og-default.jpg';
	echo '<meta property="og:image" content="' . esc_url( $img ) . '">' . "\n";
	echo '<meta name="twitter:card" content="summary_large_image">' . "\n";
}
add_action( 'wp_head', 'fb_og', 5 );

require get_template_directory() . '/inc/customizer.php';
require get_template_directory() . '/inc/template-tags.php';
