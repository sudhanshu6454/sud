<?php
/**
 * Article body transforms.
 *
 * autopub publishes plain HTML: an optional leading <ul> of key takeaways, <h2> sections, a closing
 * "Source:" paragraph and an optional <section class="faq"> of <details>. On the article page this
 * turns them into the design's Key takeaways box, anchored sections for the TOC, the in-article ad,
 * the source line, the tag row and the FAQ, in that order. Feeds and excerpts get the untouched HTML.
 *
 * @package marketing-junkies
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

const MJ_ARTICLE_MARKER = '<!--mj-article-->';

/**
 * @return array{html:string,toc:array<int,array{id:string,text:string}>,faq:array<int,array{q:string,a:string}>,takeaways:bool}
 */
function mj_transform_article( string $html, WP_Post $post, bool $for_display ): array {
	$result = array(
		'html'      => $html,
		'toc'       => array(),
		'faq'       => array(),
		'takeaways' => false,
	);
	if ( '' === trim( $html ) ) {
		return $result;
	}

	$doc  = new DOMDocument();
	$prev = libxml_use_internal_errors( true );
	$doc->loadHTML( '<?xml encoding="utf-8"?><div>' . $html . '</div>', LIBXML_HTML_NOIMPLIED | LIBXML_HTML_NODEFDTD );
	libxml_clear_errors();
	libxml_use_internal_errors( $prev );
	$root = $doc->getElementsByTagName( 'div' )->item( 0 );
	if ( ! $root ) {
		return $result;
	}
	$xp = new DOMXPath( $doc );

	// Key takeaways: only a list that opens the article, so a mid-article list is never moved.
	$first     = mj_first_element_child( $root );
	$takeaways = null;
	if ( $first && 'ul' === strtolower( $first->nodeName ) ) {
		$takeaways = $doc->createElement( 'section' );
		$takeaways->setAttribute( 'class', 'mj-takeaways' );
		$takeaways->setAttribute( 'aria-labelledby', 'mj-takeaways-title' );
		$title = $doc->createElement( 'h2' );
		$title->setAttribute( 'id', 'mj-takeaways-title' );
		$title->setAttribute( 'class', 'mj-label' );
		$title->appendChild( $doc->createTextNode( __( 'Key takeaways', 'marketing-junkies' ) ) );
		$root->replaceChild( $takeaways, $first );
		$takeaways->appendChild( $title );
		$takeaways->appendChild( $first );
		$result['takeaways'] = true;
	}

	// FAQ: lifted out (re-appended last) so its heading stays out of the section list.
	$faq  = $xp->query( './/section[contains(concat(" ", normalize-space(@class), " "), " faq ")]', $root )->item( 0 );
	$used = array( 'mj-takeaways-title' => true );
	if ( $faq ) {
		$i = 0;
		foreach ( $xp->query( './/details', $faq ) as $details ) {
			$summary = $xp->query( './summary', $details )->item( 0 );
			if ( ! $summary ) {
				continue;
			}
			$answer = '';
			foreach ( $details->childNodes as $child ) {
				if ( $child !== $summary ) {
					$answer .= ' ' . $child->textContent;
				}
			}
			$q = mj_squash( $summary->textContent );
			$a = mj_squash( $answer );
			if ( '' !== $q && '' !== $a ) {
				$result['faq'][] = array(
					'q' => $q,
					'a' => $a,
				);
			}
			if ( 0 === $i++ ) {
				$details->setAttribute( 'open', '' );
			}
		}
		mj_add_class( $faq, 'mj-faq' );
		$faq->setAttribute( 'id', 'faq' );
		$used['faq'] = true;
		foreach ( $xp->query( './h2', $faq ) as $h ) {
			mj_add_class( $h, 'mj-label' );
		}
		$faq->parentNode->removeChild( $faq );
	}

	$sections = array();
	foreach ( iterator_to_array( $xp->query( './/h2', $root ) ) as $h ) {
		if ( $takeaways && mj_is_inside( $h, $takeaways ) ) {
			continue;
		}
		$text = mj_squash( $h->textContent );
		if ( '' === $text ) {
			continue;
		}
		$base = $h->getAttribute( 'id' ) ? $h->getAttribute( 'id' ) : sanitize_title( $text );
		$base = '' !== $base ? $base : 'section';
		$id   = $base;
		for ( $n = 2; isset( $used[ $id ] ); $n++ ) {
			$id = "{$base}-{$n}";
		}
		$used[ $id ] = true;
		$h->setAttribute( 'id', $id );
		$result['toc'][] = array(
			'id'   => $id,
			'text' => $text,
		);
		$sections[]      = $h;
	}

	if ( ! $for_display ) {
		return $result;
	}

	// In-article ad: between the second and third sections, as in the design.
	if ( mj_ads_enabled() ) {
		$ad     = mj_dom_fragment( $doc, mj_ad_slot_html( array( 'slot' => 'mj_inarticle_1', 'size' => '336x280', 'mobile_size' => '300x250', 'variant' => 'inarticle' ) ) );
		$anchor = null;
		if ( count( $sections ) >= 3 ) {
			$anchor = $sections[2];
		} else {
			$paras = iterator_to_array( $xp->query( './p', $root ) );
			if ( count( $paras ) >= 4 ) {
				$anchor = $paras[ intdiv( count( $paras ), 2 ) ];
			}
		}
		if ( $anchor ) {
			$anchor->parentNode->insertBefore( $ad, $anchor );
		}
	}

	$source = null;
	foreach ( iterator_to_array( $xp->query( './p', $root ) ) as $p ) {
		if ( 0 === stripos( mj_squash( $p->textContent ), 'source:' ) ) {
			$source = $p;
		}
	}
	if ( $source ) {
		mj_add_class( $source, 'mj-source' );
		$note = $doc->createElement( 'span' );
		$note->setAttribute( 'class', 'mj-source__note' );
		$note->appendChild( $doc->createTextNode( ' ' . __( 'This article is original coverage written from that report.', 'marketing-junkies' ) ) );
		$source->appendChild( $note );
	}

	if ( mj_is_sponsored( $post ) ) {
		$home = wp_parse_url( home_url(), PHP_URL_HOST );
		foreach ( $xp->query( './/a[@href]', $root ) as $a ) {
			$host = wp_parse_url( $a->getAttribute( 'href' ), PHP_URL_HOST );
			if ( $host && $host !== $home ) {
				$rel = preg_split( '/\s+/', trim( $a->getAttribute( 'rel' ) ), -1, PREG_SPLIT_NO_EMPTY );
				$a->setAttribute( 'rel', implode( ' ', array_unique( array_merge( $rel, array( 'sponsored', 'noopener' ) ) ) ) );
			}
		}
	}

	$tags_html = mj_tags_html( $post );
	if ( '' !== $tags_html ) {
		$tags = mj_dom_fragment( $doc, $tags_html );
		if ( $source && $source->parentNode === $root ) {
			$root->insertBefore( $tags, $source->nextSibling );
		} else {
			$root->appendChild( $tags );
		}
	}

	$toc_count = count( $result['toc'] ) + ( $faq ? 1 : 0 );
	if ( $toc_count >= 2 ) {
		$mobile = mj_dom_fragment( $doc, mj_toc_html( $result['toc'], (bool) $faq, 'mobile' ) );
		$before = $takeaways ? $takeaways->nextSibling : $root->firstChild;
		$root->insertBefore( $mobile, $before );
	}

	if ( $faq ) {
		$root->appendChild( $faq );
	}

	$out = '';
	foreach ( $root->childNodes as $child ) {
		$out .= $doc->saveHTML( $child );
	}
	$result['html'] = MJ_ARTICLE_MARKER . $out;
	return $result;
}

