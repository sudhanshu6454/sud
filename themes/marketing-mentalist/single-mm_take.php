<?php
/**
 * Mentalist take: full-bleed statement with a previous/next take.
 *
 * @package marketing-mentalist
 */

get_header();
the_post();
$mm_post = get_post();
$mm_prev = get_previous_post( false, '', '' );
$mm_next = get_next_post( false, '', '' );
?>
<article class="mm-section mm-take" style="min-height:60vh;display:flex;flex-direction:column;justify-content:center;padding:64px var(--gutter);gap:32px">
	<div class="mm-take-head">
		<span class="mm-kicker" style="color:var(--mm-paper)">Mentalist take · #<?php echo esc_html( str_pad( (string) $mm_post->ID, 3, '0', STR_PAD_LEFT ) ); ?></span>
		<img src="<?php echo esc_url( MM_URI . '/assets/img/mark-dark.png' ); ?>" alt="" width="40" height="40" loading="lazy">
	</div>
	<p style="font-size:48px;max-width:1100px"><?php the_title(); ?></p>
	<div class="mm-body" style="color:#CFC8BC;max-width:760px"><?php the_content(); ?></div>
	<div style="display:flex;gap:2px;margin-top:8px">
		<button class="mm-tag" type="button" data-mm-share data-title="<?php echo esc_attr( get_the_title() ); ?>" data-url="<?php echo esc_url( get_permalink() ); ?>" style="border-color:var(--mm-paper);color:var(--mm-paper);cursor:pointer">Share</button>
		<button class="mm-tag" type="button" data-mm-copy data-url="<?php echo esc_url( get_permalink() ); ?>" style="border-color:var(--mm-paper);color:var(--mm-paper);cursor:pointer">Copy link</button>
	</div>
</article>
<nav style="display:grid;grid-template-columns:1fr 1fr;border-top:var(--rule)" aria-label="Take navigation">
	<?php if ( $mm_prev ) : ?>
		<a href="<?php echo esc_url( get_permalink( $mm_prev ) ); ?>" style="padding:24px var(--gutter);border-right:var(--hair)"><span class="mm-meta">← Previous</span><br><span style="font:600 16px/1.3 var(--font-display)"><?php echo esc_html( get_the_title( $mm_prev ) ); ?></span></a>
	<?php else : ?><div></div><?php endif; ?>
	<?php if ( $mm_next ) : ?>
		<a href="<?php echo esc_url( get_permalink( $mm_next ) ); ?>" style="padding:24px var(--gutter);text-align:right"><span class="mm-meta">Next →</span><br><span style="font:600 16px/1.3 var(--font-display)"><?php echo esc_html( get_the_title( $mm_next ) ); ?></span></a>
	<?php else : ?><div></div><?php endif; ?>
</nav>
<?php get_footer(); ?>
