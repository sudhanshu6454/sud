<?php
/**
 * Schema, Open Graph fallback, /llms.txt + /llms-full.txt, and the read-only campaign REST endpoint.
 * Yoast (when active) drives titles/meta/sitemap/canonical and NewsArticle/Organization schema via
 * the filters below; these functions only fill the gap it leaves (FAQ-less types, llms.txt, REST).
 *
 * @package marketing-mentalist
 */

defined( 'ABSPATH' ) || exit;

function mm_has_yoast(): bool {
	return defined( 'WPSEO_VERSION' );
}

add_filter( 'wpseo_schema_article_type', fn() => 'NewsArticle' );
add_filter( 'wpseo_schema_organization_type', fn() => 'NewsMediaOrganization' );

function mm_head_schema(): void {
	$graph = array();
	$post = is_singular() ? get_queried_object() : null;

	if ( $post instanceof WP_Post && 'mm_campaign' === $post->post_type ) {
		$brand = mm_get_brand( $post );
		$agencies = mm_get_agencies( $post );
		$creative_work = array(
			'@type'   => 'CreativeWork',
			'name'    => get_the_title( $post ),
			'creator' => $agencies ? array( '@type' => 'Organization', 'name' => $agencies[0]->post_title ) : null,
			'about'   => $brand ? array( '@type' => 'Organization', 'name' => $brand->post_title ) : null,
			'genre'   => wp_list_pluck( get_the_terms( $post, 'mm_campaign_type' ) ?: array(), 'name' ),
			'keywords' => implode( ', ', wp_list_pluck( get_the_terms( $post, 'mm_principle' ) ?: array(), 'name' ) ),
		);
		$hero_type = get_post_meta( $post->ID, 'mm_hero_type', true );
		$hero_url = get_post_meta( $post->ID, 'mm_hero_url', true );
		if ( in_array( $hero_type, array( 'youtube', 'vimeo', 'mp4' ), true ) && $hero_url ) {
			$graph[] = array(
				'@type' => 'VideoObject', 'name' => get_the_title( $post ),
				'thumbnailUrl' => get_the_post_thumbnail_url( $post, 'post-thumbnail' ),
				'uploadDate' => get_the_date( DATE_W3C, $post ), 'embedUrl' => $hero_url,
			);
		}
		$graph[] = array(
			'@type' => 'Article', '@id' => get_permalink( $post ) . '#article',
			'headline' => get_the_title( $post ), 'datePublished' => get_the_date( DATE_W3C, $post ),
			'dateModified' => get_the_modified_date( DATE_W3C, $post ), 'mainEntity' => $creative_work,
			'isAccessibleForFree' => ! mm_is_sponsored( $post ) || true,
		);
		if ( mm_is_sponsored( $post ) && $brand ) {
			$graph[0]['sponsor'] = array( '@type' => 'Organization', 'name' => $brand->post_title );
		}
	} elseif ( $post instanceof WP_Post && in_array( $post->post_type, array( 'mm_breakdown', 'post' ), true ) && ! mm_has_yoast() ) {
		$cats = get_the_category( $post );
		$graph[] = array(
			'@type' => 'NewsArticle', 'headline' => get_the_title( $post ),
			'description' => wp_strip_all_tags( mm_standfirst( $post ) ),
			'image' => array_filter( array( get_the_post_thumbnail_url( $post, 'post-thumbnail' ) ) ),
			'datePublished' => get_the_date( DATE_W3C, $post ), 'dateModified' => get_the_modified_date( DATE_W3C, $post ),
			'author' => array( '@type' => 'Person', 'name' => get_the_author_meta( 'display_name', $post->post_author ), 'url' => get_author_posts_url( $post->post_author ) ),
			'publisher' => array( '@type' => 'NewsMediaOrganization', 'name' => get_bloginfo( 'name' ), 'logo' => array( '@type' => 'ImageObject', 'url' => MM_URI . '/assets/img/mark.png' ) ),
			'articleSection' => $cats ? $cats[0]->name : '', 'isAccessibleForFree' => true,
			'speakable' => array( '@type' => 'SpeakableSpecification', 'cssSelector' => array( '.mm-standfirst', '.mm-take' ) ),
		);
	} elseif ( $post instanceof WP_Post && 'mm_take' === $post->post_type ) {
		$graph[] = array( '@type' => 'Article', 'headline' => get_the_title( $post ), 'mainEntity' => array( '@type' => 'Quotation', 'text' => wp_strip_all_tags( $post->post_content ) ) );
	} elseif ( $post instanceof WP_Post && in_array( $post->post_type, array( 'mm_brand', 'mm_agency' ), true ) ) {
		$campaigns = get_posts( array( 'post_type' => 'mm_campaign', 'meta_key' => 'mm_brand_id', 'meta_value' => $post->ID, 'posts_per_page' => 20, 'no_found_rows' => true ) );
		$graph[] = array(
			'@type' => 'Organization', 'name' => get_the_title( $post ), 'url' => get_post_meta( $post->ID, 'mm_website', true ) ?: get_permalink( $post ),
		);
		if ( $campaigns ) {
			$graph[] = array( '@type' => 'ItemList', 'itemListElement' => array_values( array_map( fn( $c, $i ) => array( '@type' => 'ListItem', 'position' => $i + 1, 'url' => get_permalink( $c ) ), $campaigns, array_keys( $campaigns ) ) ) );
		}
	} elseif ( $post instanceof WP_Post && 'mm_list' === $post->post_type ) {
		$graph[] = array( '@type' => 'ItemList', 'name' => get_the_title( $post ) );
	}

	if ( $post instanceof WP_Post && ! mm_has_yoast() ) {
		$graph[] = array(
			'@type' => 'BreadcrumbList',
			'itemListElement' => array( array( '@type' => 'ListItem', 'position' => 1, 'name' => 'Home', 'item' => home_url( '/' ) ) ),
		);
	}
	if ( ! is_singular() ) {
		$graph[] = array(
			'@type' => 'WebSite', 'name' => get_bloginfo( 'name' ), 'url' => home_url( '/' ),
			'potentialAction' => array( '@type' => 'SearchAction', 'target' => home_url( '/?s={search_term_string}' ), 'query-input' => 'required name=search_term_string' ),
		);
	}
	if ( $graph ) {
		echo '<script type="application/ld+json">' . wp_json_encode( array( '@context' => 'https://schema.org', '@graph' => array_values( array_filter( $graph ) ) ), JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE ) . '</script>' . "\n";
	}
}
add_action( 'wp_head', 'mm_head_schema', 5 );