/** TOC, FAQ and takeaway data for the current article, computed once per request. */
function mj_article_parts( $post = null ): array {
	static $cache = array();
	$post = get_post( $post );
	if ( ! $post ) {
		return array(
			'html'      => '',
			'toc'       => array(),
			'faq'       => array(),
			'takeaways' => false,
		);
	}
	if ( ! isset( $cache[ $post->ID ] ) ) {
		$raw                = $post->post_content;
		$html               = has_blocks( $raw ) ? do_blocks( $raw ) : wpautop( $raw );
		$cache[ $post->ID ] = mj_transform_article( $html, $post, false );
	}
	return $cache[ $post->ID ];
}

add_filter(
	'the_content',
	static function ( $content ) {
		if ( is_feed() || ! is_singular( 'post' ) || doing_filter( 'get_the_excerpt' ) || str_contains( (string) $content, MJ_ARTICLE_MARKER ) ) {
			return $content;
		}
		$post = get_post();
		if ( ! $post || get_queried_object_id() !== $post->ID ) {
			return $content;
		}
		return mj_transform_article( (string) $content, $post, true )['html'];
	},
	20
);

function mj_tags_html( WP_Post $post ): string {
	$tags = get_the_tags( $post->ID );
	if ( ! $tags || is_wp_error( $tags ) ) {
		return '';
	}
	$out = '';
	foreach ( $tags as $tag ) {
		if ( MJ_SPONSORED_TAG === $tag->slug ) {
			continue;
		}
		$out .= sprintf( '<a class="mj-tag" href="%s" rel="tag">%s</a>', esc_url( get_tag_link( $tag ) ), esc_html( $tag->name ) );
	}
	return '' === $out ? '' : '<div class="mj-tags">' . $out . '</div>';
}

