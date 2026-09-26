<?php get_header(); ?>
<main id="main"><div class="wrap"><section class="not-found">
	<span class="kicker"><?php esc_html_e( 'Error', 'filmybuff' ); ?></span>
	<h1>404<span>.</span></h1>
	<p><?php esc_html_e( 'This reel is missing. Try the search, or head back to the front.', 'filmybuff' ); ?></p>
	<?php get_search_form(); ?>
	<a class="btn" href="<?php echo esc_url( home_url( '/' ) ); ?>"><?php esc_html_e( 'Back home →', 'filmybuff' ); ?></a>
</section></div></main>
<?php get_footer();
