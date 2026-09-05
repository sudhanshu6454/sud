<?php
/**
 * Get featured: submit-campaign / advertise CTAs + offerings grid.
 *
 * @package marketing-mentalist
 */
?>
<section class="mm-section" style="padding:72px var(--gutter);display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:64px">
	<div style="display:flex;flex-direction:column;gap:20px">
		<span class="mm-kicker">For brands and agencies</span>
		<h2 class="mm-h2" style="font-size:48px">Think your campaign deserves attention?</h2>
		<p class="mm-standfirst">Put it in front of India's marketing community.</p>
		<div style="display:flex;gap:2px;margin-top:8px;flex-wrap:wrap">
			<a href="<?php echo esc_url( mm_page_link( 'submit-campaign' ) ?: home_url( '/submit-campaign/' ) ); ?>" class="mm-btn mm-btn-primary">Submit a campaign →</a>
			<a href="<?php echo esc_url( mm_page_link( 'advertise' ) ?: home_url( '/advertise/' ) ); ?>" class="mm-btn">Advertise with us</a>
		</div>
	</div>
	<ul style="list-style:none;margin:0;padding:0;display:grid;grid-template-columns:1fr 1fr;border-top:1px solid var(--mm-ink);border-left:1px solid var(--mm-ink)">
		<?php foreach ( array( 'Campaign coverage', 'Sponsored breakdown', 'Instagram carousel', 'Website feature', 'Newsletter integration', 'Social amplification', 'Brand partnership', 'Event partnership' ) as $p ) : ?>
			<li style="padding:18px 16px;border-right:1px solid var(--mm-ink);border-bottom:1px solid var(--mm-ink);font:500 15px/1.2 var(--font-display)"><?php echo esc_html( $p ); ?></li>
		<?php endforeach; ?>
	</ul>
</section>
