<?php
/**
 * Server-rendered blocks used by the templates. The editor previews them through ServerSideRender
 * (assets/js/editor-blocks.js); titles and attributes are bootstrapped from these registrations.
 *
 * @package marketing-junkies
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

const MJ_HERO_SIZES = '(min-width: 1280px) 868px, (min-width: 960px) calc(100vw - 412px), calc(100vw - 32px)';

add_action(
	'init',
	static function () {
		$blocks = array(
			'date-strip'     => array( __( 'Date strip', 'marketing-junkies' ), 'mj_render_date_strip', array() ),
			'logo'           => array(
				__( 'Logo', 'marketing-junkies' ),
				'mj_render_logo',
				array(
					'variant' => array(
						'type'    => 'string',
						'default' => 'wordmark',
					),
				),
			),
			'ad-slot'        => array(
				__( 'Ad slot', 'marketing-junkies' ),
				'mj_render_ad_slot',
				array(
					'slot'       => array(
						'type'    => 'string',
						'default' => 'mj_slot',
					),
					'size'       => array(
						'type'    => 'string',
						'default' => '300x250',
					),
					'mobileSize' => array(
						'type'    => 'string',
						'default' => '',
					),
					'variant'    => array(
						'type'    => 'string',
						'default' => 'box',
					),
					'device'     => array(
						'type'    => 'string',
						'default' => 'all',
					),
					'sticky'     => array(
						'type'    => 'boolean',
						'default' => false,
					),
				),
			),
			'breadcrumbs'    => array( __( 'Breadcrumbs', 'marketing-junkies' ), 'mj_render_breadcrumbs', array() ),
			'sponsor-banner' => array( __( 'Sponsored banner', 'marketing-junkies' ), 'mj_render_sponsor_banner', array() ),
			'kicker'         => array( __( 'Kicker', 'marketing-junkies' ), 'mj_render_kicker', array() ),
			'byline'         => array( __( 'Byline', 'marketing-junkies' ), 'mj_render_byline', array() ),
			'featured-image' => array( __( 'Featured image (black and white)', 'marketing-junkies' ), 'mj_render_featured_image', array() ),
			'toc'            => array( __( 'In this story', 'marketing-junkies' ), 'mj_render_toc', array() ),
			'author-bio'     => array( __( 'Author box', 'marketing-junkies' ), 'mj_render_author_bio', array() ),
			'latest'         => array(
				__( 'Latest stories', 'marketing-junkies' ),
				'mj_render_latest',
				array(
					'count' => array(
						'type'    => 'number',
						'default' => 4,
					),
				),
			),
			'newsletter'     => array(
				__( 'Newsletter signup', 'marketing-junkies' ),
				'mj_render_newsletter',
				array(
					'heading' => array(
						'type'    => 'string',
						'default' => __( 'Your daily fix, 7 am IST.', 'marketing-junkies' ),
					),
					'text'    => array(
						'type'    => 'string',
						'default' => __( 'One email a day. Marketing, media and martech news in five minutes.', 'marketing-junkies' ),
					),
				),
			),
			'related'        => array( __( 'Related stories', 'marketing-junkies' ), 'mj_render_related', array() ),
			'social-links'   => array( __( 'Follow links', 'marketing-junkies' ), 'mj_render_social_links', array() ),
			'author-header'  => array( __( 'Author page header', 'marketing-junkies' ), 'mj_render_author_header', array() ),
		);
		foreach ( $blocks as $slug => [ $title, $callback, $attributes ] ) {
			register_block_type(
				"mj/{$slug}",
				array(
					'api_version'     => 3,
					'title'           => $title,
					'category'        => 'theme',
					'icon'            => 'layout',
					'attributes'      => $attributes + array(
						'className' => array( 'type' => 'string' ),
					),
					'uses_context'    => array( 'postId', 'postType' ),
					'supports'        => array(
						'html'     => false,
						'reusable' => false,
					),
					'render_callback' => $callback,
				)
			);
		}
	}
);

/** Post the block is rendering for; null in the Site Editor where no post is in context. */
function mj_block_post( $block ): ?WP_Post {
	$id   = $block instanceof WP_Block && ! empty( $block->context['postId'] ) ? (int) $block->context['postId'] : get_the_ID();
	$post = $id ? get_post( $id ) : null;
	return $post && 'post' === $post->post_type ? $post : null;
}

