<?php
/**
 * News article (the `post` type autopub publishes to) - compact variant of the breakdown template,
 * at the root URL (no /news/ prefix) so autopub's existing links keep working (HANDOVER.md §8 default).
 *
 * @package marketing-mentalist
 */

get_header();
the_post();
$mm_post    = get_post();
$mm_cats    = get_the_category( $mm_post );
$mm_content = apply_filters( 'the_content', $mm_post->post_content );
$mm_content = preg_replace( '#<p>(\s*<em>\s*Source:)#i', '<p class="mm-source">$1', $mm_content, 1 );
$mm_content = preg_replace( '#<p>(\s*Source:\s*<a)#i', '<p class="mm-source">$1', $mm_content, 1 );
?>
<script>window.mmPageView = { event: 'article_view', params: { title: <?php echo wp_json_encode( get_the_title() ); ?> } };</script>
<article itemscope itemtype="https://schema.org/NewsArticle">
	<header style="padding:56px var(--gutter) 32px;max-width:900px;display:flex;flex-direction:column;gap:20px">
		<?php mm_breadcrumb( array_filter( array( array( home_url( '/' ), 'Home' ), $mm_cats ? array( get_category_link( $mm_cats[0] ), $mm_cats[0]->name ) : null ) ) ); ?>
		<div style="display:flex;align-items:center;gap:14px">
			<span class="mm-label">News</span>
			<span class="mm-kicker"><?php echo esc_html( $mm_cats ? $mm_cats[0]->name : '' ); ?></span>
		</div>
		<h1 class="mm-h1" itemprop="headline"><?php the_title(); ?></h1>
		<?php if ( has_excerpt() ) : ?>
			<p class="mm-standfirst" itemprop="description"><?php echo esc_html( wp_strip_all_tags( get_the_excerpt() ) ); ?></p>
		<?php endif; ?>
		<div style="display:flex;align-items:center;gap:14px;padding:14px 0;border-top:var(--rule);border-bottom:var(--hair);font:400 13px/1.3 var(--font-display);flex-wrap:wrap">
			<span style="font-weight:600" itemprop="author" itemscope itemtype="https://schema.org/Person"><a href="<?php echo esc_url( get_author_posts_url( get_the_author_meta( 'ID' ) ) ); ?>" itemprop="url"><span itemprop="name"><?php the_author(); ?></span></a></span>
			<span class="mm-meta" style="text-transform:none;letter-spacing:0"><time itemprop="datePublished" datetime="<?php echo esc_attr( get_the_date( DATE_W3C ) ); ?>"><?php echo esc_html( get_the_date( 'j M Y, H:i' ) ); ?></time> · <?php echo esc_html( mm_reading_time() ); ?> min read</span>
			<meta itemprop="dateModified" content="<?php echo esc_attr( get_the_modified_date( DATE_W3C ) ); ?>">
			<div style="margin-left:auto;display:flex;gap:2px">
				<button class="mm-tag" type="button" data-mm-share data-title="<?php echo esc_attr( get_the_title() ); ?>" data-url="<?php echo esc_url( get_permalink() ); ?>" style="cursor:pointer">Share</button>
				<button class="mm-tag" type="button" data-mm-copy data-url="<?php echo esc_url( get_permalink() ); ?>" style="cursor:pointer">Copy link</button>
			</div>
		</div>
	</header>

	<?php if ( has_post_thumbnail() ) : ?>
		<figure class="grayscale mm-media mm-media-16-9" style="margin:0 var(--gutter);max-width:900px">
			<?php the_post_thumbnail( 'post-thumbnail', array( 'itemprop' => 'image', 'fetchpriority' => 'high' ) ); ?>
		</figure>
	<?php endif; ?>

	<div style="padding:40px var(--gutter) 56px;max-width:900px">
		<div class="mm-body" style="max-width:700px">
			<?php echo $mm_content; // phpcs:ignore WordPress.Security.EscapeOutput -- post content, already filtered. ?>
		</div>
		<?php $mm_tags = wp_get_post_tags( $mm_post->ID ); if ( $mm_tags ) : ?>
			<div style="display:flex;flex-wrap:wrap;gap:6px;padding-top:24px;border-top:var(--hair);margin-top:24px;max-width:700px">
				<?php foreach ( $mm_tags as $t ) : ?>
					<a class="mm-tag" style="font-size:10px;padding:7px 9px" href="<?php echo esc_url( get_tag_link( $t ) ); ?>"><?php echo esc_html( $t->name ); ?></a>
				<?php endforeach; ?>
			</div>
		<?php endif; ?>
	</div>

	<?php $mm_related = get_posts( array( 'post_type' => 'post', 'posts_per_page' => 3, 'post__not_in' => array( $mm_post->ID ), 'category__in' => wp_list_pluck( $mm_cats, 'term_id' ), 'no_found_rows' => true ) ); ?>
	<?php if ( $mm_related ) : ?>
		<section style="padding:var(--gutter);border-top:var(--rule)" data-mm-related>
			<h2 style="font-size:24px;letter-spacing:-.02em;margin-bottom:24px">More news</h2>
			<div class="mm-grid-3">
				<?php foreach ( $mm_related as $p ) { mm_card_breakdown_related( $p ); } ?>
			</div>
		</section>
	<?php endif; ?>
</article>
<?php get_footer(); ?>
