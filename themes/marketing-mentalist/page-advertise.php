<?php
/**
 * Template Name: Advertise
 * /advertise/ - reach stats (Customizer placeholders), audience, solutions grid.
 *
 * @package marketing-mentalist
 */

get_header();
?>
<section class="mm-take" style="padding:88px var(--gutter);display:grid;grid-template-columns:minmax(0,8fr) minmax(0,4fr);gap:64px;align-items:end;background:var(--mm-signal)">
	<div style="display:flex;flex-direction:column;gap:20px">
		<span class="mm-kicker" style="color:var(--mm-paper)">Advertise · Partner · Get featured</span>
		<h1 style="font:700 min(80px,9vw)/0.94 var(--font-display);letter-spacing:-.04em;margin:0;color:var(--mm-paper);text-wrap:balance">Reach the people who decide what India's brands do next.</h1>
	</div>
	<p class="mm-standfirst" style="color:var(--mm-paper)">CMOs, brand managers, agency leads and the next generation of marketers read us to understand why marketing works. Put your work in front of them.</p>
</section>

<section style="display:grid;grid-template-columns:repeat(4,1fr);border-bottom:var(--rule)">
	<?php foreach ( mm_media_kit() as $stat ) : ?>
		<div style="padding:40px var(--gutter);border-right:var(--hair);display:flex;flex-direction:column;gap:10px">
			<span style="font:700 56px/1 var(--font-display);letter-spacing:-.04em"><?php echo esc_html( $stat['v'] ); ?></span>
			<span class="mm-meta"><?php echo esc_html( $stat['k'] ); ?></span>
		</div>
	<?php endforeach; ?>
</section>

<section style="padding:56px var(--gutter)">
	<h2 style="font-size:32px;margin-bottom:24px">Ways to work with us</h2>
	<div class="mm-grid-4">
		<?php foreach ( array(
			array( '01', 'Campaign coverage', 'Your campaign decoded in the standard six-section format, labelled Partner Content.' ),
			array( '02', 'Sponsored breakdown', 'A long-form analysis of your category, with your brand as the case.' ),
			array( '03', 'Instagram carousel', 'A 6-8 slide carousel in the Marketing Mentalist format, posted to our feed.' ),
			array( '04', 'Website feature', 'Homepage placement in Swipe the Strategy for one week.' ),
			array( '05', 'Newsletter integration', 'A sponsored section in The Brand Briefing.' ),
			array( '06', 'Social amplification', 'Cross-posting to LinkedIn, X and WhatsApp channels.' ),
			array( '07', 'Brand partnership', 'A quarterly series co-created around a theme you own.' ),
			array( '08', 'Event partnership', 'Panels, awards and live breakdowns.' ),
		) as list( $n, $h, $p ) ) : ?>
			<div style="border-top:var(--rule);padding-top:12px">
				<span class="mm-kicker"><?php echo esc_html( $n ); ?></span>
				<h3 class="mm-h3" style="margin:8px 0"><?php echo esc_html( $h ); ?></h3>
				<p class="mm-body" style="font-size:14px;color:var(--mm-smoke)"><?php echo esc_html( $p ); ?></p>
			</div>
		<?php endforeach; ?>
	</div>
</section>

<section style="padding:56px var(--gutter) 72px;background:var(--mm-bone)" id="enquire">
	<h2 style="font-size:32px;margin-bottom:8px">Enquire</h2>
	<p class="mm-standfirst" style="margin-bottom:24px;max-width:600px">Tell us what you have in mind and an editor will follow up with rates and availability.</p>
	<form id="mm-advertise-form" method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>" style="max-width:520px;display:flex;flex-direction:column;gap:12px">
		<input type="hidden" name="action" value="mm_submit_campaign">
		<input type="hidden" name="campaign_name" value="Advertise enquiry">
		<?php wp_nonce_field( 'mm_submit_campaign', 'mm_submit_nonce' ); ?>
		<label class="screen-reader-text">Website <input type="text" name="website" tabindex="-1" autocomplete="off"></label>
		<div class="mm-field"><label for="mm-adv-name">Name <span style="color:var(--mm-signal)">*</span></label><input class="mm-input-boxed" id="mm-adv-name" name="name" required></div>
		<div class="mm-field"><label for="mm-adv-company">Company <span style="color:var(--mm-signal)">*</span></label><input class="mm-input-boxed" id="mm-adv-company" name="company" required></div>
		<div class="mm-field"><label for="mm-adv-email">Work email <span style="color:var(--mm-signal)">*</span></label><input class="mm-input-boxed" id="mm-adv-email" name="email" type="email" required></div>
		<div class="mm-field"><label for="mm-adv-brand">Brand</label><input class="mm-input-boxed" id="mm-adv-brand" name="brand"></div>
		<div class="mm-field"><label for="mm-adv-desc">What are you looking for?</label><textarea class="mm-input-boxed" id="mm-adv-desc" name="description" rows="4"></textarea></div>
		<button type="submit" class="mm-btn mm-btn-primary">Send enquiry <span aria-hidden="true">→</span></button>
	</form>
</section>
<?php get_footer(); ?>
