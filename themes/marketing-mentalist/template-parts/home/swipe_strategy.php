<?php
/**
 * Swipe the strategy: campaign carousel cards.
 *
 * @package marketing-mentalist
 */

$mm_campaigns = get_posts( array( 'post_type' => 'mm_campaign', 'posts_per_page' => 8, 'no_found_rows' => true ) );
if ( ! $mm_campaigns ) {
	return;
}
?>
<section class="mm-section" style="padding:56px var(--gutter) 64px" data-mm-carousel>
	<div style="display:flex;justify-content:space-between;align-items:flex-end;margin-bottom:32px;gap:24px;flex-wrap:wrap">
		<div style="display:flex;flex-direction:column;gap:10px">
			<span class="mm-kicker">Campaigns, in 60 seconds</span>
			<h2 class="mm-h2">Swipe the strategy.</h2>
		</div>
		<?php if ( count( $mm_campaigns ) > 4 ) : ?>
			<div style="margin:0;gap:2px;display:flex">
				<button class="mm-btn-icon" data-mm-carousel-prev aria-label="Previous">←</button>
				<button class="mm-btn-icon" style="background:var(--mm-ink);color:var(--mm-paper)" data-mm-carousel-next aria-label="Next">→</button>
			</div>
		<?php endif; ?>
	</div>
	<div class="mm-carousel" data-mm-carousel-track>
		<?php foreach ( $mm_campaigns as $c ) { mm_card_carousel( $c ); } ?>
	</div>
</section>
