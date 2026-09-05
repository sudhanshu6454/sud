<?php
/**
 * Breakdowns: intro column + 2 latest.
 *
 * @package marketing-mentalist
 */

$mm_breakdowns = get_posts( array( 'post_type' => 'mm_breakdown', 'posts_per_page' => 2, 'no_found_rows' => true ) );
if ( ! $mm_breakdowns ) {
	return;
}
?>
<section class="mm-section" style="display:grid;grid-template-columns:minmax(0,5fr) minmax(0,7fr)">
	<div style="padding:56px 44px 56px var(--gutter);border-right:var(--rule);display:flex;flex-direction:column;justify-content:space-between;gap:40px" class="mm-only-desktop">
		<div style="display:flex;flex-direction:column;gap:10px">
			<span class="mm-kicker">Breakdowns</span>
			<h2 style="font-size:44px;letter-spacing:-.025em">We read between the ads.</h2>
			<p class="mm-standfirst" style="font-size:16px;max-width:380px;margin-top:8px">Long-form analysis. Insight, strategy, creative, psychology, culture. Six minutes minimum.</p>
		</div>
		<a href="<?php echo esc_url( get_post_type_archive_link( 'mm_breakdown' ) ); ?>" class="mm-btn-link">All breakdowns <span aria-hidden="true">→</span></a>
	</div>
	<div class="mm-only-mobile" style="padding:32px var(--gutter) 0;display:flex;flex-direction:column;gap:10px">
		<span class="mm-kicker">Breakdowns</span>
		<h2 class="mm-h2">We read between the ads.</h2>
	</div>
	<div style="display:grid;grid-template-columns:1fr 1fr">
		<?php foreach ( $mm_breakdowns as $i => $b ) : ?>
			<a href="<?php echo esc_url( get_permalink( $b ) ); ?>" style="display:flex;flex-direction:column;gap:16px;padding:32px 32px 36px;<?php echo 0 === $i ? 'border-right:var(--hair)' : ''; ?>">
				<div class="mm-media mm-media-16-9 grayscale"><?php echo has_post_thumbnail( $b ) ? get_the_post_thumbnail( $b, 'mm-card', array( 'loading' => 'lazy' ) ) : ''; ?></div>
				<?php $mm_cats = get_the_category( $b ); ?>
				<span class="mm-kicker"><?php echo esc_html( $mm_cats ? $mm_cats[0]->name : 'Breakdown' ); ?></span>
				<h3 style="font-size:26px;line-height:1.12;letter-spacing:-.02em;font-weight:700"><?php echo esc_html( get_the_title( $b ) ); ?></h3>
				<p class="mm-body" style="font-size:15px;color:var(--mm-smoke)"><?php echo esc_html( wp_trim_words( mm_standfirst( $b ), 22 ) ); ?></p>
				<span class="mm-meta"><?php echo esc_html( mm_reading_time( $b ) ); ?> min read</span>
			</a>
		<?php endforeach; ?>
	</div>
</section>
