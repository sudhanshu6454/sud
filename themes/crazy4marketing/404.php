<?php get_header(); ?>
<main id="main"><section class="not-found">
	<span class="kicker"><?php esc_html_e( 'Error', 'crazy4marketing' ); ?></span>
	<h1>404<span style="color:var(--c4-pink)">.</span></h1>
	<p style="font-size:20px;color:var(--c4-muted);max-width:40ch"><?php esc_html_e( 'This page got pulled after 72 hours. Try the search, or head home.', 'crazy4marketing' ); ?></p>
	<?php get_search_form(); ?>
	<a class="btn" href="<?php echo esc_url( home_url( '/' ) ); ?>"><?php esc_html_e( 'Back home →', 'crazy4marketing' ); ?></a>
</section></main>
<?php get_footer();