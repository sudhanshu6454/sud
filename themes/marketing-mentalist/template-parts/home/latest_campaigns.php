<?php
/**
 * Latest campaigns grid + type filter bar.
 *
 * @package marketing-mentalist
 */

$mm_campaigns = get_posts( array( 'post_type' => 'mm_campaign', 'posts_per_page' => 6, 'no_found_rows' => true ) );
if ( ! $mm_campaigns ) {
	return;
}
?>
<section class="mm-section" style="padding:56px var(--gutter) 64px">
	<div style="display:flex;flex-direction:column;gap:24px;margin-bottom:32px">
		<h2 class="mm-h2">Latest campaigns</h2>
		<div class="mm-filter-bar">
			<a href="<?php echo esc_url( get_post_type_archive_link( 'mm_campaign' ) ); ?>" class="is-active">All</a>
			<?php foreach ( get_terms( array( 'taxonomy' => 'mm_campaign_type', 'hide_empty' => false, 'number' => 11 ) ) as $t ) : ?>
				<a href="<?php echo esc_url( get_term_link( $t ) ); ?>"><?php echo esc_html( $t->name ); ?></a>
			<?php endforeach; ?>
		</div>
	</div>
	<div class="mm-grid-3">
		<?php foreach ( $mm_campaigns as $c ) { mm_card_campaign( $c ); } ?>
	</div>
</section>