/** Visible label in the editor preview when a block needs a post it does not have. */
function mj_editor_placeholder( string $label ): string {
	return ( defined( 'REST_REQUEST' ) && REST_REQUEST ) ? '<div class="mj-placeholder">' . esc_html( $label ) . '</div>' : '';
}

function mj_render_date_strip(): string {
	return sprintf(
		'<div class="mj-datestrip"><span>%s</span><span>%s</span></div>',
		esc_html( wp_date( 'l j F Y' ) ),
		esc_html__( 'marketing · daily', 'marketing-junkies' )
	);
}

function mj_render_logo( array $attributes ): string {
	if ( 'monogram-dark' === ( $attributes['variant'] ?? '' ) ) {
		return sprintf(
			'<img class="mj-monogram" src="%s" width="56" height="56" alt="%s" loading="lazy" decoding="async">',
			esc_url( mj_logo_url( 'monogram-profile-dark.png' ) ),
			esc_attr( get_bloginfo( 'name' ) )
		);
	}
	return sprintf(
		'<a class="mj-logo" href="%s" aria-label="%s"><img src="%s" width="220" height="87" alt="%s" decoding="async"></a>',
		esc_url( home_url( '/' ) ),
		/* translators: %s: site name */
		esc_attr( sprintf( __( '%s home', 'marketing-junkies' ), get_bloginfo( 'name' ) ) ),
		esc_url( mj_logo_url( 'logo-wordmark.png' ) ),
		esc_attr( get_bloginfo( 'name' ) )
	);
}

/** Fixed-size ad container; the size is reserved in CSS so filling it never shifts the layout. */
function mj_ad_slot_html( array $args ): string {
	$a = wp_parse_args(
		$args,
		array(
			'slot'        => 'mj_slot',
			'size'        => '300x250',
			'mobile_size' => '',
			'variant'     => 'box',
			'device'      => 'all',
			'sticky'      => false,
		)
	);
	$dims  = static fn( string $s ) => array_map( 'intval', explode( 'x', $s ) + array( 1 => '0' ) );
	[ $w, $h ] = $dims( $a['size'] );
	$style     = "--mj-ad-w:{$w}px;--mj-ad-h:{$h}px;";
	$sizes     = array( $a['size'] );
	if ( $a['mobile_size'] ) {
		[ $mw, $mh ] = $dims( $a['mobile_size'] );
		$style      .= "--mj-ad-mw:{$mw}px;--mj-ad-mh:{$mh}px;";
		$sizes[]     = $a['mobile_size'];
	}
	$classes = array( 'mj-ad', 'mj-ad--' . sanitize_html_class( $a['variant'] ) );
	if ( 'desktop' === $a['device'] ) {
		$classes[] = 'mj-only-desktop';
	} elseif ( 'mobile' === $a['device'] ) {
		$classes[] = 'mj-only-mobile';
	}
	if ( $a['sticky'] ) {
		$classes[] = 'mj-ad--sticky';
	}
	// Slot id and size are useful while wiring the ad server; readers only see the label.
	$meta = current_user_can( 'edit_theme_options' )
		? sprintf( '<span class="mj-ad__meta">%s · %s</span>', esc_html( str_replace( 'x', '×', $a['size'] ) ), esc_html( $a['slot'] ) )
		: '';
	return sprintf(
		'<div class="%s"><div class="mj-ad__box" data-ad-slot="%s" data-ad-sizes="%s" style="%s"><span class="mj-ad__label">%s</span>%s</div></div>',
		esc_attr( implode( ' ', $classes ) ),
		esc_attr( $a['slot'] ),
		esc_attr( implode( ',', $sizes ) ),
		esc_attr( $style ),
		esc_html__( 'Advertisement', 'marketing-junkies' ),
		$meta
	);
}

