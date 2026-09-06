<?php get_header(); while ( have_posts() ) : the_post(); ?>
<main id="main">
<section class="page-head"><div class="grid">
	<div><span class="kicker"><?php the_title(); ?></span><h1><?php echo has_excerpt() ? esc_html( get_the_excerpt() ) : get_the_title(); ?></h1></div>
	<?php if ( has_post_thumbnail() ) : ?><div class="thumb thumb--3x2"><?php the_post_thumbnail( 'c4-lead' ); ?></div><?php endif; ?>
</div></section>
<section class="page-body"><div class="entry-content"><?php the_content(); ?></div></section>
<?php if ( comments_open() ) comments_template(); ?>
</main>
<?php endwhile; get_footer();