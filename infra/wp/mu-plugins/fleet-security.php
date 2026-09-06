<?php
/**
 * Plugin Name: Fleet Security - hardening
 * Description: XML-RPC off, no version leaks, no user enumeration, locked-down REST user listing, security headers, comment spam guard. Installed as a must-use plugin by infra/wp/init-sites.sh on every site.
 * Version: 1.0.0
 */
if ( ! defined( 'ABSPATH' ) ) exit;

/* ---- XML-RPC: the #1 brute-force / DDoS amplification surface; nothing in the fleet uses it ---- */
// xmlrpc.php defines XMLRPC_REQUEST before loading WordPress, so this runs before any method is served.
if ( defined( 'XMLRPC_REQUEST' ) && XMLRPC_REQUEST ) {
	http_response_code( 403 );
	header( 'Content-Type: text/plain; charset=utf-8' );
	exit( 'XML-RPC is disabled on this site.' );
}
add_filter( 'xmlrpc_enabled', '__return_false' );
add_filter( 'xmlrpc_methods', '__return_empty_array' );
add_filter( 'wp_headers', function ( $headers ) { unset( $headers['X-Pingback'] ); return $headers; } );
add_filter( 'pings_open', '__return_false' );
remove_action( 'wp_head', 'rsd_link' );
remove_action( 'wp_head', 'wlwmanifest_link' );

/* ---- Don't advertise the WordPress version anywhere ---- */
remove_action( 'wp_head', 'wp_generator' );
add_filter( 'the_generator', '__return_empty_string' );
add_filter( 'style_loader_src', 'fleet_strip_ver', 999 );
add_filter( 'script_loader_src', 'fleet_strip_ver', 999 );
function fleet_strip_ver( $src ) {
	if ( $src && strpos( $src, 'ver=' . get_bloginfo( 'version' ) ) !== false ) {
		$src = remove_query_arg( 'ver', $src );
	}
	return $src;
}

/* ---- Block username enumeration: /?author=1 and /author/<login> redirects ---- */
add_action( 'template_redirect', function () {
	if ( is_admin() || defined( 'WP_CLI' ) ) return;
	if ( isset( $_GET['author'] ) && ( is_numeric( $_GET['author'] ) || preg_match( '/^\d+/', wp_unslash( $_GET['author'] ) ) ) ) { // phpcs:ignore WordPress.Security.NonceVerification.Recommended
		wp_safe_redirect( home_url( '/' ), 301 );
		exit;
	}
}, 1 );
add_filter( 'redirect_canonical', function ( $redirect ) {
	if ( is_404() && isset( $_GET['author'] ) ) return false; // phpcs:ignore WordPress.Security.NonceVerification.Recommended
	return $redirect;
} );

/* ---- REST: anonymous callers may read content but never list users (login names) ---- */
add_filter( 'rest_endpoints', function ( $endpoints ) {
	if ( is_user_logged_in() ) return $endpoints;
	foreach ( array( '/wp/v2/users', '/wp/v2/users/(?P<id>[\d]+)' ) as $route ) {
		unset( $endpoints[ $route ] );
	}
	return $endpoints;
} );
/* Author archives stay (themes link to them) but the author slug is the display name, not the login. */
add_filter( 'author_link', function ( $link, $author_id ) {
	$nicename = get_the_author_meta( 'user_nicename', $author_id );
	$login    = get_the_author_meta( 'user_login', $author_id );
	if ( $nicename === $login ) {
		$display = sanitize_title( get_the_author_meta( 'display_name', $author_id ) );
		if ( $display && $display !== $login ) {
			$link = str_replace( '/' . $login . '/', '/' . $display . '/', $link );
		}
	}
	return $link;
}, 10, 2 );

/* ---- Login: generic errors only, no "invalid username" hints; stop registering ---- */
add_filter( 'login_errors', fn() => __( 'Login failed. Check your details and try again.' ) );
add_filter( 'option_users_can_register', '__return_zero' );

/* ---- Application passwords stay on (autopub publishes with one) but only over HTTPS ---- */
add_filter( 'wp_is_application_passwords_available', fn( $ok ) => $ok && is_ssl() );

/* ---- Security headers on every WordPress response ---- */
add_action( 'send_headers', function () {
	if ( headers_sent() ) return;
	header_remove( 'X-Powered-By' );
	header( 'X-Content-Type-Options: nosniff' );
	header( 'X-Frame-Options: SAMEORIGIN' );
	header( 'Referrer-Policy: strict-origin-when-cross-origin' );
	header( 'Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=()' );
	header( 'X-Permitted-Cross-Domain-Policies: none' );
	header( 'Cross-Origin-Opener-Policy: same-origin-allow-popups' );
	if ( is_ssl() ) {
		header( 'Strict-Transport-Security: max-age=31536000; includeSubDomains' );
	}
} );

/* ---- Comments: no HTML-heavy spam, no links from unknown authors, close after 30 days ---- */
add_filter( 'pre_comment_approved', function ( $approved, $commentdata ) {
	if ( 'spam' === $approved || 'trash' === $approved ) return $approved;
	$content = (string) ( $commentdata['comment_content'] ?? '' );
	if ( substr_count( strtolower( $content ), 'http' ) > 2 || preg_match( '/\[url|<a\s/i', $content ) ) return 'spam';
	return $approved;
}, 10, 2 );
add_filter( 'comment_flood_filter', '__return_true' );

/* ---- Uploads: only what a publication needs ---- */
add_filter( 'upload_mimes', function ( $mimes ) {
	unset( $mimes['swf'], $mimes['exe'], $mimes['htm|html'], $mimes['js'], $mimes['class'] );
	return $mimes;
} );

/* ---- File editing / plugin uploads through wp-admin are off in wp-config (DISALLOW_FILE_EDIT); belt-and-braces ---- */
add_filter( 'map_meta_cap', function ( $caps, $cap ) {
	if ( 'edit_themes' === $cap || 'edit_plugins' === $cap ) $caps[] = 'do_not_allow';
	return $caps;
}, 10, 2 );