function mj_render_ad_slot( array $attributes ): string {
	if ( ! mj_ads_enabled() ) {
		return '';
	}
	return mj_ad_slot_html(
		array(
			'slot'        => (string) ( $attributes['slot'] ?? '' ),
			'size'        => (string) ( $attributes['size'] ?? '300x250' ),
			'mobile_size' => (string) ( $attributes['mobileSize'] ?? '' ),
			'variant'     => (string) ( $attributes['variant'] ?? 'box' ),
			'device'      => (string) ( $attributes['device'] ?? 'all' ),
			'sticky'      => ! empty( $attributes['sticky'] ),
		)
	);
}

function mj_render_breadcrumbs( array $attributes, string $content, $block ): string {
	$post = mj_block_post( $block );
	if ( ! $post ) {
		return mj_editor_placeholder( __( 'Home / Section', 'marketing-junkies' ) );
	}
	$items = array( sprintf( '<li><a href="%s">%s</a></li>', esc_url( home_url( '/' ) ), esc_html__( 'Home', 'marketing-junkies' ) ) );
	$cat   = mj_primary_category( $post );
	if ( $cat ) {
		$items[] = sprintf( '<li><a href="%s">%s</a></li>', esc_url( get_category_link( $cat ) ), esc_html( $cat->name ) );
	}
	return '<nav class="mj-breadcrumbs" aria-label="' . esc_attr__( 'Breadcrumb', 'marketing-junkies' ) . '"><ol>' . implode( '', $items ) . '</ol></nav>';
}

function mj_render_sponsor_banner( array $attributes, string $content, $block ): string {
	$post = mj_block_post( $block );
	if ( ! $post || ! mj_is_sponsored( $post ) ) {
		return $post ? '' : mj_editor_placeholder( __( 'Sponsored banner (sponsored articles only)', 'marketing-junkies' ) );
	}
	$sponsor = mj_sponsor_name( $post );
	// A name like "Acme Co." already ends the sentence.
	$text = str_ends_with( $sponsor, '.' )
		/* translators: 1: sponsor name ending in a full stop, 2: site name */
		? esc_html__( 'Paid content produced with %1$s The %2$s newsroom was not involved.', 'marketing-junkies' )
		/* translators: 1: sponsor name, 2: site name */
		: esc_html__( 'Paid content produced with %1$s. The %2$s newsroom was not involved.', 'marketing-junkies' );
	return sprintf(
		'<div class="mj-sponsor-banner"><span class="mj-sponsor-banner__label">%s</span><span class="mj-sponsor-banner__text">%s</span><a href="%s">%s</a></div>',
		esc_html__( 'Sponsored', 'marketing-junkies' ),
		sprintf(
			$text,
			'<strong>' . esc_html( $sponsor ) . '</strong>',
			esc_html( get_bloginfo( 'name' ) )
		),
		esc_url( mj_page_url( 'advertise' ) ),
		esc_html__( 'Advertise with us', 'marketing-junkies' )
	);
}

function mj_render_kicker( array $attributes, string $content, $block ): string {
	$post = mj_block_post( $block );
	if ( ! $post ) {
		return mj_editor_placeholder( __( 'Section', 'marketing-junkies' ) );
	}
	$parts = array();
	if ( mj_is_sponsored( $post ) ) {
		$parts[] = __( 'Partner content', 'marketing-junkies' );
	}
	$cat = mj_primary_category( $post );
	if ( $cat ) {
		$parts[] = $cat->name;
	}
	return $parts ? '<p class="mj-kicker">' . esc_html( implode( ' · ', $parts ) ) . '</p>' : '';
}

function mj_avatar_url( int $user_id, int $size ): string {
	return (string) get_avatar_url(
		$user_id,
		array(
			'size'    => $size * 2,
			'default' => mj_logo_url( 'site-icon.png' ),
		)
	);
}

