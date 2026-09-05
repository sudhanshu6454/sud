<?php
/**
 * Small helpers used by the templates.
 *
 * @package marketing-junkies
 */

defined( 'ABSPATH' ) || exit;

/**
 * Primary category: Yoast's primary term when set, otherwise the first non-default category.
 */
function mj_primary_category( ?WP_Post $post = null ): ?WP_Term {
	$post = get_post( $post );
	if ( ! $post ) {
		return null;
	}
	if ( class_exists( 'WPSEO_Primary_Term' ) ) {
		$primary = ( new WPSEO_Primary_Term( 'category', $post->ID ) )->get_primary_term();
		if ( $primary ) {
			$term = get_term( $primary, 'category' );
			if ( $term instanceof WP_Term ) {
				return $term;
			}
		}
	}
	$cats = get_the_category( $post->ID );
	$default = (int) get_option( 'default_category' );
	usort( $cats, fn( $a, $b ) => ( $a->term_id === $default ) <=> ( $b->term_id === $default ) );
	return $cats ? $cats[0] : null;
}

function mj_is_sponsored( ?WP_Post $post = null ): bool {
	$post = get_post( $post );
	return $post && has_tag( 'sponsored', $post );
}

/**
 * Kicker above the headline: "Category · First tag" (or "Partner content · Category" when sponsored).
 */
function mj_kicker( ?WP_Post $post = null ): string {
	$post = get_post( $post );
	$cat  = mj_primary_category( $post );
	$name = $cat ? $cat->name : get_bloginfo( 'name' );
	if ( mj_is_sponsored( $post ) ) {
		return sprintf( '%s · %s', __( 'Partner content', 'marketing-junkies' ), $name );
	}
	$tags = array_filter( wp_get_post_tags( $post->ID ), fn( $t ) => 'sponsored' !== $t->slug );
	$tag  = $tags ? reset( $tags )->name : '';
	return $tag ? sprintf( '%s · %s', $name, $tag ) : $name;
}

function mj_reading_time( ?WP_Post $post = null ): int {
	$post  = get_post( $post );
	$words = str_word_count( wp_strip_all_tags( $post->post_content ) );
	return max( 1, (int) ceil( $words / 220 ) );
}

/**
 * "Friday 5 September 2026" in the site's timezone.
 */
function mj_today(): string {
	return wp_date( 'l j F Y' );
}

/**
 * Breadcrumb: Home / parent category / category.
 */
function mj_breadcrumb( ?WP_Post $post = null ): void {
	$post  = get_post( $post );
	$items = array( array( home_url( '/' ), __( 'Home', 'marketing-junkies' ) ) );
	$cat   = mj_primary_category( $post );
	if ( $cat ) {
		$chain = array_reverse( get_ancestors( $cat->term_id, 'category' ) );
		$chain[] = $cat->term_id;
		foreach ( $chain as $id ) {
			$term = get_term( $id, 'category' );
			if ( $term instanceof WP_Term ) {
				$items[] = array( get_term_link( $term ), $term->name );
			}
		}
	}
	echo '<nav class="mj-breadcrumb" aria-label="' . esc_attr__( 'Breadcrumb', 'marketing-junkies' ) . '">';
	foreach ( $items as $i => [ $url, $label ] ) {
		if ( $i ) {
			echo '<span aria-hidden="true">/</span>';
		}
		printf( '<a href="%s">%s</a>', esc_url( $url ), esc_html( $label ) );
	}
	echo '</nav>';
}

/**
 * Render an ad slot. Real ad markup comes from the Customizer; the dashed placeholder only shows when enabled.
 */
function mj_ad_slot( string $slot, int $width, int $height, string $class = '' ): void {
	$html        = trim( (string) get_theme_mod( 'mj_ad_' . $slot, '' ) );
	$placeholder = (bool) get_theme_mod( 'mj_show_ad_placeholders', false );
	if ( '' === $html && ! $placeholder ) {
		return;
	}
	$style = sprintf( 'width:%dpx;max-width:100%%;height:%dpx', $width, $height );
	printf( '<div class="mj-ad %s" data-ad-slot="mj_%s">', esc_attr( $class ), esc_attr( $slot ) );
	if ( '' !== $html ) {
		printf( '<div style="%s">%s</div>', esc_attr( $style ), $html ); // phpcs:ignore WordPress.Security.EscapeOutput -- administrator-provided ad tag.
	} else {
		printf(
			'<div class="mj-ad-placeholder %s" style="%s"><span>%s</span><span>%d×%d · mj_%s</span></div>',
			$height > 120 ? 'is-tall' : '',
			esc_attr( $style ),
			esc_html__( 'Advertisement', 'marketing-junkies' ),
			$width,
			$height,
			esc_html( $slot )
		);
	}
	echo '</div>';
}

/**
 * Story card used on home, archives, related and search.
 *
 * @param array $opts { 'size' => image size, 'excerpt' => bool, 'sponsored' => bool }
 */
