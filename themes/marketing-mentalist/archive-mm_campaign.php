<?php
/**
 * Campaign archive (screen 2a): type filter bar + industry/principle/year/emotion facets.
 *
 * @package marketing-mentalist
 */

get_header();
?>
<div style="padding:56px var(--gutter) 0">
	<span class="mm-kicker">Campaigns</span>
	<h1 class="mm-h1" style="font-size:44px;margin:8px 0 20px">All campaigns, decoded.</h1>
	<div class="mm-filter-bar" style="margin-bottom:8px">
		<a href="<?php echo esc_url( get_post_type_archive_link( 'mm_campaign' ) ); ?>" class="<?php echo ! is_tax( 'mm_campaign_type' ) ? 'is-active' : ''; ?>">All</a>
		<?php foreach ( get_terms( array( 'taxonomy' => 'mm_campaign_type', 'hide_empty' => false ) ) as $t ) : ?>
			<a href="<?php echo esc_url( get_term_link( $t ) ); ?>" class="<?php echo is_tax( 'mm_campaign_type', $t->term_id ) ? 'is-active' : ''; ?>"><?php echo esc_html( $t->name ); ?></a>
		<?php endforeach; ?>
	</div>
</div>

<div style="display:grid;grid-template-columns:240px minmax(0,1fr);gap:40px;padding:32px var(--gutter) 64px">
	<aside class="mm-only-desktop">
		<div class="mm-facet-group">
			<span class="mm-facet-title">Industry</span>
			<?php foreach ( get_terms( array( 'taxonomy' => 'mm_industry', 'hide_empty' => false ) ) as $t ) : ?>
				<a class="mm-facet-item<?php echo mm_facet_active( 'mm_industry', $t->slug ) ? ' is-active' : ''; ?>" data-mm-facet="industry" href="<?php echo mm_facet_link( 'mm_industry', $t->slug ); ?>"><span><?php echo esc_html( $t->name ); ?></span><span><?php echo (int) $t->count; ?></span></a>
			<?php endforeach; ?>
		</div>
		<div class="mm-facet-group">
			<span class="mm-facet-title">Principle</span>
			<?php foreach ( get_terms( array( 'taxonomy' => 'mm_principle', 'hide_empty' => false, 'number' => 8 ) ) as $t ) : ?>
				<a class="mm-facet-item<?php echo mm_facet_active( 'mm_principle', $t->slug ) ? ' is-active' : ''; ?>" data-mm-facet="principle" href="<?php echo mm_facet_link( 'mm_principle', $t->slug ); ?>"><span><?php echo esc_html( $t->name ); ?></span></a>
			<?php endforeach; ?>
		</div>
		<div class="mm-facet-group">
			<span class="mm-facet-title">Year</span>
			<?php for ( $y = (int) wp_date( 'Y' ); $y > (int) wp_date( 'Y' ) - 4; --$y ) : ?>
				<a class="mm-facet-item<?php echo mm_facet_active( 'year', (string) $y ) ? ' is-active' : ''; ?>" data-mm-facet="year" href="<?php echo mm_facet_link( 'year', (string) $y ); ?>"><span><?php echo esc_html( $y ); ?></span></a>
			<?php endfor; ?>
		</div>
		<div class="mm-facet-group">
			<span class="mm-facet-title">Emotion</span>
			<?php foreach ( get_terms( array( 'taxonomy' => 'mm_emotion', 'hide_empty' => false ) ) as $t ) : ?>
				<a class="mm-facet-item<?php echo mm_facet_active( 'mm_emotion', $t->slug ) ? ' is-active' : ''; ?>" data-mm-facet="emotion" href="<?php echo mm_facet_link( 'mm_emotion', $t->slug ); ?>"><span><?php echo esc_html( $t->name ); ?></span></a>
			<?php endforeach; ?>
		</div>
	</aside>

	<div>
		<?php if ( have_posts() ) : ?>
			<div class="mm-grid-3">
				<?php while ( have_posts() ) { the_post(); mm_card_campaign( get_post() ); } ?>
			</div>
			<?php the_posts_pagination( array( 'class' => 'mm-pagination', 'mid_size' => 2, 'prev_text' => 'Newer', 'next_text' => 'Older' ) ); ?>
		<?php else : ?>
			<p class="mm-body" style="color:var(--mm-smoke)">No campaigns match. Clear a filter and try again.</p>
		<?php endif; ?>
	</div>
</div>
<?php get_footer(); ?>