function mj_render_byline( array $attributes, string $content, $block ): string {
	$post = mj_block_post( $block );
	if ( ! $post ) {
		return mj_editor_placeholder( __( 'Byline · date · reading time · share', 'marketing-junkies' ) );
	}
	$author    = (int) $post->post_author;
	$published = (int) get_post_time( 'U', true, $post );
	$modified  = (int) get_post_modified_time( 'U', true, $post );
	$minutes   = mj_reading_minutes( $post );
	/* translators: %d: minutes */
	$read = sprintf( _n( '%d min read', '%d min read', $minutes, 'marketing-junkies' ), $minutes );

	$updated = '';
	if ( $modified - $published > 10 * MINUTE_IN_SECONDS ) {
		$same_day = wp_date( 'Ymd', $modified ) === wp_date( 'Ymd', $published );
		$updated  = sprintf(
			'<span class="mj-only-desktop"> · %s <time datetime="%s">%s</time></span>',
			esc_html__( 'Updated', 'marketing-junkies' ),
			esc_attr( wp_date( 'c', $modified ) ),
			esc_html( wp_date( $same_day ? 'H:i' : 'j M Y, H:i', $modified ) )
		);
	}

	return sprintf(
		'<div class="mj-byline">
			<img class="mj-avatar" src="%1$s" width="40" height="40" alt="" loading="lazy" decoding="async">
			<div class="mj-byline__who">
				<div class="mj-byline__name"><a href="%2$s">%3$s</a></div>
				<div class="mj-byline__time"><time datetime="%4$s"><span class="mj-only-desktop">%5$s</span><span class="mj-only-mobile">%6$s</span></time>%7$s<span class="mj-only-mobile"> · %8$s</span></div>
			</div>
			<div class="mj-byline__tools">
				<span class="mj-only-desktop">%8$s</span><span class="mj-only-desktop" aria-hidden="true">·</span>
				<button type="button" class="mj-linkbtn" data-mj-share data-url="%9$s" data-title="%10$s">%11$s</button>
				<button type="button" class="mj-linkbtn mj-only-desktop" data-mj-copy data-url="%9$s">%12$s</button>
			</div>
		</div>',
		esc_url( mj_avatar_url( $author, 40 ) ),
		esc_url( get_author_posts_url( $author ) ),
		esc_html( get_the_author_meta( 'display_name', $author ) ),
		esc_attr( wp_date( 'c', $published ) ),
		esc_html( mj_format_datetime( $published ) ),
		esc_html( wp_date( 'j M Y', $published ) ),
		$updated,
		esc_html( $read ),
		esc_url( get_permalink( $post ) ),
		esc_attr( get_the_title( $post ) ),
		esc_html__( 'Share', 'marketing-junkies' ),
		esc_html__( 'Copy link', 'marketing-junkies' )
	);
}

function mj_render_featured_image( array $attributes, string $content, $block ): string {
	$post = mj_block_post( $block );
	if ( ! $post || ! has_post_thumbnail( $post ) ) {
		return $post ? '' : mj_editor_placeholder( __( 'Featured image · 1200×630 · black and white', 'marketing-junkies' ) );
	}
	$id  = get_post_thumbnail_id( $post );
	$img = wp_get_attachment_image(
		$id,
		'full',
		false,
		array(
			'class'         => 'mj-hero__img grayscale',
			'loading'       => 'eager',
			'fetchpriority' => 'high',
			'decoding'      => 'async',
			'sizes'         => MJ_HERO_SIZES,
		)
	);
	$caption = wp_get_attachment_caption( $id );
	return '<figure class="mj-hero">' . $img . ( $caption ? '<figcaption>' . wp_kses_post( $caption ) . '</figcaption>' : '' ) . '</figure>';
}

function mj_render_toc( array $attributes, string $content, $block ): string {
	$post = mj_block_post( $block );
	if ( ! $post ) {
		return mj_editor_placeholder( __( 'In this story (built from the article’s h2 headings)', 'marketing-junkies' ) );
	}
	$parts = mj_article_parts( $post );
	if ( count( $parts['toc'] ) + ( $parts['faq'] ? 1 : 0 ) < 2 ) {
		return '';
	}
	return mj_toc_html( $parts['toc'], (bool) $parts['faq'], 'desktop' );
}

