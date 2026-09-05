<?php
/**
 * Template Name: Newsletter
 * The Brand Briefing - what's inside + past issues + sign-up.
 *
 * @package marketing-mentalist
 */

get_header();
$mm_issues = get_posts( array( 'post_type' => array( 'mm_breakdown', 'post', 'mm_take' ), 'posts_per_page' => 6, 'meta_key' => 'mm_in_newsletter', 'meta_value' => '1', 'no_found_rows' => true ) );
?>
<section style="padding:72px var(--gutter);display:grid;grid-template-columns:minmax(0,1fr) 440px;gap:64px;align-items:start;border-bottom:var(--rule)">
	<div style="display:flex;flex-direction:column;gap:18px">
		<img src="<?php echo esc_url( MM_URI . '/assets/img/mark.png' ); ?>" alt="" width="40" height="40" loading="lazy">
		<span class="mm-kicker"><?php echo esc_html( get_theme_mod( 'mm_newsletter_name', 'The Brand Briefing' ) ); ?> · <?php echo esc_html( get_theme_mod( 'mm_newsletter_cadence', 'every Wednesday' ) ); ?></span>
		<h1 class="mm-h1" style="font-size:48px">One email. Everything a marketer needs to know this week.</h1>
		<p class="mm-standfirst" style="max-width:560px"><?php the_content(); ?></p>
		<div style="margin-top:12px">
			<span class="mm-facet-title">What's inside</span>
			<?php foreach ( array( "This week's mindread", 'Three campaigns, decoded in a paragraph each', 'One Mentalist Take', 'One psychology principle, one example', 'The news that will come up in your standup' ) as $i => $line ) : ?>
				<div style="display:grid;grid-template-columns:32px 1fr;gap:12px;padding:10px 0;border-bottom:var(--hair)"><span class="mm-meta" style="color:var(--mm-signal)"><?php echo esc_html( str_pad( (string) ( $i + 1 ), 2, '0', STR_PAD_LEFT ) ); ?></span><span class="mm-body" style="font-size:15px"><?php echo esc_html( $line ); ?></span></div>
			<?php endforeach; ?>
		</div>
	</div>
	<div class="mm-newsletter-box" id="newsletter">
		<?php mm_newsletter_form( 'page' ); ?>
		<p class="mm-meta" style="margin-top:8px">No spam. One email a week. Unsubscribe in one tap.</p>
	</div>
</section>
<?php if ( $mm_issues ) : ?>
<section style="padding:56px var(--gutter) 72px">
	<h2 style="font-size:28px;margin-bottom:24px">Recent issues covered</h2>
	<ol style="list-style:none;margin:0;padding:0;max-width:700px">
		<?php foreach ( $mm_issues as $issue ) : ?>
			<li class="mm-list-row"><a href="<?php echo esc_url( get_permalink( $issue ) ); ?>" style="display:contents"><span class="mm-list-n" style="font-size:16px"><?php echo esc_html( get_the_date( 'j M', $issue ) ); ?></span><span style="font:600 17px/1.3 var(--font-display)"><?php echo esc_html( get_the_title( $issue ) ); ?></span></a></li>
		<?php endforeach; ?>
	</ol>
</section>
<?php endif; ?>
<?php get_footer(); ?>
