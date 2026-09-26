<?php get_header(); while ( have_posts() ) : the_post(); ?>
<main id="main"><div class="wrap">
<section class="page-head">
	<span class="kicker"><?php the_title(); ?></span>
	<h1><?php echo has_excerpt() ? esc_html( get_the_excerpt() ) : get_the_title(); ?></h1>
</section>
<section class="page-body"><div class="entry-content"><?php the_content(); ?></div></section>
<?php if ( comments_open() ) comments_template(); ?>
</div></main>
<?php endwhile; get_footer();