function mj_default_author_bio(): string {
	/* translators: %s: site name */
	return sprintf( __( '%s covers agency moves, campaigns, martech and adtech launches with an Indian and global lens. Every story is written from a named source and links back to it.', 'marketing-junkies' ), get_bloginfo( 'name' ) );
}

function mj_render_author_bio( array $attributes, string $content, $block ): string {
	$post = mj_block_post( $block );
	if ( ! $post ) {
		return mj_editor_placeholder( __( 'Author box', 'marketing-junkies' ) );
	}
	$author = (int) $post->post_author;
	$bio    = trim( (string) get_the_author_meta( 'description', $author ) );
	return sprintf(
		'<section class="mj-author" aria-label="%1$s">
			<img class="mj-avatar mj-avatar--lg" src="%2$s" width="72" height="72" alt="" loading="lazy" decoding="async">
			<div>
				<div class="mj-label mj-author__eyebrow">%3$s</div>
				<div class="mj-author__name">%4$s</div>
				<p class="mj-author__bio">%5$s</p>
				<div class="mj-author__links"><a href="%6$s">%7$s</a><a href="%8$s">%9$s</a><a href="%10$s">%11$s</a></div>
			</div>
		</section>',
		esc_attr__( 'About the author', 'marketing-junkies' ),
		esc_url( mj_avatar_url( $author, 72 ) ),
		esc_html__( 'Written by', 'marketing-junkies' ),
		esc_html( get_the_author_meta( 'display_name', $author ) ),
		esc_html( '' !== $bio ? $bio : mj_default_author_bio() ),
		esc_url( mj_page_url( 'editorial-policy' ) ),
		esc_html__( 'Editorial policy', 'marketing-junkies' ),
		esc_url( mj_page_url( 'corrections' ) ),
		esc_html__( 'Corrections', 'marketing-junkies' ),
		esc_url( get_author_posts_url( $author ) ),
		esc_html__( 'All stories', 'marketing-junkies' )
	);
}

function mj_render_latest( array $attributes, string $content, $block ): string {
	$current = mj_block_post( $block );
	$posts   = get_posts(
		array(
			'numberposts'      => max( 1, (int) ( $attributes['count'] ?? 4 ) ),
			'post__not_in'     => $current ? array( $current->ID ) : array(),
			'suppress_filters' => false,
			'no_found_rows'    => true,
		)
	);
	if ( ! $posts ) {
		return '';
	}
	$items = '';
	foreach ( $posts as $i => $p ) {
		$items .= sprintf(
			'<li><span class="mj-latest__n">%02d</span><a href="%s">%s</a></li>',
			$i + 1,
			esc_url( get_permalink( $p ) ),
			esc_html( get_the_title( $p ) )
		);
	}
	return '<section class="mj-latest" aria-labelledby="mj-latest-title"><h2 class="mj-label" id="mj-latest-title">' . esc_html__( 'Latest', 'marketing-junkies' ) . '</h2><ol>' . $items . '</ol></section>';
}

