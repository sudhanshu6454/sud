<?php
/**
 * Not found.
 *
 * @package marketing-mentalist
 */

get_header();
?>
<header style="padding:56px var(--gutter);max-width:800px">
	<span class="mm-kicker">404</span>
	<h1 class="mm-h1" style="font-size:44px;margin:8px 0 16px">We couldn't read this page's mind.</h1>
	<p class="mm-standfirst">Try a search, or start from the latest campaigns.</p>
	<form role="search" method="get" action="<?php echo esc_url( home_url( '/' ) ); ?>" style="max-width:520px;margin-top:24px">
		<div class="mm-search-field" style="border-bottom-width:2px">
			<input type="search" name="s" placeholder="Search campaigns, brands, agencies or ideas…" style="font-size:18px">
			<button type="submit" aria-label="Search">→</button>
		</div>
	</form>
</header>
<div style="padding:32px var(--gutter) 64px">
	<h2 style="font-size:24px;margin-bottom:24px">Latest campaigns</h2>
	<div class="mm-grid-3">
		<?php foreach ( get_posts( array( 'post_type' => 'mm_campaign', 'posts_per_page' => 3, 'no_found_rows' => true ) ) as $c ) { mm_card_campaign( $c ); } ?>
	</div>
</div>
<?php get_footer(); ?>
