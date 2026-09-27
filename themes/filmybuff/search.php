<?php get_header(); ?>
<main id="main">
<section class="wall-head"><div class="wrap">
	<span class="kicker"><?php esc_html_e( 'Search', 'filmybuff' ); ?></span>
	<div class="row"><div><h1><?php echo esc_html( get_search_query() ?: __( 'Every story', 'filmybuff' ) ); ?><span>.</span></h1></div>
	<span class="meta"><?php printf( esc_html( _n( '%s result', '%s results', $GLOBALS['wp_query']->found_posts, 'filmybuff' ) ), esc_html( number_format_i18n( $GLOBALS['wp_query']->found_posts ) ) ); ?></span></div>
	<div style="padding-top:20px"><?php get_search_form(); ?></div>
</div></section>
<section class="log"><div class="wrap">
	<?php if ( have_posts() ) : ?>
	<div class="log__list"><?php while ( have_posts() ) : the_post(); fb_log_row(); endwhile; ?></div>
	<?php the_posts_pagination( array( 'mid_size' => 2, 'prev_text' => '←', 'next_text' => '→' ) ); else : ?><p class="empty"><?php esc_html_e( 'No stories match. Try a film, an actor or fewer words.', 'filmybuff' ); ?></p><?php endif; ?>
</div></section>
</main>
<?php get_footer();
