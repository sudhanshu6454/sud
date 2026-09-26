<?php get_header(); ?>
<main id="main"><div class="wrap">
<section class="archive-head rule"><div class="row"><div><span class="kicker kicker--grey"><?php esc_html_e( 'All stories', 'filmybuff' ); ?></span><h1><?php bloginfo( 'name' ); ?><span>.</span></h1><p class="desc"><?php bloginfo( 'description' ); ?></p></div></div></section>
<section class="archive-list"><div class="two-col"><div class="two-col__main">
	<?php if ( have_posts() ) : while ( have_posts() ) : the_post(); get_template_part( 'template-parts/list-item' ); endwhile; the_posts_pagination( array( 'mid_size' => 2, 'prev_text' => '←', 'next_text' => '→' ) ); else : ?><p><?php esc_html_e( 'Nothing here yet.', 'filmybuff' ); ?></p><?php endif; ?>
</div><aside class="sidebar"><?php fb_trending(); fb_follow_box(); dynamic_sidebar( 'sidebar-1' ); ?></aside></div></section>
</div></main>
<?php get_footer();
