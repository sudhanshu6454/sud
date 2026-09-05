<?php
/**
 * Psychology lab (principles) + brand battle (static in v1, HANDOVER.md §2).
 *
 * @package marketing-mentalist
 */

$mm_principles = get_terms( array( 'taxonomy' => 'mm_principle', 'hide_empty' => false, 'number' => 7 ) );
$mm_battles = get_posts( array( 'post_type' => 'mm_battle', 'posts_per_page' => 1, 'no_found_rows' => true ) );
?>
<section class="mm-section" style="display:grid;grid-template-columns:1fr 1fr">
	<div style="padding:56px 44px 56px var(--gutter);border-right:var(--rule);display:flex;flex-direction:column;gap:28px;background:var(--mm-bone)">
		<span class="mm-kicker">Psychology lab</span>
		<h2 style="font-size:38px;letter-spacing:-.02em">Why does the same trick keep working on smart people?</h2>
		<div style="display:flex;flex-wrap:wrap;gap:8px">
			<?php foreach ( $mm_principles as $p ) : ?>
				<a class="mm-tag" href="<?php echo esc_url( get_term_link( $p ) ); ?>"><?php echo esc_html( $p->name ); ?></a>
			<?php endforeach; ?>
		</div>
		<a href="<?php echo esc_url( get_term_link( $mm_principles[0] ?? 0, 'mm_principle' ) ?: home_url( '/' ) ); ?>" class="mm-btn-link" style="margin-top:auto">Enter the lab <span aria-hidden="true">→</span></a>
	</div>
	<div style="padding:56px var(--gutter);display:flex;flex-direction:column;gap:28px">
		<span class="mm-kicker">Brand battle</span>
		<?php if ( $mm_battles ) : $mm_battle = $mm_battles[0]; $mm_sides = array_map( 'trim', explode( ' vs ', str_ireplace( ' vs. ', ' vs ', $mm_battle->post_title ) ) ); ?>
			<div style="display:grid;grid-template-columns:1fr auto 1fr;align-items:center;gap:20px">
				<button class="mm-battle-row" data-mm-battle-vote="<?php echo esc_attr( $mm_sides[0] ?? '' ); ?>" style="padding:36px 20px;font-size:34px;justify-content:flex-start"><span><?php echo esc_html( $mm_sides[0] ?? '' ); ?></span></button>
				<span class="mm-battle-vs">VS</span>
				<button class="mm-battle-row" data-mm-battle-vote="<?php echo esc_attr( $mm_sides[1] ?? '' ); ?>" style="padding:36px 20px;font-size:34px;justify-content:flex-start"><span><?php echo esc_html( $mm_sides[1] ?? '' ); ?></span></button>
			</div>
			<p class="mm-body" style="font-size:22px"><?php echo esc_html( wp_strip_all_tags( $mm_battle->post_content ) ); ?></p>
			<p class="mm-meta" style="margin:auto 0 0">Tap to vote · results after voting</p>
		<?php else : ?>
			<p class="mm-body" style="color:var(--mm-smoke)">No brand battle running right now.</p>
		<?php endif; ?>
	</div>
</section>
