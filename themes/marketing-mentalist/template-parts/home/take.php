<?php
/**
 * Mentalist take: full-bleed dark statement.
 *
 * @package marketing-mentalist
 */

$mm_takes = get_posts( array( 'post_type' => 'mm_take', 'posts_per_page' => 1, 'no_found_rows' => true ) );
if ( ! $mm_takes ) {
	return;
}
$mm_take = $mm_takes[0];
?>
<section class="mm-section mm-take" style="display:grid;grid-template-columns:minmax(0,1fr) auto;gap:48px;align-items:end;padding:72px var(--gutter)">
	<div style="display:flex;flex-direction:column;gap:28px;max-width:1040px">
		<div style="display:flex;flex-direction:column;gap:10px">
			<span class="mm-kicker" style="color:var(--mm-paper)">Mentalist take · <span style="color:var(--mm-signal)">#<?php echo esc_html( str_pad( (string) $mm_take->ID, 3, '0', STR_PAD_LEFT ) ); ?></span></span>
			<span style="display:block;width:64px;height:3px;background:var(--mm-signal)"></span>
		</div>
		<p style="font-size:64px"><?php echo wp_kses_post( get_the_title( $mm_take ) ); ?></p>
		<p class="mm-standfirst" style="color:#CFC8BC;max-width:640px"><?php echo esc_html( wp_trim_words( wp_strip_all_tags( $mm_take->post_content ), 32 ) ); ?></p>
		<a href="<?php echo esc_url( get_permalink( $mm_take ) ); ?>" class="mm-btn-link" style="border-color:var(--mm-paper);color:var(--mm-paper)">Read the take <span aria-hidden="true">→</span></a>
	</div>
	<img src="<?php echo esc_url( MM_URI . '/assets/img/mark-dark.png' ); ?>" alt="" width="88" height="88" loading="lazy" class="mm-only-desktop">
</section>