function mm_head_og(): void {
	if ( mm_has_yoast() ) {
		return;
	}
	$tags = array( 'og:site_name' => get_bloginfo( 'name' ), 'twitter:card' => 'summary_large_image' );
	if ( is_singular() ) {
		$post = get_queried_object();
		$tags += array(
			'og:type' => in_array( $post->post_type, array( 'mm_breakdown', 'post' ), true ) ? 'article' : 'website',
			'og:title' => get_the_title( $post ), 'og:description' => wp_strip_all_tags( mm_standfirst( $post ) ),
			'og:url' => get_permalink( $post ), 'og:image' => get_the_post_thumbnail_url( $post, 'post-thumbnail' ),
		);
	} else {
		$tags += array( 'og:type' => 'website', 'og:title' => wp_get_document_title(), 'og:url' => home_url( add_query_arg( array(), $GLOBALS['wp']->request ?? '' ) ) );
	}
	foreach ( array_filter( $tags ) as $prop => $val ) {
		printf( '<meta %s="%s" content="%s">' . "\n", str_starts_with( $prop, 'twitter:' ) ? 'name' : 'property', esc_attr( $prop ), esc_attr( $val ) );
	}
}
add_action( 'wp_head', 'mm_head_og', 6 );

function mm_llms_routes(): void {
	$path = wp_parse_url( $_SERVER['REQUEST_URI'] ?? '', PHP_URL_PATH );
	if ( '/llms.txt' === $path ) {
		mm_render_llms_txt();
	} elseif ( '/llms-full.txt' === $path ) {
		mm_render_llms_full_txt();
	}
}
add_action( 'template_redirect', 'mm_llms_routes', 0 ); // before redirect_canonical (priority 10) so a trailing-slash quirk can't intercept it