/** "In this story" list: `desktop` is the sticky aside, `mobile` the collapsible version inside the body. */
function mj_toc_html( array $items, bool $has_faq, string $variant ): string {
	$lis = '';
	foreach ( $items as $item ) {
		$lis .= sprintf( '<li><a href="#%s">%s</a></li>', esc_attr( $item['id'] ), esc_html( $item['text'] ) );
	}
	if ( $has_faq ) {
		$lis .= sprintf( '<li><a href="#faq">%s</a></li>', esc_html__( 'FAQ', 'marketing-junkies' ) );
	}
	$label = esc_html__( 'In this story', 'marketing-junkies' );
	if ( 'mobile' === $variant ) {
		return '<details class="mj-toc-mobile"><summary>' . $label . '</summary><ol class="mj-toc__list">' . $lis . '</ol></details>';
	}
	return '<nav class="mj-toc" aria-label="' . $label . '"><div class="mj-label mj-toc__title">' . $label . '</div><ol class="mj-toc__list">' . $lis . '</ol></nav>';
}

function mj_dom_fragment( DOMDocument $doc, string $html ): DOMDocumentFragment {
	$tmp  = new DOMDocument();
	$prev = libxml_use_internal_errors( true );
	$tmp->loadHTML( '<?xml encoding="utf-8"?><div>' . $html . '</div>', LIBXML_HTML_NOIMPLIED | LIBXML_HTML_NODEFDTD );
	libxml_clear_errors();
	libxml_use_internal_errors( $prev );
	$frag = $doc->createDocumentFragment();
	$wrap = $tmp->getElementsByTagName( 'div' )->item( 0 );
	if ( $wrap ) {
		foreach ( iterator_to_array( $wrap->childNodes ) as $child ) {
			$frag->appendChild( $doc->importNode( $child, true ) );
		}
	}
	return $frag;
}

function mj_first_element_child( DOMNode $node ): ?DOMElement {
	foreach ( $node->childNodes as $child ) {
		if ( $child instanceof DOMElement ) {
			return $child;
		}
	}
	return null;
}

function mj_is_inside( DOMNode $node, DOMNode $ancestor ): bool {
	for ( $n = $node->parentNode; $n; $n = $n->parentNode ) {
		if ( $n === $ancestor ) {
			return true;
		}
	}
	return false;
}

function mj_add_class( DOMElement $el, string $class ): void {
	$classes = preg_split( '/\s+/', trim( $el->getAttribute( 'class' ) ), -1, PREG_SPLIT_NO_EMPTY );
	if ( ! in_array( $class, $classes, true ) ) {
		$classes[] = $class;
	}
	$el->setAttribute( 'class', implode( ' ', $classes ) );
}

function mj_squash( string $text ): string {
	return trim( preg_replace( '/\s+/u', ' ', $text ) );
}