function mj_card( WP_Post $post, array $opts = array() ): void {
	$opts      = wp_parse_args( $opts, array( 'size' => 'mj-card', 'excerpt' => false ) );
	$cat       = mj_primary_category( $post );
	$sponsored = mj_is_sponsored( $post );
	printf( '<a class="mj-card%s" href="%s">', $sponsored ? ' is-sponsored' : '', esc_url( get_permalink( $post ) ) );
	echo '<div class="mj-card-media grayscale">';
	if ( has_post_thumbnail( $post ) ) {
		echo get_the_post_thumbnail( $post, $opts['size'], array( 'loading' => 'lazy' ) );
	}
	echo '</div>';
	printf(
		'<span class="mj-card-kicker">%s</span>',
		$sponsored ? esc_html__( 'Sponsored', 'marketing-junkies' ) : esc_html( $cat ? $cat->name : get_bloginfo( 'name' ) )
	);
	printf( '<h3 class="mj-card-title">%s</h3>', esc_html( get_the_title( $post ) ) );
	if ( $opts['excerpt'] ) {
		printf( '<p class="mj-card-excerpt">%s</p>', esc_html( wp_trim_words( get_the_excerpt( $post ), 24 ) ) );
	}
	printf(
		'<span class="mj-card-meta">%s · %s</span>',
		$sponsored ? esc_html__( 'Partner content', 'marketing-junkies' ) : esc_html( get_the_date( 'j M', $post ) ),
		/* translators: %d: minutes */
		esc_html( sprintf( __( '%d min', 'marketing-junkies' ), mj_reading_time( $post ) ) )
	);
	echo '</a>';
}

/**
 * Posts sharing the primary category, newest first, excluding the current one; falls back to latest.
 */
function mj_related_posts( WP_Post $post, int $count = 4 ): array {
	$cat  = mj_primary_category( $post );
	$args = array(
		'post_type'           => 'post',
		'posts_per_page'      => $count,
		'post__not_in'        => array( $post->ID ),
		'ignore_sticky_posts' => true,
		'no_found_rows'       => true,
	);
	if ( $cat ) {
		$args['cat'] = $cat->term_id;
	}
	$posts = get_posts( $args );
	if ( count( $posts ) < $count ) {
		unset( $args['cat'] );
		$args['post__not_in'] = array_merge( array( $post->ID ), wp_list_pluck( $posts, 'ID' ) );
		$args['posts_per_page'] = $count - count( $posts );
		$posts = array_merge( $posts, get_posts( $args ) );
	}
	return $posts;
}

function mj_latest_posts( int $count = 4, array $exclude = array() ): array {
	return get_posts(
		array(
			'post_type'           => 'post',
			'posts_per_page'      => $count,
			'post__not_in'        => $exclude,
			'ignore_sticky_posts' => true,
			'no_found_rows'       => true,
		)
	);
}

/**
 * Top categories (by count) used as a menu fallback and in the footer.
 */
function mj_top_categories( int $count = 6 ): array {
	return get_categories(
		array(
			'orderby'    => 'count',
			'order'      => 'DESC',
			'number'     => $count,
			'hide_empty' => true,
			'exclude'    => array( (int) get_option( 'default_category' ) ),
		)
	);
}

function mj_nav_menu( string $location, string $class ): void {
	if ( has_nav_menu( $location ) ) {
		wp_nav_menu(
			array(
				'theme_location' => $location,
				'container'      => false,
				'menu_class'     => $class,
				'depth'          => 1,
			)
		);
		return;
	}
	$cats = mj_top_categories( 'primary' === $location ? 6 : 4 );
	if ( ! $cats ) {
		return;
	}
	echo '<ul class="' . esc_attr( $class ) . '">';
	foreach ( $cats as $cat ) {
		printf(
			'<li class="%s"><a href="%s">%s</a></li>',
			is_category( $cat->term_id ) ? 'current-cat' : '',
			esc_url( get_category_link( $cat ) ),
			esc_html( $cat->name )
		);
	}
	echo '</ul>';
}

/**
 * Page link by slug, or null when the page does not exist (links are hidden rather than dead).
 */
function mj_page_link( string $slug ): ?string {
	$page = get_page_by_path( $slug );
	return $page && 'publish' === $page->post_status ? get_permalink( $page ) : null;
}

/**
 * Social profile links from the Customizer.
 */
function mj_social_links(): array {
	$out = array();
	foreach ( array( 'linkedin' => 'LinkedIn', 'x' => 'X', 'instagram' => 'Instagram', 'telegram' => 'Telegram', 'facebook' => 'Facebook', 'threads' => 'Threads' ) as $key => $label ) {
		$url = get_theme_mod( 'mj_social_' . $key, '' );
		if ( $url ) {
			$out[ $label ] = $url;
		}
	}
	return $out;
}
