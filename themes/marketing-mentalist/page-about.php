<?php
/**
 * Template Name: About
 *
 * @package marketing-mentalist
 */

get_header();
?>
<header style="padding:72px var(--gutter) 40px;max-width:900px">
	<span class="mm-kicker">About</span>
	<h1 class="mm-h1" style="font-size:52px;margin:8px 0 20px">The psychology behind marketing that works.</h1>
</header>
<div class="mm-body" style="padding:0 var(--gutter) 56px;max-width:760px">
	<?php the_content(); ?>
</div>
<section style="padding:0 var(--gutter) 72px;display:grid;grid-template-columns:repeat(4,1fr);border-top:var(--rule)">
	<?php
	$mm_stats = array(
		array( (string) wp_count_posts( 'mm_campaign' )->publish, 'Campaigns decoded' ),
		array( (string) wp_count_posts( 'mm_breakdown' )->publish, 'Breakdowns' ),
		array( (string) wp_count_posts( 'mm_brand' )->publish, 'Brands covered' ),
		array( (string) wp_count_posts( 'mm_agency' )->publish, 'Agencies covered' ),
	);
	foreach ( $mm_stats as list( $v, $k ) ) :
		?>
		<div style="padding:32px var(--gutter) 0 0"><span style="font:700 48px/1 var(--font-display);letter-spacing:-.03em;color:var(--mm-signal)"><?php echo esc_html( $v ); ?></span><br><span class="mm-meta"><?php echo esc_html( $k ); ?></span></div>
	<?php endforeach; ?>
</section>
<?php get_footer(); ?>
