<?php get_header(); ?>
<main id="main"><div class="wrap">
<section class="archive-head rule"><span class="kicker kicker--grey"><?php esc_html_e( 'Search', 'filmybuff' ); ?></span><div class="row"><div><h1><?php echo esc_html( get_search_query() ); ?><span>.</span></h1></div><span class="meta"><?php printf( esc_html( _n( '%s result', '%s results', $GLOBALS['wp_query']->found_posts, 'filmybuff' ) ), esc_html( number_format_i18n( $GLOBALS['wp_query']->found_posts ) ) ); ?></span></div></section>
<section class="archive-list"><div class="two-col"><div class="two-col__main">
	<?php if ( have_posts() ) : while ( have_posts() ) : the_post(); get_template_part( 'template-parts/list-item' ); endwhile; the_posts_pagination( array( 'mid_size' => 2, 'prev_text' => '←', 'next_text' => '→' ) ); else : ?><p><?php esc_html_e( 'No stories match. Try a film, an actor or fewer words.', 'filmybuff' ); ?></p><br><?php get_search_form(); endif; ?>
</div><aside class="sidebar"><?php fb_trending(); fb_follow_box(); ?></aside></div></section>
</div></main>
<?php get_footer();
