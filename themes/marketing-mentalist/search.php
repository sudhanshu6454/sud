<?php
/**
 * Search results (the overlay in header.php submits here).
 *
 * @package marketing-mentalist
 */

get_header();
?>
<header style="padding:56px var(--gutter);max-width:900px">
	<span class="mm-kicker">Search</span>
	<h1 class="mm-h1" style="font-size:44px;margin:8px 0 12px"><?php echo esc_html( get_search_query() ); ?></h1>
	<span class="mm-meta"><?php echo esc_html( sprintf( '%s results', number_format_i18n( (int) $GLOBALS['wp_query']->found_posts ) ) ); ?></span>
</header>
<div style="padding:0 var(--gutter) 64px">
	<?php if ( have_posts() ) : ?>
		<div class="mm-grid-3">
			<?php
			while ( have_posts() ) :
				the_post();
				$p = get_post();
				if ( 'mm_campaign' === $p->post_type ) {
					mm_card_campaign( $p );
				} elseif ( 'mm_breakdown' === $p->post_type ) {
					mm_card_breakdown( $p );
				} else {
					mm_card_breakdown_related( $p );
				}
			endwhile;
			?>
		</div>
		<?php the_posts_pagination( array( 'class' => 'mm-pagination', 'mid_size' => 2, 'prev_text' => 'Newer', 'next_text' => 'Older' ) ); ?>
	<?php else : ?>
		<p class="mm-body" style="color:var(--mm-smoke)">Even we couldn't read that mind. Try another word.</p>
	<?php endif; ?>
</div>
<?php get_footer(); ?>
