<?php
/**
 * Hero: "This week's mindread" - the flagged or latest campaign/breakdown.
 *
 * @package marketing-mentalist
 */

$mm_hero = get_posts( array( 'post_type' => array( 'mm_campaign', 'mm_breakdown' ), 'posts_per_page' => 1, 'meta_key' => 'mm_featured_home', 'meta_value' => '1', 'no_found_rows' => true ) );
if ( ! $mm_hero ) {
	$mm_hero = mm_latest_of( array( 'mm_campaign', 'mm_breakdown' ) );
}
if ( ! $mm_hero ) {
	return;
}
$mm_hero_post = $mm_hero[0];
$mm_is_campaign = 'mm_campaign' === $mm_hero_post->post_type;
?>
<section class="mm-section" style="display:grid;grid-template-columns:minmax(0,7fr) minmax(0,5fr)">
	<a href="<?php echo esc_url( get_permalink( $mm_hero_post ) ); ?>" class="grayscale mm-only-desktop" style="display:block;aspect-ratio:16/9;background:var(--mm-bone);border-right:var(--rule);position:relative;overflow:hidden">
		<?php if ( has_post_thumbnail( $mm_hero_post ) ) : ?>
			<?php echo get_the_post_thumbnail( $mm_hero_post, 'post-thumbnail', array( 'style' => 'width:100%;height:100%;object-fit:cover', 'fetchpriority' => 'high' ) ); ?>
		<?php endif; ?>
	</a>
	<div style="padding:40px var(--gutter) 40px 44px;display:flex;flex-direction:column;justify-content:space-between;gap:32px">
		<div style="display:flex;flex-direction:column;gap:22px">
			<div style="display:flex;flex-direction:column;gap:8px">
				<span class="mm-kicker">This week's mindread</span>
				<span style="display:block;width:64px;height:3px;background:var(--mm-signal)"></span>
			</div>
			<h1 class="mm-h1"><a href="<?php echo esc_url( get_permalink( $mm_hero_post ) ); ?>"><?php echo esc_html( get_the_title( $mm_hero_post ) ); ?></a></h1>
			<p class="mm-standfirst"><?php echo esc_html( wp_trim_words( mm_standfirst( $mm_hero_post ), 28 ) ); ?></p>
		</div>
		<div style="display:flex;flex-direction:column;gap:20px">
			<div style="display:flex;gap:8px;flex-wrap:wrap" class="mm-meta">
				<?php
				$mm_terms = $mm_is_campaign ? get_the_terms( $mm_hero_post, 'mm_principle' ) : get_the_category( $mm_hero_post );
				$mm_terms = is_array( $mm_terms ) ? $mm_terms : array();
				foreach ( array_slice( $mm_terms, 0, 2 ) as $t ) :
					?>
					<span class="mm-tag"><?php echo esc_html( $t->name ); ?></span>
				<?php endforeach; ?>
				<span style="padding:6px 0"><?php echo esc_html( mm_reading_time( $mm_hero_post ) ); ?> min read</span>
			</div>
			<a href="<?php echo esc_url( get_permalink( $mm_hero_post ) ); ?>" class="mm-btn-link" style="align-self:flex-start"><?php echo $mm_is_campaign ? 'Decode the campaign' : 'Read the breakdown'; ?> <span aria-hidden="true">→</span></a>
		</div>
	</div>
</section>
