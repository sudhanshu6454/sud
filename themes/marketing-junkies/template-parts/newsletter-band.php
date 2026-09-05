<?php
/**
 * Full-width newsletter band used on home and archives.
 *
 * @package marketing-junkies
 */
?>
<section class="mj-newsletter-band" id="newsletter">
	<div class="mj-wrap">
		<div>
			<h2><?php echo esc_html( get_theme_mod( 'mj_newsletter_heading', 'Your daily fix, 7 am IST.' ) ); ?></h2>
			<p><?php echo esc_html( get_theme_mod( 'mj_newsletter_text', 'One email a day. Marketing, media and martech news in five minutes.' ) ); ?></p>
		</div>
		<?php mj_newsletter_form( 'band' ); ?>
	</div>
</section>
