<?php
/**
 * Crazy4 Marketing theme functions.
 */
if ( ! defined( 'ABSPATH' ) ) exit;

define( 'C4_VERSION', '1.0.0' );

function c4_setup() {
	load_theme_textdomain( 'crazy4marketing', get_template_directory() . '/languages' );
	add_theme_support( 'title-tag' );
	add_theme_support( 'post-thumbnails' );
	add_theme_support( 'automatic-feed-links' );
	add_theme_support( 'html5', array( 'search-form', 'comment-form', 'comment-list', 'gallery', 'caption', 'style', 'script' ) );
	add_theme_support( 'responsive-embeds' );
	add_theme_support( 'custom-logo', array( 'height' => 80, 'width' => 80, 'flex-width' => true ) );
	add_theme_support( 'excerpt' );
	add_post_type_support( 'page', 'excerpt' );
	add_image_size( 'c4-lead', 1200, 900, true );
	add_image_size( 'c4-card', 720, 480, true );
	add_image_size( 'c4-square', 600, 600, true );
	add_image_size( 'c4-wide', 1600, 800, true );
	register_nav_menus( array(
		'primary' => __( 'Primary (header sections)', 'crazy4marketing' ),
		'footer-sections' => __( 'Footer: Sections', 'crazy4marketing' ),
		'footer-more' => __( 'Footer: More', 'crazy4marketing' ),
		'footer-follow' => __( 'Footer: Follow', 'crazy4marketing' ),
	) );
}
add_action( 'after_setup_theme', 'c4_setup' );

function c4_scripts() {
	wp_enqueue_style( 'c4-fonts', 'https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@300;400;500;700&display=swap', array(), null );
	wp_enqueue_style( 'c4-style', get_stylesheet_uri(), array( 'c4-fonts' ), C4_VERSION );
	wp_enqueue_script( 'c4-main', get_template_directory_uri() . '/js/main.js', array(), C4_VERSION, true );
	if ( is_singular() && comments_open() && get_option( 'thread_comments' ) ) wp_enqueue_script( 'comment-reply' );
}
add_action( 'wp_enqueue_scripts', 'c4_scripts' );

function c4_widgets() {
	register_sidebar( array(
		'name' => __( 'Sidebar', 'crazy4marketing' ), 'id' => 'sidebar-1',
		'description' => __( 'Shown beside Latest on the homepage and on archives (Trending + Newsletter are built in).', 'crazy4marketing' ),
		'before_widget' => '<div id="%1$s" class="widget %2$s">', 'after_widget' => '</div>',
		'before_title' => '<h3 class="widget-title">', 'after_title' => '</h3>',
	) );
}
add_action( 'widgets_init', 'c4_widgets' );

/** Excerpt: short, no [...] */
add_filter( 'excerpt_length', function () { return 24; } );
add_filter( 'excerpt_more', function () { return '…'; } );

/** Reading time */
function c4_reading_time( $post_id = null ) {
	$content = get_post_field( 'post_content', $post_id );
	$minutes = max( 1, (int) ceil( str_word_count( wp_strip_all_tags( $content ) ) / 220 ) );
	return sprintf( _n( '%d min read', '%d min read', $minutes, 'crazy4marketing' ), $minutes );
}

/** Primary category (first assigned) */
function c4_primary_cat( $post_id = null ) {
	$cats = get_the_category( $post_id );
	return $cats ? $cats[0] : null;
}

/** Category by slug helper — falls back gracefully */
function c4_cat_link_by_slug( $slug ) {
	$cat = get_category_by_slug( $slug );
	return $cat ? get_category_link( $cat ) : home_url( '/' );
}

/** Track views for Trending */
function c4_track_views() {
	if ( ! is_singular( 'post' ) || is_user_logged_in() ) return;
	$id = get_the_ID();
	update_post_meta( $id, 'c4_views', (int) get_post_meta( $id, 'c4_views', true ) + 1 );
}
add_action( 'wp_head', 'c4_track_views' );

function c4_format_views( $n ) {
	$n = (int) $n;
	return $n >= 1000 ? round( $n / 1000, 1 ) . 'k' : (string) $n;
}

/** Ticker items: Customizer text (one per line) or latest posts in the "breaking" category */
function c4_ticker_items() {
	$raw = trim( (string) get_theme_mod( 'c4_ticker_text', '' ) );
	if ( $raw !== '' ) return array_filter( array_map( 'trim', explode( "\n", $raw ) ) );
	$q = new WP_Query( array( 'category_name' => 'breaking', 'posts_per_page' => 5, 'no_found_rows' => true ) );
	$items = wp_list_pluck( $q->posts, 'post_title' );
	if ( empty( $items ) ) {
		$q = new WP_Query( array( 'posts_per_page' => 5, 'no_found_rows' => true ) );
		$items = wp_list_pluck( $q->posts, 'post_title' );
	}
	return $items;
}

/** Body class: cream ground toggle */
add_filter( 'body_class', function ( $c ) { if ( get_theme_mod( 'c4_ground', 'dark' ) === 'cream' ) $c[] = 'ground-cream'; return $c; } );

require get_template_directory() . '/inc/customizer.php';
require get_template_directory() . '/inc/template-tags.php';
