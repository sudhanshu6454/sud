<?php
/**
 * Newsletter band.
 *
 * @package marketing-mentalist
 */
?>
<section class="mm-section" id="newsletter" style="padding:72px var(--gutter);display:grid;grid-template-columns:minmax(0,1fr) 440px;gap:64px;align-items:end;background:var(--mm-bone)">
	<div style="display:flex;flex-direction:column;gap:18px">
		<div style="display:flex;align-items:center;gap:14px">
			<img src="<?php echo esc_url( MM_URI . '/assets/img/mark.png' ); ?>" alt="" width="30" height="30" loading="lazy">
			<span class="mm-kicker" style="color:var(--mm-ink)"><?php echo esc_html( get_theme_mod( 'mm_newsletter_name', 'The Brand Briefing' ) ); ?> · <?php echo esc_html( get_theme_mod( 'mm_newsletter_cadence', 'every Wednesday' ) ); ?></span>
		</div>
		<h2 class="mm-h2" style="font-size:48px">Know what marketers are thinking before Monday's meeting.</h2>
		<p class="mm-standfirst" style="max-width:560px">The week's smartest campaigns, trends and consumer insights in one email.</p>
	</div>
	<div>
		<?php mm_newsletter_form( 'home' ); ?>
		<p class="mm-meta" style="margin-top:8px">No spam. One email a week. Unsubscribe in one tap.</p>
	</div>
</section>
