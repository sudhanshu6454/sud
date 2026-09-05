<?php
/**
 * Article sidebar: ad, latest stories, newsletter, sticky ad.
 *
 * @package marketing-junkies
 */

$mj_exclude = is_singular() ? array( get_the_ID() ) : array();
?>
<aside class="mj-sidebar" aria-label="<?php esc_attr_e( 'Sidebar', 'marketing-junkies' ); ?>">
	<?php mj_ad_slot( 'sidebar_top', 300, 250 ); ?>

	<section class="mj-latest">
		<h2><?php esc_html_e( 'Latest', 'marketing-junkies' ); ?></h2>
		<ol>
			<?php foreach ( mj_latest_posts( 4, $mj_exclude ) as $i => $p ) : ?>
				<li><span class="mj-num"><?php echo esc_html( sprintf( '%02d', $i + 1 ) ); ?></span><a href="<?php echo esc_url( get_permalink( $p ) ); ?>"><?php echo esc_html( get_the_title( $p ) ); ?></a></li>
			<?php endforeach; ?>
		</ol>
	</section>

	<section class="mj-newsletter" id="newsletter">
		<img src="<?php echo esc_url( MJ_URI . '/assets/img/mj-monogram-dark.png' ); ?>" alt="" width="44" height="44" loading="lazy">
		<h2><?php echo esc_html( get_theme_mod( 'mj_newsletter_heading', 'Your daily fix, 7 am IST.' ) ); ?></h2>
		<p><?php echo esc_html( get_theme_mod( 'mj_newsletter_text', 'One email a day. Marketing, media and martech news in five minutes.' ) ); ?></p>
		<?php mj_newsletter_form( 'side' ); ?>
		<?php
		$mj_sponsor = trim( (string) get_theme_mod( 'mj_ad_newsletter_sponsor', '' ) );
		if ( $mj_sponsor || get_theme_mod( 'mj_show_ad_placeholders', false ) ) :
			?>
			<div class="mj-newsletter-sponsor" data-ad-slot="mj_newsletter_sponsor">
				<span><?php esc_html_e( 'Presented by', 'marketing-junkies' ); ?></span>
				<?php if ( $mj_sponsor ) : ?>
					<span><?php echo $mj_sponsor; // phpcs:ignore WordPress.Security.EscapeOutput -- administrator-provided ad tag. ?></span>
				<?php else : ?>
					<span style="width:88px;height:24px;border:1px dashed var(--color-neutral-600)"></span>
				<?php endif; ?>
			</div>
		<?php endif; ?>
	</section>

	<?php mj_ad_slot( 'sidebar_sticky', 300, 600, 'mj-ad-sticky' ); ?>
</aside>
