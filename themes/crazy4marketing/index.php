<?php get_header(); ?>
<main id="main">
<section class="archive-head"><div class="row"><div><h1><?php bloginfo( 'name' ); ?><span>.</span></h1><p class="desc"><?php bloginfo( 'description' ); ?></p></div></div></section>
<section class="archive-list"><div class="two-col"><div class="two-col__main">
	<?php if ( have_posts() ) : while ( have_posts() ) : the_post(); get_template_part( 'template-parts/list-item' ); endwhile; the_posts_pagination( array( 'mid_size' => 2, 'prev_text' => '←', 'next_text' => '→' ) ); else : ?><p><?php esc_html_e( 'Nothing here yet.', 'crazy4marketing' ); ?></p><?php endif; ?>
</div><aside class="sidebar"><?php c4_trending(); c4_follow_box(); dynamic_sidebar( 'sidebar-1' ); ?></aside></div></section>
</main>
<?php get_footer();