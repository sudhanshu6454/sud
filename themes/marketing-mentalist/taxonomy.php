<?php
/**
 * Category / topic / industry / principle / market / label archives.
 *
 * @package marketing-mentalist
 */

get_header();
$mm_term = get_queried_object();
?>
<header style="padding:56px var(--gutter);max-width:900px">
	<span class="mm-kicker"><?php echo esc_html( $mm_term->taxonomy === 'mm_principle' ? 'Psychology principle' : ( $mm_term->taxonomy === 'category' ? 'Section' : 'Topic' ) ); ?></span>
	<h1 class="mm-h1" style="font-size:44px;margin:8px 0 12px"><?php echo esc_html( single_term_title( '', false ) ); ?></h1>
	<?php if ( term_description() ) : ?>
		<p class="mm-standfirst"><?php echo wp_kses_post( term_description() ); ?></p>
	<?php endif; ?>
	<span class="mm-meta"><?php echo esc_html( sprintf( '%s stories', number_format_i18n( (int) $GLOBALS['wp_query']->found_posts ) ) ); ?></span>
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
		<p class="mm-body" style="color:var(--mm-smoke)">Nothing here yet.</p>
	<?php endif; ?>
</div>
<?php get_footer(); ?>
