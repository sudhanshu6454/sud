<?php
/**
 * Filmybuff theme functions.
 */
if ( ! defined( 'ABSPATH' ) ) exit;

define( 'FB_VERSION', '1.0.0' );

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
	add_image_size( 'fb-lead', 1200, 800, true );
	add_image_size( 'fb-card', 720, 480, true );
	add_image_size( 'fb-square', 600, 600, true );
	add_image_size( 'fb-wide', 1600, 900, true );
	register_nav_menus( array(
		'primary'         => __( 'Primary (header sections)', 'filmybuff' ),
		'footer-sections' => __( 'Footer: Sections', 'filmybuff' ),
		'footer-more'     => __( 'Footer: More', 'filmybuff' ),
		'footer-follow'   => __( 'Footer: Follow', 'filmybuff' ),
	) );
}
add_action( 'after_setup_theme', 'fb_setup' );

function fb_scripts() {
	wp_enqueue_style( 'fb-fonts', 'https://fonts.googleapis.com/css2?family=Archivo:wght@400;500;700;800;900&display=swap', array(), null );
	wp_enqueue_style( 'fb-style', get_stylesheet_uri(), array( 'fb-fonts' ), FB_VERSION );
	wp_enqueue_script( 'fb-main', get_template_directory_uri() . '/js/main.js', array(), FB_VERSION, true );
	if ( is_singular() && comments_open() && get_option( 'thread_comments' ) ) wp_enqueue_script( 'comment-reply' );
}
add_action( 'wp_enqueue_scripts', 'fb_scripts' );

function fb_widgets() {
	register_sidebar( array(
		'name' => __( 'Sidebar', 'filmybuff' ), 'id' => 'sidebar-1',
		'description' => __( 'Beside Latest on the homepage and on archives (Trending, Follow and Newsletter are built in).', 'filmybuff' ),
		'before_widget' => '<div id="%1$s" class="widget %2$s">', 'after_widget' => '</div>',
		'before_title' => '<h3 class="widget-title">', 'after_title' => '</h3>',
	) );
}
add_action( 'widgets_init', 'fb_widgets' );

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
	$img = is_singular() && has_post_thumbnail() ? get_the_post_thumbnail_url( null, 'fb-wide' ) : get_template_directory_uri() . '/assets/img/og-default.jpg';
	echo '<meta property="og:image" content="' . esc_url( $img ) . '">' . "\n";
	echo '<meta name="twitter:card" content="summary_large_image">' . "\n";
}
add_action( 'wp_head', 'fb_og', 5 );

require get_template_directory() . '/inc/customizer.php';
require get_template_directory() . '/inc/template-tags.php';