function mj_render_newsletter( array $attributes ): string {
	$action = (string) get_theme_mod( 'mj_newsletter_action', '' );
	$field  = (string) get_theme_mod( 'mj_newsletter_field', 'email' );
	$ready  = '' !== $action;

	$form = sprintf(
		'<form class="mj-newsletter__form" action="%1$s" method="post" target="_blank" rel="noopener">
			<label for="mj-nl-email">%2$s</label>
			<input id="mj-nl-email" type="email" name="%3$s" placeholder="you@agency.com" autocomplete="email" required%4$s>
			<button type="submit" class="mj-btn mj-btn--primary mj-btn--block"%4$s>%5$s</button>
		</form>',
		esc_url( $ready ? $action : home_url( '/' ) ),
		esc_html__( 'Email', 'marketing-junkies' ),
		esc_attr( $field ? $field : 'email' ),
		$ready ? '' : ' disabled',
		$ready ? esc_html__( 'Subscribe free', 'marketing-junkies' ) : esc_html__( 'Coming soon', 'marketing-junkies' )
	);
	if ( ! $ready && current_user_can( 'edit_theme_options' ) ) {
		$form .= '<p class="mj-newsletter__hint">' . esc_html__( 'Admins only: set the signup URL under Appearance › Customize › Marketing Junkies.', 'marketing-junkies' ) . '</p>';
	}

	$sponsor = mj_ads_enabled()
		? '<div class="mj-newsletter__sponsor" data-ad-slot="mj_newsletter_sponsor" data-ad-sizes="88x24"><span>' . esc_html__( 'Presented by', 'marketing-junkies' ) . '</span><span class="mj-newsletter__sponsor-logo"></span></div>'
		: '';

	return sprintf(
		'<section class="mj-newsletter" id="newsletter" aria-labelledby="mj-nl-title">
			<img class="mj-newsletter__mark" src="%1$s" width="44" height="44" alt="" loading="lazy" decoding="async">
			<h2 id="mj-nl-title">%2$s</h2>
			<p class="mj-newsletter__text">%3$s</p>
			%4$s%5$s
		</section>',
		esc_url( mj_logo_url( 'monogram-profile-dark.png' ) ),
		esc_html( (string) ( $attributes['heading'] ?? '' ) ),
		esc_html( (string) ( $attributes['text'] ?? '' ) ),
		$form,
		$sponsor
	);
}

function mj_related_card( WP_Post $p, bool $sponsored ): string {
	$media = has_post_thumbnail( $p )
		? get_the_post_thumbnail(
			$p,
			'mj-card',
			array(
				'class'   => 'grayscale',
				'loading' => 'lazy',
				'sizes'   => '(min-width: 960px) 300px, (min-width: 600px) 50vw, 100vw',
				'alt'     => '',
			)
		)
		: '';
	if ( $sponsored ) {
		/* translators: %s: sponsor name */
		$kicker = sprintf( __( 'Sponsored · %s', 'marketing-junkies' ), mj_sponsor_name( $p ) );
		$meta   = __( 'Partner content', 'marketing-junkies' );
	} else {
		$cat     = mj_primary_category( $p );
		$kicker  = $cat ? $cat->name : '';
		$minutes = mj_reading_minutes( $p );
		/* translators: 1: date, 2: minutes */
		$meta = sprintf( __( '%1$s · %2$d min', 'marketing-junkies' ), get_the_date( 'j M', $p ), $minutes );
	}
	return sprintf(
		'<a class="mj-card%s" href="%s"><span class="mj-card__media">%s</span><span class="mj-card__kicker">%s</span><span class="mj-card__title">%s</span><span class="mj-card__meta">%s</span></a>',
		$sponsored ? ' mj-card--sponsored' : '',
		esc_url( get_permalink( $p ) ),
		$media,
		esc_html( $kicker ),
		esc_html( get_the_title( $p ) ),
		esc_html( $meta )
	);
}

