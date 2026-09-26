<?php
/**
 * Shared lookups used by blocks, content filters and head output.
 *
 * @package marketing-junkies
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

const MJ_SPONSORED_TAG = 'sponsored';

/** A post is sponsored when it carries the `sponsored` tag or an editor picked the Sponsored article template. */
function mj_is_sponsored( $post = null ): bool {
	$post = get_post( $post );
	if ( ! $post ) {
		return false;
	}
	return has_tag( MJ_SPONSORED_TAG, $post ) || 'single-sponsored' === get_page_template_slug( $post );
}

function mj_sponsor_name( $post = null ): string {
	$post = get_post( $post );
	$name = $post ? trim( (string) get_post_meta( $post->ID, 'mj_sponsor_name', true ) ) : '';
	return '' !== $name ? $name : __( 'our partner', 'marketing-junkies' );
}

function mj_ads_enabled(): bool {
	return (bool) apply_filters( 'mj_ads_enabled', (bool) get_theme_mod( 'mj_ads_enabled', true ) );
}

/** autopub files every post under exactly one category (sites.yaml `category`), so the first one is the section. */
function mj_primary_category( $post = null ): ?WP_Term {
	$post = get_post( $post );
	$cats = $post ? get_the_category( $post->ID ) : array();
	return $cats ? $cats[0] : null;
}

function mj_word_count( $post = null ): int {
	$post = get_post( $post );
	if ( ! $post ) {
		return 0;
	}
	$text = trim( wp_strip_all_tags( strip_shortcodes( $post->post_content ) ) );
	return '' === $text ? 0 : count( preg_split( '/\s+/u', $text ) );
}

function mj_reading_minutes( $post = null ): int {
	return max( 1, (int) ceil( mj_word_count( $post ) / 200 ) );
}

/** "5 Sep 2026, 09:10 IST" in the site timezone. */
function mj_format_datetime( int $timestamp ): string {
	return wp_date( 'j M Y, H:i T', $timestamp );
}

function mj_social_links(): array {
	$links = array(
		'linkedin'  => array( 'LinkedIn', get_theme_mod( 'mj_social_linkedin', '' ) ),
		'x'         => array( 'X', get_theme_mod( 'mj_social_x', '' ) ),
		'instagram' => array( 'Instagram', get_theme_mod( 'mj_social_instagram', '' ) ),
		'telegram'  => array( 'Telegram', get_theme_mod( 'mj_social_telegram', '' ) ),
	);
	return array_filter( $links, static fn( $l ) => '' !== $l[1] );
}

/** Profile URLs an editor listed for an author (one per line), used for Person.sameAs. */
function mj_author_same_as( int $user_id ): array {
	$raw = (string) get_user_meta( $user_id, 'mj_same_as', true );
	return array_values( array_filter( array_map( 'esc_url_raw', array_map( 'trim', explode( "\n", $raw ) ) ) ) );
}

function mj_page_url( string $path ): string {
	return home_url( '/' . trim( $path, '/' ) . '/' );
}

function mj_logo_url( string $file ): string {
	return get_theme_file_uri( 'assets/images/' . $file );
}
