<?php
/**
 * Getters and small render helpers shared by the templates.
 *
 * @package marketing-mentalist
 */

defined( 'ABSPATH' ) || exit;

function mm_is_sponsored( ?WP_Post $post = null ): bool {
	$post = get_post( $post );
	return $post && has_tag( 'sponsored', $post );
}

function mm_sponsor_label( ?WP_Post $post = null ): string {
	$post = get_post( $post );
	return get_post_meta( $post->ID, 'mm_sponsor_label', true ) ?: 'Sponsored';
}

function mm_reading_time( ?WP_Post $post = null ): int {
	$post = get_post( $post );
	$override = (int) get_post_meta( $post->ID, 'mm_reading_time', true );
	if ( $override > 0 ) {
		return $override;
	}
	$words = str_word_count( wp_strip_all_tags( $post->post_content ) );
	return max( 1, (int) ceil( $words / 225 ) );
}

function mm_standfirst( ?WP_Post $post = null ): string {
	$post = get_post( $post );
	$sf = get_post_meta( $post->ID, 'mm_standfirst', true );
	return $sf ?: wp_strip_all_tags( get_the_excerpt( $post ) );
}

function mm_get_brand( ?WP_Post $post = null ): ?WP_Post {
	$post = get_post( $post );
	$id = (int) get_post_meta( $post->ID, 'mm_brand_id', true );
	return $id ? get_post( $id ) : null;
}

function mm_get_agencies( ?WP_Post $post = null ): array {
	$post = get_post( $post );
	$ids = array_filter( array_map( 'intval', (array) get_post_meta( $post->ID, 'mm_agency_ids', true ) ) );
	return array_filter( array_map( 'get_post', $ids ) );
}

function mm_get_sections( ?WP_Post $post = null ): array {
	$post = get_post( $post );
	$out = array();
	$i = 1;
	foreach ( MM_SECTIONS as $key => $label ) {
		$content = trim( (string) get_post_meta( $post->ID, "mm_$key", true ) );
		if ( '' === $content ) {
			continue;
		}
		$out[] = array( 'key' => $key, 'n' => str_pad( (string) $i++, 2, '0', STR_PAD_LEFT ), 'h' => $label, 'html' => apply_filters( 'the_content', $content ) );
	}
	return $out;
}

function mm_get_assets( ?WP_Post $post = null ): array {
	$post = get_post( $post );
	$rows = get_post_meta( $post->ID, 'mm_assets', true );
	return is_array( $rows ) ? array_filter( $rows, fn( $r ) => ! empty( $r['url'] ) ) : array();
}

function mm_get_credits( ?WP_Post $post = null ): array {
	$post = get_post( $post );
	$rows = get_post_meta( $post->ID, 'mm_credits', true );
	return is_array( $rows ) ? array_filter( $rows, fn( $r ) => ! empty( $r['name'] ) ) : array();
}

function mm_get_carousel_ids( ?WP_Post $post = null ): array {
	$post = get_post( $post );
	return array_filter( array_map( 'intval', explode( ',', (string) get_post_meta( $post->ID, 'mm_carousel_ids', true ) ) ) );
}

/**
 * Related campaigns: same brand, then same principle, then same agency, topped up with the latest.
 */
function mm_related_campaigns( WP_Post $post, int $count = 4 ): array {
	$exclude = array( $post->ID );
	$out = array();
	$brand = mm_get_brand( $post );
	if ( $brand ) {
		foreach ( get_posts( array( 'post_type' => 'mm_campaign', 'posts_per_page' => $count, 'post__not_in' => $exclude, 'meta_key' => 'mm_brand_id', 'meta_value' => $brand->ID, 'no_found_rows' => true ) ) as $p ) {
			$out[ $p->ID ] = $p;
			$exclude[] = $p->ID;
		}
	}
	if ( count( $out ) < $count ) {
		$principles = wp_get_post_terms( $post->ID, 'mm_principle', array( 'fields' => 'ids' ) );
		if ( $principles ) {
			foreach ( get_posts( array( 'post_type' => 'mm_campaign', 'posts_per_page' => $count - count( $out ), 'post__not_in' => $exclude, 'tax_query' => array( array( 'taxonomy' => 'mm_principle', 'field' => 'term_id', 'terms' => $principles ) ), 'no_found_rows' => true ) ) as $p ) {
				$out[ $p->ID ] = $p;
				$exclude[] = $p->ID;
			}
		}
	}
	if ( count( $out ) < $count ) {
		foreach ( get_posts( array( 'post_type' => 'mm_campaign', 'posts_per_page' => $count - count( $out ), 'post__not_in' => $exclude, 'no_found_rows' => true ) ) as $p ) {
			$out[ $p->ID ] = $p;
		}
	}
	return array_slice( array_values( $out ), 0, $count );
}

