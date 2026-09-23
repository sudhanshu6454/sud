<?php
/**
 * Plugin Name: Fleet Link in Bio
 * Description: Serves /bio/ - the page the Instagram profile link points at: the brand, its social accounts and the newest stories as tappable cards. One plugin for every site in the fleet; the host picks the brand.
 * Version: 1.0.0
 * Author: Digital Sukoon
 * License: Proprietary
 */
if ( ! defined( 'ABSPATH' ) ) { exit; }

define( 'FLEET_BIO_VERSION', '1.0.0' );
define( 'FLEET_BIO_PATH', 'bio' );      // https://site/bio/
define( 'FLEET_BIO_POSTS', 10 );
define( 'FLEET_BIO_TTL', 5 * MINUTE_IN_SECONDS );

require_once __DIR__ . '/includes/brands.php';
require_once __DIR__ . '/includes/render.php';

/** Pretty URL when rewrite rules are flushed; the fallback below answers even when they are not. */
add_action( 'init', function () {
	add_rewrite_rule( '^' . FLEET_BIO_PATH . '/?$', 'index.php?fleet_bio=1', 'top' );
	add_rewrite_tag( '%fleet_bio%', '1' );
} );
register_activation_hook( __FILE__, function () {
	add_rewrite_rule( '^' . FLEET_BIO_PATH . '/?$', 'index.php?fleet_bio=1', 'top' );
	flush_rewrite_rules();
} );
register_deactivation_hook( __FILE__, 'flush_rewrite_rules' );

add_action( 'template_redirect', function () {
	$path = trim( (string) parse_url( $_SERVER['REQUEST_URI'] ?? '', PHP_URL_PATH ), '/' );
	if ( '1' !== (string) get_query_var( 'fleet_bio' ) && strtolower( $path ) !== FLEET_BIO_PATH ) {
		return;
	}
	status_header( 200 );
	nocache_headers();
	header( 'Content-Type: text/html; charset=utf-8' );
	header( 'Cache-Control: public, max-age=120' );
	echo fleet_bio_page();
	exit;
}, 1 );

/** A new or edited story should show up on the next tap, not five minutes later. */
add_action( 'save_post', function () { delete_transient( 'fleet_bio_html' ); } );

function fleet_bio_page(): string {
	$html = get_transient( 'fleet_bio_html' );
	if ( is_string( $html ) && '' !== $html ) {
		return $html;
	}
	$host  = (string) parse_url( home_url(), PHP_URL_HOST );
	$brand = fleet_bio_brand_for( $host );

	$logo_url = '';
	if ( has_custom_logo() ) {
		$src = wp_get_attachment_image_src( (int) get_theme_mod( 'custom_logo' ), 'full' );
		$logo_url = $src ? $src[0] : '';
	}
	if ( ! $logo_url && $brand['logo'] && file_exists( __DIR__ . '/assets/' . $brand['logo'] ) ) {
		$logo_url = plugins_url( 'assets/' . $brand['logo'], __FILE__ );
	}
	$site = array(
		'name'      => get_bloginfo( 'name' ) ?: $brand['name'],
		'tagline'   => get_bloginfo( 'description' ) ?: $brand['tagline'],
		'home'      => home_url( '/' ),
		'logo_url'  => $logo_url,
		'generated' => gmdate( 'c' ),
	);

	$posts = array();
	$q = new WP_Query( array(
		'post_type' => 'post', 'post_status' => 'publish', 'posts_per_page' => FLEET_BIO_POSTS,
		'orderby' => 'date', 'order' => 'DESC', 'no_found_rows' => true, 'ignore_sticky_posts' => true,
	) );
	foreach ( $q->posts as $p ) {
		$cats  = get_the_category( $p->ID );
		$image = get_the_post_thumbnail_url( $p->ID, 'medium_large' ) ?: '';
		$posts[] = array(
			'url'      => get_permalink( $p ),
			'title'    => html_entity_decode( get_the_title( $p ), ENT_QUOTES | ENT_HTML5, 'UTF-8' ),
			'category' => $cats ? $cats[0]->name : '',
			'image'    => $image,
			'when'     => human_time_diff( get_post_time( 'U', true, $p ), time() ) . ' ago',
		);
	}
	$html = fleet_bio_render( $brand, $site, $posts );
	set_transient( 'fleet_bio_html', $html, FLEET_BIO_TTL );
	return $html;
}
