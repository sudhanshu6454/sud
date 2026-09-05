<?php
/**
 * SEO: NewsArticle via Yoast when present, FAQ schema, Open Graph fallback, /llms.txt.
 *
 * @package marketing-junkies
 */

defined( 'ABSPATH' ) || exit;

function mj_has_yoast(): bool {
	return defined( 'WPSEO_VERSION' );
}

// Yoast: articles are news, and the site is a news organization.
add_filter( 'wpseo_schema_article_type', fn() => 'NewsArticle' );
add_filter( 'wpseo_schema_organization_type', fn() => 'NewsMediaOrganization' );

/**
 * FAQPage schema for the autopub FAQ block (Yoast does not know about it), plus speakable on the article.
 */
function mj_head_schema(): void {
	if ( ! is_singular( 'post' ) ) {
		return;
	}
	$post    = get_queried_object();
	$article = mj_prepare_article( $post );
	$graph   = array();

	if ( $article['faq'] ) {
		$graph[] = array(
			'@type'      => 'FAQPage',
			'@id'        => get_permalink( $post ) . '#faq',
			'mainEntity' => array_map(
				fn( $qa ) => array(
					'@type'          => 'Question',
					'name'           => $qa['q'],
					'acceptedAnswer' => array( '@type' => 'Answer', 'text' => $qa['a'] ),
				),
				$article['faq']
			),
		);
	}

	if ( ! mj_has_yoast() ) {
		$cat     = mj_primary_category( $post );
		$image   = get_the_post_thumbnail_url( $post, 'post-thumbnail' );
		$graph[] = array(
			'@type'               => 'NewsArticle',
			'headline'            => get_the_title( $post ),
			'description'         => wp_strip_all_tags( get_the_excerpt( $post ) ),
			'image'               => $image ? array( $image ) : array(),
			'datePublished'       => get_the_date( DATE_W3C, $post ),
			'dateModified'        => get_the_modified_date( DATE_W3C, $post ),
			'author'              => array( '@type' => 'Person', 'name' => get_the_author_meta( 'display_name', $post->post_author ), 'url' => get_author_posts_url( $post->post_author ) ),
			'publisher'           => array( '@type' => 'NewsMediaOrganization', 'name' => get_bloginfo( 'name' ), 'logo' => array( '@type' => 'ImageObject', 'url' => MJ_URI . '/assets/img/mj-monogram.png' ) ),
			'mainEntityOfPage'    => get_permalink( $post ),
			'articleSection'      => $cat ? $cat->name : '',
			'keywords'            => implode( ', ', wp_list_pluck( wp_get_post_tags( $post->ID ), 'name' ) ),
			'isAccessibleForFree' => true,
			'speakable'           => array( '@type' => 'SpeakableSpecification', 'cssSelector' => array( '.mj-title', '.mj-takeaways' ) ),
		);
		$graph[] = array(
			'@type'           => 'BreadcrumbList',
			'itemListElement' => array_values( array_filter( array(
				array( '@type' => 'ListItem', 'position' => 1, 'name' => 'Home', 'item' => home_url( '/' ) ),
				$cat ? array( '@type' => 'ListItem', 'position' => 2, 'name' => $cat->name, 'item' => get_term_link( $cat ) ) : null,
			) ) ),
		);
		$graph[] = array(
			'@type'           => 'WebSite',
			'name'            => get_bloginfo( 'name' ),
			'url'             => home_url( '/' ),
			'potentialAction' => array( '@type' => 'SearchAction', 'target' => home_url( '/?s={search_term_string}' ), 'query-input' => 'required name=search_term_string' ),
		);
	}

	if ( $graph ) {
		echo '<script type="application/ld+json">' . wp_json_encode( array( '@context' => 'https://schema.org', '@graph' => $graph ), JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE ) . '</script>' . "\n";
	}
}
add_action( 'wp_head', 'mj_head_schema', 5 );

/**
 * Open Graph / Twitter card fallback when Yoast is not active.
 */
function mj_head_og(): void {
	if ( mj_has_yoast() ) {
		return;
	}
	$tags = array( 'og:site_name' => get_bloginfo( 'name' ), 'og:locale' => get_locale(), 'twitter:card' => 'summary_large_image' );
	if ( is_singular( 'post' ) ) {
		$post  = get_queried_object();
		$cat   = mj_primary_category( $post );
		$tags += array(
			'og:type'                => 'article',
			'og:title'               => get_the_title( $post ),
			'og:description'         => wp_strip_all_tags( get_the_excerpt( $post ) ),
			'og:url'                 => get_permalink( $post ),
			'og:image'               => get_the_post_thumbnail_url( $post, 'post-thumbnail' ),
			'article:published_time' => get_the_date( DATE_W3C, $post ),
			'article:modified_time'  => get_the_modified_date( DATE_W3C, $post ),
			'article:section'        => $cat ? $cat->name : '',
		);
		foreach ( wp_get_post_tags( $post->ID ) as $tag ) {
			printf( '<meta property="article:tag" content="%s">' . "\n", esc_attr( $tag->name ) );
		}
	} else {
		$tags += array( 'og:type' => 'website', 'og:title' => wp_get_document_title(), 'og:description' => get_bloginfo( 'description' ), 'og:url' => home_url( add_query_arg( array(), $GLOBALS['wp']->request ?? '' ) ) );
	}
	foreach ( array_filter( $tags ) as $prop => $val ) {
		$attr = str_starts_with( $prop, 'twitter:' ) ? 'name' : 'property';
		printf( '<meta %s="%s" content="%s">' . "\n", $attr, esc_attr( $prop ), esc_attr( $val ) );
	}
}
add_action( 'wp_head', 'mj_head_og', 6 );

/**
 * /llms.txt: what the site is, its sections and policy pages, for AI answer engines.
 */
function mj_llms_txt(): void {
	if ( '/llms.txt' !== ( wp_parse_url( $_SERVER['REQUEST_URI'] ?? '', PHP_URL_PATH ) ) ) {
		return;
	}
	status_header( 200 );
	header( 'Content-Type: text/plain; charset=utf-8' );
	echo '# ' . get_bloginfo( 'name' ) . "\n\n> " . get_bloginfo( 'description' ) . "\n\n";
	echo "Original coverage of marketing, media and martech news. Every article is written from a named source and ends with a link to it.\n\n## Sections\n";
	foreach ( mj_top_categories( 12 ) as $cat ) {
		echo '- [' . $cat->name . '](' . get_category_link( $cat ) . ")\n";
	}
	echo "\n## Feeds\n- [RSS](" . get_feed_link() . ")\n";
	foreach ( array( 'about', 'editorial-policy', 'corrections', 'advertise', 'contact' ) as $slug ) {
		$url = mj_page_link( $slug );
		if ( $url ) {
			echo '- [' . ucwords( str_replace( '-', ' ', $slug ) ) . '](' . $url . ")\n";
		}
	}
	exit;
}
add_action( 'template_redirect', 'mj_llms_txt' );