function mm_related_breakdowns( WP_Post $post, int $count = 3 ): array {
	$cats = wp_get_post_categories( $post->ID );
	$args = array( 'post_type' => 'mm_breakdown', 'posts_per_page' => $count, 'post__not_in' => array( $post->ID ), 'no_found_rows' => true );
	if ( $cats ) {
		$args['category__in'] = $cats;
	}
	$out = get_posts( $args );
	if ( count( $out ) < $count ) {
		$args2 = array( 'post_type' => 'mm_breakdown', 'posts_per_page' => $count - count( $out ), 'post__not_in' => array_merge( array( $post->ID ), wp_list_pluck( $out, 'ID' ) ), 'no_found_rows' => true );
		$out = array_merge( $out, get_posts( $args2 ) );
	}
	return $out;
}

function mm_latest_of( array $post_types, int $count = 1 ): array {
	return get_posts( array( 'post_type' => $post_types, 'posts_per_page' => $count, 'no_found_rows' => true, 'ignore_sticky_posts' => true ) );
}

/** Cards --------------------------------------------------------------- */

function mm_campaign_meta( WP_Post $post ): string {
	$brand = mm_get_brand( $post );
	$agencies = mm_get_agencies( $post );
	$bits = array_filter( array( $brand ? $brand->post_title : '', $agencies ? $agencies[0]->post_title : '' ) );
	return implode( ' · ', $bits );
}

function mm_campaign_type_label( WP_Post $post ): string {
	$terms = get_the_terms( $post, 'mm_campaign_type' );
	return ( $terms && ! is_wp_error( $terms ) ) ? $terms[0]->name : '';
}

function mm_card_campaign( WP_Post $post ): void {
	$sponsored = mm_is_sponsored( $post );
	printf( '<a class="mm-card mm-card-top%s" href="%s">', $sponsored ? ' mm-card-sponsored' : '', esc_url( get_permalink( $post ) ) );
	echo '<div class="mm-media mm-media-16-9 grayscale">';
	if ( has_post_thumbnail( $post ) ) {
		echo get_the_post_thumbnail( $post, 'mm-card', array( 'loading' => 'lazy' ) );
	}
	echo '</div>';
	if ( $sponsored ) {
		printf( '<span class="mm-kicker">%s</span>', esc_html( mm_sponsor_label( $post ) ) );
	} else {
		printf( '<div class="mm-card-meta-row"><span>%s</span><span>%s</span></div>', esc_html( mm_campaign_meta( $post ) ), esc_html( get_the_date( 'M Y', $post ) ) );
	}
	printf( '<h3 class="mm-h3">%s</h3>', esc_html( get_the_title( $post ) ) );
	if ( ! $sponsored ) {
		printf( '<span class="mm-kicker" style="font-size:10px">%s</span>', esc_html( mm_campaign_type_label( $post ) ) );
	}
	echo '</a>';
}

function mm_card_carousel( WP_Post $post ): void {
	$ids = mm_get_carousel_ids( $post );
	printf( '<a class="mm-card" href="%s">', esc_url( get_permalink( $post ) ) );
	echo '<div class="mm-media mm-media-4-5 grayscale">';
	if ( $ids ) {
		echo wp_get_attachment_image( $ids[0], 'mm-cover', false, array( 'loading' => 'lazy' ) );
	} elseif ( has_post_thumbnail( $post ) ) {
		echo get_the_post_thumbnail( $post, 'mm-cover', array( 'loading' => 'lazy' ) );
	}
	if ( count( $ids ) > 1 ) {
		printf( '<span class="mm-media-badge" style="right:12px;top:12px">%d slides</span>', count( $ids ) );
	}
	echo '</div>';
	printf( '<div class="mm-card-meta-row"><span>%s</span><span>%s</span></div>', esc_html( mm_campaign_meta( $post ) ), esc_html( mm_campaign_type_label( $post ) ) );
	printf( '<h3 class="mm-h3">%s</h3>', esc_html( get_the_title( $post ) ) );
	echo '<span class="mm-btn-link" style="border:0;font-size:13px">View campaign →</span></a>';
}

function mm_card_breakdown( WP_Post $post ): void {
	$cats = get_the_category( $post );
	printf( '<a class="mm-card" href="%s">', esc_url( get_permalink( $post ) ) );
	echo '<div class="mm-media mm-media-16-9 grayscale">';
	if ( has_post_thumbnail( $post ) ) {
		echo get_the_post_thumbnail( $post, 'mm-card', array( 'loading' => 'lazy' ) );
	}
	echo '</div>';
	printf( '<span class="mm-kicker">%s</span>', esc_html( $cats ? $cats[0]->name : 'Breakdown' ) );
	printf( '<h3 style="font-size:26px;line-height:1.12;letter-spacing:-.02em;font-weight:700">%s</h3>', esc_html( get_the_title( $post ) ) );
	printf( '<p class="mm-body" style="font-size:15px;color:var(--mm-smoke)">%s</p>', esc_html( wp_trim_words( mm_standfirst( $post ), 22 ) ) );
	printf( '<span class="mm-meta">%d min read</span></a>', mm_reading_time( $post ) );
}

