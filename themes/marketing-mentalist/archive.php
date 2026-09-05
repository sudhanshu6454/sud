<?php
/**
 * Generic archive for mm_breakdown, mm_take, mm_brand, mm_agency, mm_list and author archives.
 *
 * @package marketing-mentalist
 */

get_header();
$mm_pt = get_post_type() ?: 'post';
$mm_labels = array(
	'mm_breakdown' => array( 'Breakdowns', 'Long-form analysis. Insight, strategy, creative, psychology, culture.' ),
	'mm_take'      => array( 'Mentalist Takes', 'Short, sharp opinions on what is actually happening in marketing.' ),
	'mm_brand'     => array( 'Brands', 'Every brand we have decoded a campaign for.' ),
	'mm_agency'    => array( 'Agencies', 'Every agency behind the campaigns we cover.' ),
	'mm_list'      => array( 'Top Lists', 'Ranked, opinionated, occasionally argued about.' ),
);
list( $mm_title, $mm_desc ) = $mm_labels[ $mm_pt ] ?? array( get_the_archive_title(), '' );
?>
<header style="padding:56px var(--gutter);max-width:900px">
	<?php if ( is_author() ) : ?>
		<span class="mm-kicker">Written by</span>
		<h1 class="mm-h1" style="font-size:44px;margin:8px 0 12px"><?php the_author(); ?></h1>
		<p class="mm-standfirst"><?php echo esc_html( get_the_author_meta( 'description' ) ); ?></p>
	<?php else : ?>
		<h1 class="mm-h1" style="font-size:44px;margin:0 0 12px"><?php echo esc_html( $mm_title ); ?></h1>
		<p class="mm-standfirst"><?php echo esc_html( $mm_desc ); ?></p>
	<?php endif; ?>
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
				} elseif ( in_array( $p->post_type, array( 'mm_brand', 'mm_agency' ), true ) ) {
					?>
					<a class="mm-card mm-card-top" href="<?php echo esc_url( get_permalink( $p ) ); ?>">
						<div class="mm-media mm-media-16-9 grayscale" style="display:flex;align-items:center;justify-content:center">
							<?php echo has_post_thumbnail( $p ) ? get_the_post_thumbnail( $p, 'mm-card' ) : '<span style="font:700 40px/1 var(--font-display)">' . esc_html( mb_substr( get_the_title( $p ), 0, 1 ) ) . '</span>'; ?>
						</div>
						<h3 class="mm-h3"><?php echo esc_html( get_the_title( $p ) ); ?></h3>
					</a>
					<?php
				} else {
					mm_card_breakdown( $p );
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
