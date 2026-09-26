<?php
/**
 * Crawler-facing routes: /ads.txt, /llms.txt, /news-sitemap.xml, robots.txt rules and full-text RSS.
 *
 * @package marketing-junkies
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

const MJ_ROUTES = array(
	'ads.txt'          => 'ads',
	'llms.txt'         => 'llms',
	'news-sitemap.xml' => 'news-sitemap',
);

/** Crawlers that feed AI answer engines; robots.txt names every one of them explicitly. */
const MJ_AI_CRAWLERS = array( 'GPTBot', 'OAI-SearchBot', 'ChatGPT-User', 'ClaudeBot', 'Claude-SearchBot', 'Claude-User', 'PerplexityBot', 'Perplexity-User', 'Google-Extended', 'Applebot-Extended', 'CCBot' );

function mj_register_routes(): void {
	foreach ( MJ_ROUTES as $path => $route ) {
		add_rewrite_rule( '^' . preg_quote( $path, '/' ) . '$', 'index.php?mj_route=' . $route, 'top' );
	}
}
add_action( 'init', 'mj_register_routes' );

add_filter(
	'query_vars',
	static function ( array $vars ): array {
		$vars[] = 'mj_route';
		return $vars;
	}
);

add_filter(
	'redirect_canonical',
	static fn( $redirect ) => get_query_var( 'mj_route' ) ? false : $redirect
);

add_action(
	'template_redirect',
	static function () {
		$route = get_query_var( 'mj_route' );
		if ( ! $route ) {
			return;
		}
		switch ( $route ) {
			case 'ads':
				$body = trim( (string) get_theme_mod( 'mj_ads_txt', '' ) );
				if ( '' === $body ) {
					status_header( 404 );
					nocache_headers();
					header( 'Content-Type: text/plain; charset=utf-8' );
					exit;
				}
				mj_send( 'text/plain', $body . "\n" );
				break;
			case 'llms':
				mj_send( 'text/plain', mj_llms_txt() );
				break;
			case 'news-sitemap':
				mj_send( 'application/xml', mj_news_sitemap() );
				break;
		}
	},
	0
);

function mj_send( string $type, string $body ): void {
	status_header( 200 );
	header( "Content-Type: {$type}; charset=utf-8" );
	header( 'X-Robots-Tag: noindex, follow' );
	header( 'Cache-Control: public, max-age=900' );
	echo $body; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- escaped by the builders.
	exit;
}

/** Google News sitemap: posts from the last 48 hours, never sponsored ones. */
function mj_news_sitemap(): string {
	$sponsored = get_term_by( 'slug', MJ_SPONSORED_TAG, 'post_tag' );
	$posts     = get_posts(
		array(
			'numberposts'      => 1000,
			'date_query'       => array( array( 'after' => '48 hours ago' ) ),
			'tag__not_in'      => $sponsored ? array( $sponsored->term_id ) : array(),
			'suppress_filters' => false,
			'no_found_rows'    => true,
		)
	);
	$name = esc_xml( get_bloginfo( 'name' ) );
	$lang = esc_xml( strtolower( strtok( get_bloginfo( 'language' ), '-' ) ) );
	$out  = '<?xml version="1.0" encoding="UTF-8"?>' . "\n"
		. '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:news="http://www.google.com/schemas/sitemap-news/0.9">' . "\n";
	foreach ( $posts as $p ) {
		if ( 'single-sponsored' === get_page_template_slug( $p ) ) {
			continue;
		}
		$out .= sprintf(
			"<url><loc>%s</loc><news:news><news:publication><news:name>%s</news:name><news:language>%s</news:language></news:publication><news:publication_date>%s</news:publication_date><news:title>%s</news:title></news:news></url>\n",
			esc_xml( get_permalink( $p ) ),
			$name,
			$lang,
			esc_xml( get_post_time( 'c', false, $p ) ),
			esc_xml( wp_strip_all_tags( get_the_title( $p ) ) )
		);
	}
	return $out . '</urlset>' . "\n";
}

function mj_llms_txt(): string {
	$line  = static fn( string $title, string $url, string $note = '' ) => '- [' . wp_strip_all_tags( $title ) . '](' . esc_url_raw( $url ) . ')' . ( '' !== $note ? ': ' . $note : '' ) . "\n";
	$lines = '# ' . get_bloginfo( 'name' ) . "\n\n> " . get_bloginfo( 'description' ) . "\n\n"
		. __( 'Original marketing, media and martech news. Every article is written from a named source, links to it in its final paragraph and opens with key takeaways.', 'marketing-junkies' ) . "\n\n";

	$lines .= "## Sections\n";
	foreach ( get_categories( array( 'hide_empty' => true ) ) as $cat ) {
		$lines .= $line( $cat->name, get_category_link( $cat ), wp_strip_all_tags( $cat->description ) );
	}

	$policy = '';
	foreach ( array(
		'about'            => __( 'About', 'marketing-junkies' ),
		'editorial-policy' => __( 'Editorial policy', 'marketing-junkies' ),
		'corrections'      => __( 'Corrections', 'marketing-junkies' ),
		'advertise'        => __( 'Advertise', 'marketing-junkies' ),
		'contact'          => __( 'Contact', 'marketing-junkies' ),
	) as $slug => $label ) {
		$page = get_page_by_path( $slug );
		if ( $page && 'publish' === $page->post_status ) {
			$policy .= $line( $label, get_permalink( $page ) );
		}
	}
	if ( '' !== $policy ) {
		$lines .= "\n## Policies\n" . $policy;
	}

	$lines .= "\n## Feeds\n" . $line( 'RSS (full text)', get_feed_link() ) . $line( 'Google News sitemap', home_url( '/news-sitemap.xml' ) );

	$lines .= "\n## Latest\n";
	foreach ( get_posts( array( 'numberposts' => 20, 'suppress_filters' => false, 'no_found_rows' => true ) ) as $p ) {
		$lines .= $line( get_the_title( $p ), get_permalink( $p ), wp_strip_all_tags( get_the_excerpt( $p ) ) );
	}
	return $lines;
}

add_filter(
	'robots_txt',
	static function ( string $output, $is_public ): string {
		if ( ! $is_public ) {
			return $output;
		}
		$allow   = 'block' !== get_theme_mod( 'mj_ai_crawlers', 'allow' );
		$output .= "\n# AI crawlers: " . ( $allow ? 'allowed, so answers can cite us' : 'blocked' ) . "\n";
		foreach ( MJ_AI_CRAWLERS as $bot ) {
			$output .= "User-agent: {$bot}\n" . ( $allow ? "Allow: /\nDisallow: /wp-admin/\n" : "Disallow: /\n" ) . "\n";
		}
		$output .= 'Sitemap: ' . home_url( '/news-sitemap.xml' ) . "\n";
		if ( ! mj_yoast_active() && ! str_contains( $output, 'wp-sitemap.xml' ) ) {
			$output .= 'Sitemap: ' . home_url( '/wp-sitemap.xml' ) . "\n";
		}
		return $output;
	},
	20,
	2
);

// Full-content RSS regardless of the Reading setting.
add_filter( 'pre_option_rss_use_excerpt', static fn() => '0' );