function mj_render_related( array $attributes, string $content, $block ): string {
	$post = mj_block_post( $block );
	if ( ! $post ) {
		return mj_editor_placeholder( __( 'Related stories (with the in-feed sponsored card)', 'marketing-junkies' ) );
	}
	$sponsored_tag = get_term_by( 'slug', MJ_SPONSORED_TAG, 'post_tag' );
	$exclude       = array( $post->ID );
	$base          = array(
		'post__not_in'     => $exclude,
		'suppress_filters' => false,
		'no_found_rows'    => true,
		'tag__not_in'      => $sponsored_tag ? array( $sponsored_tag->term_id ) : array(),
	);

	$sponsored_post = null;
	if ( mj_ads_enabled() && $sponsored_tag ) {
		$found          = get_posts(
			array(
				'numberposts'      => 1,
				'tag_id'           => $sponsored_tag->term_id,
				'post__not_in'     => $exclude,
				'suppress_filters' => false,
				'no_found_rows'    => true,
			)
		);
		$sponsored_post = $found ? $found[0] : null;
	}
	$want = $sponsored_post ? 3 : 4;

	$tag_ids = array_values(
		array_diff(
			wp_get_post_tags( $post->ID, array( 'fields' => 'ids' ) ),
			$sponsored_tag ? array( $sponsored_tag->term_id ) : array()
		)
	);
	$related = $tag_ids ? get_posts( $base + array( 'numberposts' => $want, 'tag__in' => $tag_ids ) ) : array();
	if ( count( $related ) < $want ) {
		$cat     = mj_primary_category( $post );
		$fill    = get_posts(
			array_merge(
				$base,
				array(
					'numberposts'  => $want - count( $related ),
					'post__not_in' => array_merge( $exclude, wp_list_pluck( $related, 'ID' ) ),
					'cat'          => $cat ? $cat->term_id : 0,
				)
			)
		);
		$related = array_merge( $related, $fill );
	}
	if ( ! $related && ! $sponsored_post ) {
		return '';
	}

	$cards = array_map( static fn( $p ) => mj_related_card( $p, false ), $related );
	if ( $sponsored_post ) {
		array_splice( $cards, min( 2, count( $cards ) ), 0, array( mj_related_card( $sponsored_post, true ) ) );
	}
	$cat  = mj_primary_category( $post );
	$more = $cat ? sprintf(
		'<a href="%s">%s</a>',
		esc_url( get_category_link( $cat ) ),
		/* translators: %s: section name */
		esc_html( sprintf( __( 'More %s', 'marketing-junkies' ), mb_strtolower( $cat->name ) ) )
	) : '';

	return '<section class="mj-related" aria-labelledby="mj-related-title"><div class="mj-related__head"><h2 class="mj-label" id="mj-related-title">'
		. esc_html__( 'Related', 'marketing-junkies' ) . '</h2>' . $more . '</div><div class="mj-related__grid">' . implode( '', $cards ) . '</div></section>';
}

/** Author archive header: name, bio, profile links (sameAs) and the policies behind every story. */
function mj_render_author_header(): string {
	$user = get_queried_object();
	if ( ! $user instanceof WP_User ) {
		return mj_editor_placeholder( __( 'Author name, bio and profile links', 'marketing-junkies' ) );
	}
	$bio      = trim( (string) get_the_author_meta( 'description', $user->ID ) );
	$profiles = '';
	foreach ( mj_author_same_as( $user->ID ) as $url ) {
		$host      = (string) wp_parse_url( $url, PHP_URL_HOST );
		$profiles .= sprintf( '<a href="%s" rel="me noopener">%s</a>', esc_url( $url ), esc_html( preg_replace( '/^www\./', '', $host ) ) );
	}
	return sprintf(
		'<header class="mj-author mj-author--page">
			<img class="mj-avatar mj-avatar--lg" src="%1$s" width="72" height="72" alt="">
			<div>
				<div class="mj-label mj-author__eyebrow">%2$s</div>
				<h1 class="mj-author__name">%3$s</h1>
				<p class="mj-author__bio">%4$s</p>
				<div class="mj-author__links">%5$s<a href="%6$s">%7$s</a><a href="%8$s">%9$s</a></div>
			</div>
		</header>',
		esc_url( mj_avatar_url( $user->ID, 72 ) ),
		esc_html__( 'Author', 'marketing-junkies' ),
		esc_html( $user->display_name ),
		esc_html( '' !== $bio ? $bio : mj_default_author_bio() ),
		$profiles,
		esc_url( mj_page_url( 'editorial-policy' ) ),
		esc_html__( 'Editorial policy', 'marketing-junkies' ),
		esc_url( mj_page_url( 'corrections' ) ),
		esc_html__( 'Corrections', 'marketing-junkies' )
	);
}

function mj_render_social_links(): string {
	$links = '';
	foreach ( mj_social_links() as [ $label, $url ] ) {
		$links .= sprintf( '<a href="%s" rel="me noopener">%s</a>', esc_url( $url ), esc_html( $label ) );
	}
	$links .= sprintf( '<a href="%s">%s</a>', esc_url( get_feed_link() ), esc_html__( 'RSS', 'marketing-junkies' ) );
	return '<div class="mj-footer__col"><strong class="mj-label">' . esc_html__( 'Follow', 'marketing-junkies' ) . '</strong>' . $links . '</div>';
}
