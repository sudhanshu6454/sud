<?php
/**
 * Article body processing: TOC from h2s, takeaways/FAQ/source styling, sponsored links, in-article ad.
 *
 * @package marketing-junkies
 */

defined( 'ABSPATH' ) || exit;

/**
 * Prepare the article for single.php.
 *
 * @return array{html:string,toc:array<int,array{id:string,title:string}>,faq:array<int,array{q:string,a:string}>,has_takeaways:bool}
 */
function mj_prepare_article( WP_Post $post ): array {
	$html = apply_filters( 'the_content', $post->post_content );
	$html = str_replace( ']]>', ']]&gt;', $html );

	$toc  = array();
	$used = array();

	// Ids on every h2 (skipping the ones inside the takeaways/FAQ boxes) so the sticky TOC can link to them.
	$html = preg_replace_callback(
		'#<h2([^>]*)>(.*?)</h2>#is',
		function ( $m ) use ( &$toc, &$used ) {
			if ( preg_match( '/\bid=/', $m[1] ) ) {
				return $m[0];
			}
			$title = trim( wp_strip_all_tags( $m[2] ) );
			if ( '' === $title || in_array( strtolower( $title ), array( 'key takeaways', 'frequently asked' ), true ) ) {
				return $m[0];
			}
			$base = sanitize_title( $title ) ?: 'section';
			$id   = $base;
			$n    = 2;
			while ( isset( $used[ $id ] ) ) {
				$id = $base . '-' . $n++;
			}
			$used[ $id ] = true;
			$toc[]       = array( 'id' => $id, 'title' => $title );
			return sprintf( '<h2%s id="%s">%s</h2>', $m[1], esc_attr( $id ), $m[2] );
		},
		$html
	);

	// Source attribution line written by autopub: <p><em>Source: <a ...>Publisher</a></em></p>
	$html = preg_replace( '#<p>(\s*<em>\s*Source:)#i', '<p class="mj-source">$1', $html, 1 );
	$html = preg_replace( '#<p>(\s*Source:\s*<a)#i', '<p class="mj-source">$1', $html, 1 );

	// FAQ block (from autopub) -> collect Q/A for schema.
	$faq = array();
	if ( preg_match_all( '#<details[^>]*>\s*<summary[^>]*>(.*?)</summary>(.*?)</details>#is', $html, $mm, PREG_SET_ORDER ) ) {
		foreach ( $mm as $d ) {
			$q = trim( wp_strip_all_tags( $d[1] ) );
			$a = trim( wp_strip_all_tags( $d[2] ) );
			if ( $q && $a ) {
				$faq[] = array( 'q' => $q, 'a' => $a );
			}
		}
	}

	// Sponsored posts: outbound links carry rel="sponsored".
	if ( mj_is_sponsored( $post ) ) {
		$home = wp_parse_url( home_url(), PHP_URL_HOST );
		$html = preg_replace_callback(
			'#<a\s([^>]*href="(https?://[^"/]+)[^"]*"[^>]*)>#i',
			function ( $m ) use ( $home ) {
				if ( false !== stripos( $m[2], $home ) ) {
					return $m[0];
				}
				$attrs = preg_replace( '/\srel="[^"]*"/i', '', $m[1] );
				return '<a ' . $attrs . ' rel="sponsored nofollow noopener">';
			},
			$html
		);
	}

	// In-article ad before the third h2 (i.e. after the second section), only when an ad tag is configured.
	$ad = trim( (string) get_theme_mod( 'mj_ad_inarticle_1', '' ) );
	if ( '' !== $ad || get_theme_mod( 'mj_show_ad_placeholders', false ) ) {
		ob_start();
		echo '<div class="mj-ad-inarticle">';
		mj_ad_slot( 'inarticle_1', wp_is_mobile() ? 300 : 336, wp_is_mobile() ? 250 : 280 );
		echo '</div>';
		$ad_html = ob_get_clean();
		$parts   = preg_split( '#(?=<h2\b)#i', $html );
		if ( count( $parts ) >= 4 ) {
			// parts[0] = before first h2, parts[1] = section 1, parts[2] = section 2, parts[3] = section 3...
			array_splice( $parts, 3, 0, array( $ad_html ) );
			$html = implode( '', $parts );
		}
	}

	return array(
		'html'          => $html,
		'toc'           => $toc,
		'faq'           => $faq,
		'has_takeaways' => false !== stripos( $html, 'mj-takeaways' ),
	);
}
