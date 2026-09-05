<?php
/**
 * Breakdown article (screen 1d): label+kicker, h1, standfirst, byline, 21:9 figure,
 * 240/740/1fr grid (TOC/body/popular+sponsor), tags, author, related.
 *
 * @package marketing-mentalist
 */

get_header();
the_post();
$mm_post    = get_post();
$mm_cats    = get_the_category( $mm_post );
$mm_content = apply_filters( 'the_content', $mm_post->post_content );
$mm_toc     = array();
$mm_content = preg_replace_callback( '#<h2([^>]*)>(.*?)</h2>#is', function ( $m ) use ( &$mm_toc ) {
	if ( preg_match( '/\bid=/', $m[1] ) ) {
		return $m[0];
	}
	$title = trim( wp_strip_all_tags( $m[2] ) );
	$id = sanitize_title( $title ) ?: 'section-' . ( count( $mm_toc ) + 1 );
	$mm_toc[] = array( 'id' => $id, 'label' => $title );
	return sprintf( '<h2%s id="%s">%s</h2>', $m[1], esc_attr( $id ), $m[2] );
}, $mm_content );
$mm_updated = get_the_modified_time( 'U' ) - get_the_time( 'U' ) > HOUR_IN_SECONDS;
?>
<script>window.mmPageView = { event: 'article_view', params: { title: <?php echo wp_json_encode( get_the_title() ); ?> } };</script>
<article itemscope itemtype="https://schema.org/NewsArticle">
	<div style="height:3px;background:var(--mm-bone)"><div id="mm-progress-fill" style="width:0;height:100%;background:var(--mm-signal)"></div></div>

	<header style="padding:56px var(--gutter) 40px;max-width:1000px;display:flex;flex-direction:column;gap:24px">
		<?php mm_breadcrumb( array_filter( array( array( home_url( '/' ), 'Home' ), array( get_post_type_archive_link( 'mm_breakdown' ), 'Breakdowns' ), $mm_cats ? array( get_category_link( $mm_cats[0] ), $mm_cats[0]->name ) : null ) ) ); ?>
		<div style="display:flex;align-items:center;gap:14px">
			<span class="mm-label">Breakdown</span>
			<span class="mm-kicker"><?php echo esc_html( $mm_cats ? $mm_cats[0]->name : '' ); ?></span>
		</div>
		<h1 class="mm-h1-breakdown" itemprop="headline"><?php the_title(); ?></h1>
		<?php if ( mm_standfirst() ) : ?>
			<p class="mm-standfirst" style="font-size:24px;max-width:800px" itemprop="description"><?php echo esc_html( mm_standfirst() ); ?></p>
		<?php endif; ?>
		<div style="display:flex;align-items:center;gap:20px;padding:16px 0;border-top:var(--rule);border-bottom:var(--hair);font:400 13px/1.3 var(--font-display);flex-wrap:wrap">
			<span class="mm-avatar" aria-hidden="true" style="width:44px;height:44px;flex:none"><?php echo get_avatar( get_the_author_meta( 'ID' ), 88, '', '', array( 'class' => 'grayscale', 'style' => 'width:100%;height:100%' ) ); ?></span>
			<div style="display:flex;flex-direction:column;gap:3px" itemprop="author" itemscope itemtype="https://schema.org/Person">
				<a href="<?php echo esc_url( get_author_posts_url( get_the_author_meta( 'ID' ) ) ); ?>" itemprop="url" style="font-weight:600"><span itemprop="name"><?php the_author(); ?></span></a>
				<span class="mm-meta" style="text-transform:none;letter-spacing:0">Published <time itemprop="datePublished" datetime="<?php echo esc_attr( get_the_date( DATE_W3C ) ); ?>"><?php echo esc_html( get_the_date() ); ?></time><?php if ( $mm_updated ) : ?> · Updated <time itemprop="dateModified" datetime="<?php echo esc_attr( get_the_modified_date( DATE_W3C ) ); ?>"><?php echo esc_html( get_the_modified_date() ); ?></time><?php else : ?><meta itemprop="dateModified" content="<?php echo esc_attr( get_the_modified_date( DATE_W3C ) ); ?>"><?php endif; ?> · <?php echo esc_html( mm_reading_time() ); ?> min read</span>
			</div>
			<div style="margin-left:auto;display:flex;gap:2px;flex-wrap:wrap">
				<a class="mm-tag" href="https://wa.me/?text=<?php echo rawurlencode( get_the_title() . ' ' . get_permalink() ); ?>">WhatsApp</a>
				<a class="mm-tag" href="https://www.linkedin.com/sharing/share-offsite/?url=<?php echo rawurlencode( get_permalink() ); ?>">LinkedIn</a>
				<a class="mm-tag" href="https://x.com/intent/post?url=<?php echo rawurlencode( get_permalink() ); ?>&text=<?php echo rawurlencode( get_the_title() ); ?>">X</a>
				<button class="mm-tag" type="button" data-mm-copy data-url="<?php echo esc_url( get_permalink() ); ?>" style="cursor:pointer">Copy link</button>
			</div>
		</div>
	</header>

	<?php if ( has_post_thumbnail() ) : ?>
		<figure class="grayscale mm-media mm-media-21-9" style="margin:0 var(--gutter)">
			<?php the_post_thumbnail( 'post-thumbnail', array( 'itemprop' => 'image', 'fetchpriority' => 'high' ) ); ?>
			<?php $mm_cap = get_the_post_thumbnail_caption(); if ( $mm_cap ) : ?>
				<figcaption class="mm-embed-caption" style="position:static;display:inline-block;margin-top:8px"><?php echo esc_html( $mm_cap ); ?></figcaption>
			<?php endif; ?>
		</figure>
	<?php endif; ?>

	<div style="display:grid;grid-template-columns:240px minmax(0,740px) minmax(0,1fr);gap:56px;padding:56px var(--gutter) 64px">
		<?php if ( count( $mm_toc ) >= 2 ) : ?>
		<aside class="mm-only-desktop" style="position:sticky;top:24px;align-self:start" data-mm-toc>
			<span class="mm-facet-title">In this piece</span>
			<?php foreach ( $mm_toc as $t ) : ?>
				<a href="#<?php echo esc_attr( $t['id'] ); ?>" style="display:block;padding:10px 0;border-bottom:var(--hair);font:500 14px/1.3 var(--font-display)"><?php echo esc_html( $t['label'] ); ?></a>
			<?php endforeach; ?>
		</aside>
		<?php else : ?>
			<div class="mm-only-desktop"></div>
		<?php endif; ?>

		<article class="mm-body">
			<?php echo $mm_content; // phpcs:ignore WordPress.Security.EscapeOutput -- post content, already filtered. ?>

			<?php $mm_tags = wp_get_post_tags( $mm_post->ID ); if ( $mm_tags ) : ?>
				<div style="display:flex;flex-wrap:wrap;gap:6px;padding-top:24px;border-top:var(--hair);margin-top:32px">
					<?php foreach ( $mm_tags as $t ) : ?>
						<a class="mm-tag" style="font-size:10px;padding:7px 9px" href="<?php echo esc_url( get_tag_link( $t ) ); ?>"><?php echo esc_html( $t->name ); ?></a>
					<?php endforeach; ?>
				</div>
			<?php endif; ?>

			<div class="mm-author-card" style="margin-top:24px">
				<span class="mm-avatar grayscale"><?php echo get_avatar( get_the_author_meta( 'ID' ), 144, '', '', array( 'style' => 'width:100%;height:100%' ) ); ?></span>
				<div>
					<span class="mm-kicker" style="display:block;margin-bottom:4px">Written by</span>
					<strong style="display:block;font:700 18px/1.2 var(--font-display);margin-bottom:6px"><?php the_author(); ?></strong>
					<?php echo esc_html( get_the_author_meta( 'description' ) ?: 'Writes for Marketing Mentalist.' ); ?>
					<a href="<?php echo esc_url( get_author_posts_url( get_the_author_meta( 'ID' ) ) ); ?>" style="text-decoration:underline">All articles →</a>
				</div>
			</div>
		</article>

		<aside class="mm-only-desktop" style="display:flex;flex-direction:column;gap:32px;position:sticky;top:24px;align-self:start">
			<div>
				<span class="mm-facet-title">Popular this week</span>
				<?php foreach ( get_posts( array( 'post_type' => array( 'mm_breakdown', 'mm_list' ), 'posts_per_page' => 4, 'post__not_in' => array( $mm_post->ID ), 'no_found_rows' => true ) ) as $i => $p ) : ?>
					<a href="<?php echo esc_url( get_permalink( $p ) ); ?>" style="display:grid;grid-template-columns:28px 1fr;gap:12px;padding:12px 0;border-bottom:var(--hair);font:600 15px/1.3 var(--font-display)"><span style="color:var(--mm-signal)"><?php echo esc_html( str_pad( (string) ( $i + 1 ), 2, '0', STR_PAD_LEFT ) ); ?></span><?php echo esc_html( get_the_title( $p ) ); ?></a>
				<?php endforeach; ?>
			</div>
			<?php ob_start(); mm_ad_slot( 'sidebar', 300, 250 ); $mm_ad = ob_get_clean(); if ( $mm_ad ) : ?>
				<div><?php echo $mm_ad; // phpcs:ignore WordPress.Security.EscapeOutput -- administrator-provided ad tag. ?></div>
			<?php endif; ?>
		</aside>
	</div>

	<?php $mm_related = mm_related_breakdowns( $mm_post, 3 ); ?>
	<?php if ( $mm_related ) : ?>
		<section style="padding:var(--gutter);border-top:var(--rule)" data-mm-related>
			<h2 style="font-size:28px;letter-spacing:-.02em;margin-bottom:24px">Related breakdowns</h2>
			<div class="mm-grid-3">
				<?php foreach ( $mm_related as $b ) { mm_card_breakdown_related( $b ); } ?>
			</div>
		</section>
	<?php endif; ?>
</article>
<?php get_footer(); ?>