function mm_render_llms_txt(): void {
	status_header( 200 );
	header( 'Content-Type: text/plain; charset=utf-8' );
	echo '# ' . get_bloginfo( 'name' ) . "\n\n> " . get_bloginfo( 'description' ) . "\n\n";
	echo "The psychology behind marketing that works. Campaigns decoded in six sections, long-form breakdowns, and daily marketing news - every story links to its source.\n\n## Sections\n";
	echo '- [Campaigns](' . get_post_type_archive_link( 'mm_campaign' ) . ")\n";
	echo '- [Breakdowns](' . get_post_type_archive_link( 'mm_breakdown' ) . ")\n";
	echo '- [Brands](' . get_post_type_archive_link( 'mm_brand' ) . ")\n";
	echo '- [Agencies](' . get_post_type_archive_link( 'mm_agency' ) . ")\n";
	echo '- [Top lists](' . get_post_type_archive_link( 'mm_list' ) . ")\n";
	echo "\n## Psychology principles\n";
	foreach ( get_terms( array( 'taxonomy' => 'mm_principle', 'hide_empty' => false ) ) as $term ) {
		echo '- [' . $term->name . '](' . get_term_link( $term ) . ")\n";
	}
	echo "\n## Policy\n";
	foreach ( array( 'editorial-policy' => 'Editorial policy', 'corrections-policy' => 'Corrections policy', 'about' => 'About', 'contact' => 'Contact' ) as $slug => $label ) {
		$url = mm_page_link( $slug );
		if ( $url ) {
			echo '- [' . $label . '](' . $url . ")\n";
		}
	}
	echo "\n## Recent campaigns\n";
	foreach ( get_posts( array( 'post_type' => 'mm_campaign', 'posts_per_page' => 20, 'no_found_rows' => true ) ) as $c ) {
		echo '- [' . get_the_title( $c ) . '](' . get_permalink( $c ) . ') - ' . wp_strip_all_tags( get_post_meta( $c->ID, 'mm_summary', true ) ?: get_the_excerpt( $c ) ) . "\n";
	}
	echo "\n[Full structured index](" . home_url( '/llms-full.txt' ) . ")\n";
	exit;
}

function mm_render_llms_full_txt(): void {
	status_header( 200 );
	header( 'Content-Type: text/plain; charset=utf-8' );
	echo "# " . get_bloginfo( 'name' ) . " - full campaign index\n\n";
	foreach ( get_posts( array( 'post_type' => 'mm_campaign', 'posts_per_page' => 500, 'no_found_rows' => true ) ) as $c ) {
		$brand = mm_get_brand( $c );
		$agencies = mm_get_agencies( $c );
		echo '## ' . get_the_title( $c ) . "\n";
		echo '- URL: ' . get_permalink( $c ) . "\n";
		echo '- Brand: ' . ( $brand ? $brand->post_title : '—' ) . "\n";
		echo '- Agency: ' . ( $agencies ? implode( ', ', wp_list_pluck( $agencies, 'post_title' ) ) : '—' ) . "\n";
		echo '- Year: ' . get_the_date( 'Y', $c ) . "\n";
		echo '- Market: ' . implode( ', ', wp_list_pluck( get_the_terms( $c, 'mm_market' ) ?: array(), 'name' ) ) . "\n";
		echo '- Type: ' . implode( ', ', wp_list_pluck( get_the_terms( $c, 'mm_campaign_type' ) ?: array(), 'name' ) ) . "\n";
		echo '- Principle: ' . implode( ', ', wp_list_pluck( get_the_terms( $c, 'mm_principle' ) ?: array(), 'name' ) ) . "\n";
		echo '- Summary: ' . wp_strip_all_tags( get_post_meta( $c->ID, 'mm_summary', true ) ) . "\n";
		echo '- Mentalist take: ' . wp_strip_all_tags( get_post_meta( $c->ID, 'mm_take', true ) ) . "\n\n";
	}
	exit;
}

/**
 * Read-only campaign data as JSON - the Phase 3 "Ask the Mentalist" surface (HANDOVER.md §9).
 */
function mm_register_rest_routes(): void {
	register_rest_route( 'mm/v1', '/campaign/(?P<slug>[a-z0-9-]+)', array(
		'methods'  => 'GET',
		'callback' => function ( WP_REST_Request $req ) {
			$post = get_page_by_path( $req['slug'], OBJECT, 'mm_campaign' );
			if ( ! $post || 'publish' !== $post->post_status ) {
				return new WP_Error( 'mm_not_found', 'Campaign not found', array( 'status' => 404 ) );
			}
			$brand = mm_get_brand( $post );
			return array(
				'title'     => get_the_title( $post ),
				'url'       => get_permalink( $post ),
				'brand'     => $brand ? $brand->post_title : null,
				'agencies'  => wp_list_pluck( mm_get_agencies( $post ), 'post_title' ),
				'year'      => get_the_date( 'Y', $post ),
				'market'    => wp_list_pluck( get_the_terms( $post, 'mm_market' ) ?: array(), 'name' ),
				'type'      => wp_list_pluck( get_the_terms( $post, 'mm_campaign_type' ) ?: array(), 'name' ),
				'principle' => wp_list_pluck( get_the_terms( $post, 'mm_principle' ) ?: array(), 'name' ),
				'summary'   => get_post_meta( $post->ID, 'mm_summary', true ),
				'take'      => get_post_meta( $post->ID, 'mm_take', true ),
				'sections'  => array_map( fn( $s ) => array( 'heading' => $s['h'], 'html' => $s['html'] ), mm_get_sections( $post ) ),
			);
		},
		'permission_callback' => '__return_true',
	) );
}
add_action( 'rest_api_init', 'mm_register_rest_routes' );
