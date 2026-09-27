<?php get_header(); ?>
<main id="main">
<section class="wall-head"><div class="wrap">
	<span class="kicker"><?php esc_html_e( 'Every story', 'filmybuff' ); ?></span>
	<div class="row"><div><h1><?php esc_html_e( 'The archive', 'filmybuff' ); ?><span>.</span></h1><p class="desc"><?php bloginfo( 'description' ); ?></p></div>
	<span class="meta"><?php printf( esc_html( _n( '%s story', '%s stories', $GLOBALS['wp_query']->found_posts, 'filmybuff' ) ), esc_html( number_format_i18n( $GLOBALS['wp_query']->found_posts ) ) ); ?></span></div>
</div></section>
<section class="log"><div class="wrap">
	<?php if ( have_posts() ) : ?>
	<div class="log__list"><?php while ( have_posts() ) : the_post(); fb_log_row(); endwhile; ?></div>
	<?php the_posts_pagination( array( 'mid_size' => 2, 'prev_text' => '←', 'next_text' => '→' ) ); else : ?><p class="empty"><?php esc_html_e( 'Nothing here yet.', 'filmybuff' ); ?></p><?php endif; ?>
</div></section>
<?php fb_stubs(); ?>
</main>
<?php get_footer();