function mm_card_breakdown_related( WP_Post $post ): void {
	$cats = get_the_category( $post );
	printf( '<a class="mm-card mm-card-top" href="%s">', esc_url( get_permalink( $post ) ) );
	echo '<div class="mm-media mm-media-16-9 grayscale">';
	if ( has_post_thumbnail( $post ) ) {
		echo get_the_post_thumbnail( $post, 'mm-card', array( 'loading' => 'lazy' ) );
	}
	echo '</div>';
	printf( '<span class="mm-kicker" style="font-size:10px">%s</span>', esc_html( $cats ? $cats[0]->name : 'Breakdown' ) );
	printf( '<h3 class="mm-h3">%s</h3></a>', esc_html( get_the_title( $post ) ) );
}

/** Nav / breadcrumb / footer -------------------------------------------- */

function mm_nav_menu( string $location, string $class ): void {
	if ( has_nav_menu( $location ) ) {
		wp_nav_menu( array( 'theme_location' => $location, 'container' => false, 'menu_class' => $class, 'depth' => 1 ) );
		return;
	}
	$links = array(
		'Campaigns'  => get_post_type_archive_link( 'mm_campaign' ),
		'Breakdowns' => get_post_type_archive_link( 'mm_breakdown' ),
		'Psychology' => get_term_link( get_terms( array( 'taxonomy' => 'mm_principle', 'number' => 1, 'fields' => 'ids' ) )[0] ?? 0, 'mm_principle' ) ?: home_url( '/' ),
		'News'       => home_url( '/' ),
		'Brands'     => get_post_type_archive_link( 'mm_brand' ),
	);
	echo '<ul class="' . esc_attr( $class ) . '">';
	foreach ( $links as $label => $url ) {
		if ( is_string( $url ) ) {
			printf( '<li><a href="%s">%s</a></li>', esc_url( $url ), esc_html( $label ) );
		}
	}
	echo '</ul>';
}

function mm_breadcrumb( array $items ): void {
	echo '<nav class="mm-meta" aria-label="Breadcrumb" style="display:flex;gap:12px;flex-wrap:wrap">';
	$last = array_key_last( $items );
	foreach ( $items as $i => list( $url, $label ) ) {
		if ( $i > 0 ) {
			echo '<span aria-hidden="true">/</span>';
		}
		if ( $i === $last || ! $url ) {
			printf( '<span style="color:var(--mm-ink)">%s</span>', esc_html( $label ) );
		} else {
			printf( '<a href="%s">%s</a>', esc_url( $url ), esc_html( $label ) );
		}
	}
	echo '</nav>';
}

function mm_page_link( string $slug ): ?string {
	$page = get_page_by_path( $slug );
	return $page && 'publish' === $page->post_status ? get_permalink( $page ) : null;
}

function mm_media_kit(): array {
	return array(
		array( 'v' => get_theme_mod( 'mm_stat_readers', '—' ), 'k' => 'Monthly readers' ),
		array( 'v' => get_theme_mod( 'mm_stat_social', '—' ), 'k' => 'Social followers' ),
		array( 'v' => get_theme_mod( 'mm_stat_subscribers', '—' ), 'k' => 'Newsletter subscribers' ),
		array( 'v' => get_theme_mod( 'mm_stat_campaigns', '—' ), 'k' => 'Campaigns decoded' ),
	);
}

/** Campaign archive facet query wiring: ?mm_industry=&mm_principle=&mm_emotion=&year= */
function mm_campaign_archive_query( WP_Query $query ): void {
	if ( is_admin() || ! $query->is_main_query() || ! $query->is_post_type_archive( 'mm_campaign' ) ) {
		return;
	}
	$tax_query = array();
	foreach ( array( 'mm_industry', 'mm_principle', 'mm_emotion' ) as $tax ) {
		if ( ! empty( $_GET[ $tax ] ) ) { // phpcs:ignore WordPress.Security.NonceVerification.Recommended -- read-only filter.
			$tax_query[] = array( 'taxonomy' => $tax, 'field' => 'slug', 'terms' => sanitize_title( wp_unslash( $_GET[ $tax ] ) ) ); // phpcs:ignore WordPress.Security.NonceVerification.Recommended -- read-only filter.
		}
	}
	if ( $tax_query ) {
		$query->set( 'tax_query', $tax_query );
	}
	if ( ! empty( $_GET['year'] ) ) { // phpcs:ignore WordPress.Security.NonceVerification.Recommended -- read-only filter.
		$query->set( 'year', (int) $_GET['year'] ); // phpcs:ignore WordPress.Security.NonceVerification.Recommended -- read-only filter.
	}
}
add_action( 'pre_get_posts', 'mm_campaign_archive_query' );

function mm_facet_link( string $key, string $value ): string {
	$args = array( $key => $value );
	$current = $_GET[ $key ] ?? ''; // phpcs:ignore WordPress.Security.NonceVerification.Recommended -- read-only.
	if ( $current === $value ) {
		unset( $args[ $key ] );
	}
	return esc_url( add_query_arg( $args, get_post_type_archive_link( 'mm_campaign' ) ) );
}

function mm_facet_active( string $key, string $value ): bool {
	return ( $_GET[ $key ] ?? '' ) === $value; // phpcs:ignore WordPress.Security.NonceVerification.Recommended -- read-only.
}
