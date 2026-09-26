<?php get_header(); while ( have_posts() ) : the_post(); ?>
<main id="main">
<section class="story__hero pick story__hero--flat">
	<div class="wrap pick__body">
		<div class="pick__cert"><span class="cert"><?php esc_html_e( 'PAGE', 'filmybuff' ); ?></span></div>
		<h1><?php the_title(); ?></h1>
		<?php if ( has_excerpt() ) : ?><p class="dek"><?php echo esc_html( get_the_excerpt() ); ?></p><?php endif; ?>
	</div>
</section>
<section class="sheet"><div class="wrap"><div class="sheet__col">
	<div class="entry-content"><?php the_content(); ?></div>
</div><?php if ( comments_open() ) comments_template(); ?></div></section>
</main>
<?php endwhile; get_footer();
