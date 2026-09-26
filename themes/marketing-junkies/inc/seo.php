<?php
/**
 * Head output: one JSON-LD graph, Open Graph / Twitter cards and article meta.
 *
 * Yoast SEO is installed fleet-wide. It keeps the canonical, meta description, robots and XML
 * sitemaps; this theme takes over schema and social tags so there is exactly one graph per page.
 *
 * @package marketing-junkies
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

add_filter( 'wpseo_json_ld_output', '__return_false' );
add_filter(
	'wpseo_frontend_presenter_classes',
	static fn( array $classes ): array => array_values(
		array_filter( $classes, static fn( $c ) => ! str_contains( $c, '\\Open_Graph\\' ) && ! str_contains( $c, '\\Twitter\\' ) )
	)
);

function mj_yoast_active(): bool {
	return defined( 'WPSEO_VERSION' );
}

function mj_org_node(): array {
	return array_filter(
		array(
			'@type'  => 'NewsMediaOrganization',
			'@id'    => home_url( '/#organization' ),
			'name'   => get_bloginfo( 'name' ),
			'url'    => home_url( '/' ),
			'logo'   => array(
				'@type'  => 'ImageObject',
				'url'    => mj_logo_url( 'site-icon.png' ),
				'width'  => 512,
				'height' => 512,
			),
			'sameAs' => array_values( wp_list_pluck( mj_social_links(), 1 ) ),
			'publishingPrinciples'       => mj_page_url( 'editorial-policy' ),
			'correctionsPolicy'          => mj_page_url( 'corrections' ),
		)
	);
}

function mj_website_node(): array {
	return array(
		'@type'           => 'WebSite',
		'@id'             => home_url( '/#website' ),
		'url'             => home_url( '/' ),
		'name'            => get_bloginfo( 'name' ),
		'description'     => get_bloginfo( 'description' ),
		'inLanguage'      => get_bloginfo( 'language' ),
		'publisher'       => array( '@id' => home_url( '/#organization' ) ),
		'potentialAction' => array(
			'@type'       => 'SearchAction',
			'target'      => array(
				'@type'       => 'EntryPoint',
				'urlTemplate' => home_url( '/?s={search_term_string}' ),
			),
			'query-input' => 'required name=search_term_string',
		),
	);
}

function mj_person_node( int $user_id ): array {
	$url = get_author_posts_url( $user_id );
	return array_filter(
		array(
			'@type'  => 'Person',
			'@id'    => $url . '#person',
			'name'   => get_the_author_meta( 'display_name', $user_id ),
			'url'    => $url,
			'description' => get_the_author_meta( 'description', $user_id ),
			'sameAs' => mj_author_same_as( $user_id ),
		)
	);
}

function mj_featured_image( WP_Post $post ): ?array {
	if ( ! has_post_thumbnail( $post ) ) {
		return null;
	}
	$id  = get_post_thumbnail_id( $post );
	$src = wp_get_attachment_image_src( $id, 'full' );
	if ( ! $src ) {
		return null;
	}
	return array(
		'url'    => $src[0],
		'width'  => (int) $src[1],
		'height' => (int) $src[2],
		'alt'    => (string) get_post_meta( $id, '_wp_attachment_image_alt', true ),
	);
}

function mj_article_graph( WP_Post $post ): array {
	$url       = get_permalink( $post );
	$cat       = mj_primary_category( $post );
	$tags      = get_the_tags( $post->ID );
	$tag_names = array();
	foreach ( $tags && ! is_wp_error( $tags ) ? $tags : array() as $tag ) {
		if ( MJ_SPONSORED_TAG !== $tag->slug ) {
			$tag_names[] = $tag->name;
		}
	}
	$image     = mj_featured_image( $post );
	$parts     = mj_article_parts( $post );
	$sponsored = mj_is_sponsored( $post );

	$article = array_filter(
		array(
			// Paid pieces are labelled as advertiser content, not news.
			'@type'               => $sponsored ? 'AdvertiserContentArticle' : 'NewsArticle',
			'@id'                 => $url . '#article',
			'mainEntityOfPage'    => $url,
			'headline'            => mb_substr( wp_strip_all_tags( get_the_title( $post ) ), 0, 110 ),
			'description'         => wp_strip_all_tags( get_the_excerpt( $post ) ),
			'image'               => $image ? array(
				'@type'  => 'ImageObject',
				'url'    => $image['url'],
				'width'  => $image['width'],
				'height' => $image['height'],
			) : null,
			'datePublished'       => get_post_time( 'c', false, $post ),
			'dateModified'        => get_post_modified_time( 'c', false, $post ),
			'author'              => mj_person_node( (int) $post->post_author ),
			'publisher'           => array( '@id' => home_url( '/#organization' ) ),
			'isPartOf'            => array( '@id' => home_url( '/#website' ) ),
			'isAccessibleForFree' => true,
			'articleSection'      => $cat ? $cat->name : null,
			'keywords'            => $tag_names ? implode( ', ', $tag_names ) : null,
			'wordCount'           => mj_word_count( $post ),
			'inLanguage'          => get_bloginfo( 'language' ),
			'sponsor'             => $sponsored ? array(
				'@type' => 'Organization',
				'name'  => mj_sponsor_name( $post ),
			) : null,
			'speakable'           => array(
				'@type'       => 'SpeakableSpecification',
				'cssSelector' => $parts['takeaways'] ? array( '.mj-headline', '.mj-takeaways' ) : array( '.mj-headline', '.mj-standfirst' ),
			),
		),
		static fn( $v ) => null !== $v
	);

	$crumbs = array(
		array(
			'@type'    => 'ListItem',
			'position' => 1,
			'name'     => __( 'Home', 'marketing-junkies' ),
			'item'     => home_url( '/' ),
		),
	);
	if ( $cat ) {
		$crumbs[] = array(
			'@type'    => 'ListItem',
			'position' => 2,
			'name'     => $cat->name,
			'item'     => get_category_link( $cat ),
		);
	}
	$crumbs[] = array(
		'@type'    => 'ListItem',
		'position' => count( $crumbs ) + 1,
		'name'     => wp_strip_all_tags( get_the_title( $post ) ),
		'item'     => $url,
	);

	$graph = array(
		mj_org_node(),
		mj_website_node(),
		$article,
		array(
			'@type'           => 'BreadcrumbList',
			'@id'             => $url . '#breadcrumb',
			'itemListElement' => $crumbs,
		),
	);

	if ( $parts['faq'] ) {
		$graph[] = array(
			'@type'      => 'FAQPage',
			'@id'        => $url . '#faq',
			'isPartOf'   => array( '@id' => $url . '#article' ),
			'mainEntity' => array_map(
				static fn( $qa ) => array(
					'@type'          => 'Question',
					'name'           => $qa['q'],
					'acceptedAnswer' => array(
						'@type' => 'Answer',
						'text'  => $qa['a'],
					),
				),
				$parts['faq']
			),
		);
	}
	return $graph;
}

function mj_meta( string $attr, string $key, string $value ): void {
	if ( '' !== $value ) {
		printf( '<meta %s="%s" content="%s">' . "\n", $attr, esc_attr( $key ), esc_attr( $value ) );
	}
}

add_action(
	'wp_head',
	static function () {
		$post  = is_singular( 'post' ) ? get_queried_object() : null;
		$graph = $post instanceof WP_Post ? mj_article_graph( $post ) : array( mj_org_node(), mj_website_node() );
		$user  = is_author() ? get_queried_object() : null;
		if ( $user instanceof WP_User ) {
			$graph[] = array(
				'@type'      => 'ProfilePage',
				'@id'        => get_author_posts_url( $user->ID ),
				'isPartOf'   => array( '@id' => home_url( '/#website' ) ),
				'mainEntity' => mj_person_node( $user->ID ),
			);
		}

		if ( $post instanceof WP_Post ) {
			$title   = wp_strip_all_tags( get_the_title( $post ) );
			$excerpt = wp_strip_all_tags( get_the_excerpt( $post ) );
			$image   = mj_featured_image( $post );
			if ( ! mj_yoast_active() ) {
				mj_meta( 'name', 'description', $excerpt );
			}
			if ( mj_is_sponsored( $post ) ) {
				// Keeps paid content out of Google News while leaving it in web search.
				mj_meta( 'name', 'Googlebot-News', 'noindex' );
			}
			mj_meta( 'property', 'og:type', 'article' );
			mj_meta( 'property', 'og:site_name', get_bloginfo( 'name' ) );
			mj_meta( 'property', 'og:locale', str_replace( '-', '_', get_bloginfo( 'language' ) ) );
			mj_meta( 'property', 'og:title', $title );
			mj_meta( 'property', 'og:description', $excerpt );
			mj_meta( 'property', 'og:url', get_permalink( $post ) );
			if ( $image ) {
				mj_meta( 'property', 'og:image', $image['url'] );
				mj_meta( 'property', 'og:image:width', (string) $image['width'] );
				mj_meta( 'property', 'og:image:height', (string) $image['height'] );
				mj_meta( 'property', 'og:image:alt', $image['alt'] );
			}
			mj_meta( 'property', 'article:published_time', get_post_time( 'c', false, $post ) );
			mj_meta( 'property', 'article:modified_time', get_post_modified_time( 'c', false, $post ) );
			$cat = mj_primary_category( $post );
			mj_meta( 'property', 'article:section', $cat ? $cat->name : '' );
			$tags = get_the_tags( $post->ID );
			foreach ( $tags && ! is_wp_error( $tags ) ? $tags : array() as $tag ) {
				if ( MJ_SPONSORED_TAG !== $tag->slug ) {
					mj_meta( 'property', 'article:tag', $tag->name );
				}
			}
			mj_meta( 'name', 'twitter:card', 'summary_large_image' );
			mj_meta( 'name', 'twitter:title', $title );
			mj_meta( 'name', 'twitter:description', $excerpt );
			if ( $image ) {
				mj_meta( 'name', 'twitter:image', $image['url'] );
			}
			$x = (string) get_theme_mod( 'mj_social_x', '' );
			if ( $x && preg_match( '#(?:x|twitter)\.com/@?([A-Za-z0-9_]+)#', $x, $m ) ) {
				mj_meta( 'name', 'twitter:site', '@' . $m[1] );
			}
		} elseif ( ! mj_yoast_active() && ( is_front_page() || is_home() ) ) {
			mj_meta( 'name', 'description', get_bloginfo( 'description' ) );
		}

		printf(
			'<script type="application/ld+json">%s</script>' . "\n",
			wp_json_encode(
				array(
					'@context' => 'https://schema.org',
					'@graph'   => $graph,
				),
				JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_HEX_TAG
			)
		);
	},
	5
);
